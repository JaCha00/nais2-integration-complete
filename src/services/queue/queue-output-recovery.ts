import type { OutputRecoveryResult, OutputWriter } from '@/services/output/output-writer'
import { publishGeneratedArtifact } from '@/stores/artifact-lifecycle-store'
import type { IndexedDBQueueRepository } from './indexeddb-queue-repository'
import {
    registerQueueArtifact,
    rollbackQueueArtifactRegistration,
    type QueueArtifactRepository,
} from './queue-artifact-lineage'

/**
 * Reconciles queue-owned OutputWriter journals before generic journal rollback
 * and before expired-lease recovery. Ownership comes only from the journal's
 * sourceJobId plus the job's pre-bound transaction/artifact pair; an output
 * path is never treated as proof of success.
 */
export async function recoverQueueLinkedOutputs(
    repository: IndexedDBQueueRepository,
    writer: OutputWriter,
    options: { now: string; artifactRepository?: QueueArtifactRepository },
): Promise<OutputRecoveryResult[]> {
    await repository.initialize()
    const links = await writer.inspectPendingQueueTransactions()
    const results: OutputRecoveryResult[] = []
    for (const link of links) {
        const job = await repository.getJob(link.sourceJobId)
        const ownsTransaction = job !== null
            && job.outputTransactionId === link.transactionId
            && job.artifactReference !== null
        const mayCommit = ownsTransaction
            && job.cancelRequestedAt === null
            && (job.state === 'running'
                || job.state === 'leased'
                || job.state === 'recovering'
                || job.state === 'succeeded')
        if (link.phase === 'files-committed' && mayCommit) {
            const artifactReference = job.artifactReference
            results.push(await writer.recoverTransaction(link.transactionId, {
                mode: 'retry-workflow',
                canCommit: () => true,
                commitWorkflow: async output => {
                    // A files-committed journal may survive a process restart. Register
                    // the same immutable artifact before terminalizing the Job so recovery
                    // cannot create an artifact-less Queue success.
                    const registration = await registerQueueArtifact(
                        job,
                        artifactReference,
                        output,
                        options.artifactRepository,
                    )
                    try {
                        await repository.recoverFilesCommittedSuccess({
                            jobId: job.id,
                            now: options.now,
                            outputTransactionId: link.transactionId,
                            artifactReference,
                        })
                    } catch (error) {
                        await rollbackQueueArtifactRegistration(registration, options.artifactRepository)
                        throw error
                    }
                    publishGeneratedArtifact({
                        path: output.path,
                        ...(registration === null
                            ? {}
                            : {
                                artifactId: registration.record.artifactId,
                                sourceJobId: job.id,
                                ...(job.sceneId === null ? {} : { sourceSceneId: job.sceneId }),
                            }),
                    })
                },
            }))
            continue
        }
        results.push(await writer.recoverTransaction(link.transactionId, { mode: 'rollback' }))
    }
    return results
}
