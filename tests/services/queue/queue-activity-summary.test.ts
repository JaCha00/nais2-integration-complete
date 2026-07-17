import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { describe, expect, it, vi } from 'vitest'

import type { GenerationJobSnapshot } from '@/domain/queue/types'
import {
    IndexedDBQueueRepository,
    type EnqueueGenerationJobInput,
} from '@/services/queue/indexeddb-queue-repository'
import { createGenerationJobSnapshot } from '@/services/queue/job-snapshot'

const NOW = '2026-07-17T01:00:00.000Z'
let databaseCounter = 0

function snapshot(): GenerationJobSnapshot {
    return createGenerationJobSnapshot({
        prompt: { positive: 'queue activity summary', negative: '' },
        parameters: { seed: 1 },
        outputPolicy: { format: 'png' },
        resources: [],
        resumability: 'resumable',
    })
}

function job(id: string, ordinal: number): EnqueueGenerationJobInput {
    return {
        id,
        batchId: 'batch:activity',
        workflow: 'main',
        sceneId: null,
        createdAt: NOW,
        priority: 0,
        ordinal,
        snapshot: snapshot(),
        compositionPlanHash: null,
        maxAttempts: 3,
        idempotencyKey: `idempotency:${id}`,
    }
}

function repository(): IndexedDBQueueRepository {
    databaseCounter += 1
    return new IndexedDBQueueRepository({
        factory: new IDBFactory() as unknown as globalThis.IDBFactory,
        keyRange: IDBKeyRange as unknown as typeof globalThis.IDBKeyRange,
        databaseName: `queue-activity-summary-${databaseCounter}`,
    })
}

async function lease(queue: IndexedDBQueueRepository, jobId: string) {
    const worker = `worker:${jobId}`
    const claimed = await queue.acquireLease({ jobId, owner: worker, now: NOW, ttlMs: 60_000 })
    if (claimed === null) throw new Error(`Expected ${jobId} to be leased`)
    return { worker, token: claimed.leaseToken ?? '' }
}

describe('durable queue activity summary', () => {
    it('counts only cross-batch activity states without loading Queue Center projections', async () => {
        const queue = repository()
        await queue.createBatchAndEnqueue({
            batch: {
                id: 'batch:activity',
                workflow: 'main',
                createdAt: NOW,
                failurePolicy: 'continue',
                origin: 'fresh',
                idempotencyKey: 'batch:activity',
            },
            jobs: [
                job('job:waiting', 0),
                job('job:leased', 1),
                job('job:running', 2),
                job('job:recovering', 3),
                job('job:failed', 4),
                job('job:blocked', 5),
            ],
        })

        await lease(queue, 'job:leased')

        const running = await lease(queue, 'job:running')
        await queue.transitionJob({
            jobId: 'job:running',
            to: 'running',
            now: NOW,
            leaseOwner: running.worker,
            leaseToken: running.token,
        })

        const recovering = await lease(queue, 'job:recovering')
        await queue.transitionJob({
            jobId: 'job:recovering',
            to: 'recovering',
            now: NOW,
            leaseOwner: recovering.worker,
            leaseToken: recovering.token,
        })

        const failed = await lease(queue, 'job:failed')
        await queue.transitionJob({
            jobId: 'job:failed',
            to: 'running',
            now: NOW,
            leaseOwner: failed.worker,
            leaseToken: failed.token,
        })
        await queue.transitionJob({
            jobId: 'job:failed',
            to: 'failed',
            now: NOW,
            leaseOwner: failed.worker,
            leaseToken: failed.token,
        })

        await queue.transitionJob({ jobId: 'job:blocked', to: 'blocked', now: NOW })
        const projections = vi.spyOn(queue, 'listJobProjections')

        await expect(queue.getActivitySummary()).resolves.toEqual({
            processing: 3,
            waiting: 1,
            needsAttention: 2,
        })
        expect(projections).not.toHaveBeenCalled()
        queue.close()
    })
})
