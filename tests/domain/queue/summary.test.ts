import { describe, expect, it } from 'vitest'

import { summarizeGenerationJobProjections } from '@/domain/queue/summary'
import type { GenerationJobProjection, GenerationJobState } from '@/domain/queue/types'

const CREATED_AT = '2026-07-17T01:00:00.000Z'

function projection(input: Partial<GenerationJobProjection> & {
    id: string
    state: GenerationJobState
}): GenerationJobProjection {
    return {
        id: input.id,
        batchId: input.batchId ?? 'batch:summary',
        workflow: input.workflow ?? 'main',
        sceneId: input.sceneId ?? null,
        state: input.state,
        createdAt: input.createdAt ?? CREATED_AT,
        updatedAt: input.updatedAt ?? CREATED_AT,
        priority: input.priority ?? 0,
        ordinal: input.ordinal ?? 0,
        attemptCount: input.attemptCount ?? 0,
        maxAttempts: input.maxAttempts ?? 3,
        progress: input.progress ?? { stage: 'queued', current: 0, total: 0 },
        readyAt: input.readyAt ?? CREATED_AT,
        cancelRequestedAt: input.cancelRequestedAt ?? null,
        retryOfJobId: input.retryOfJobId ?? null,
        lastDiagnosticEventId: input.lastDiagnosticEventId ?? null,
        outputTransactionId: input.outputTransactionId ?? null,
        version: input.version ?? 1,
    }
}

describe('Queue projection summary', () => {
    it('keeps batch-wide state, progress, and recent completion totals from lightweight projections', () => {
        const summary = summarizeGenerationJobProjections('batch:summary', [
            projection({ id: 'queued', state: 'queued' }),
            projection({
                id: 'running',
                state: 'running',
                progress: { stage: 'sampling', current: 1, total: 4 },
            }),
            projection({
                id: 'succeeded',
                state: 'succeeded',
                updatedAt: '2026-07-17T01:02:00.000Z',
            }),
            projection({
                id: 'failed',
                state: 'failed',
                updatedAt: '2026-07-17T01:03:00.000Z',
            }),
            projection({ id: 'other-batch', batchId: 'batch:other', state: 'succeeded' }),
        ])

        expect(summary).toMatchObject({
            batchId: 'batch:summary',
            total: 4,
            completed: 2,
            progressCurrent: 2.25,
            progressTotal: 4,
            states: {
                queued: 1,
                running: 1,
                succeeded: 1,
                failed: 1,
                cancelled: 0,
                skipped: 0,
                blocked: 0,
                leased: 0,
                recovering: 0,
            },
        })
        expect(summary.recentCompletedAt).toEqual([
            '2026-07-17T01:03:00.000Z',
            '2026-07-17T01:02:00.000Z',
        ])
    })
})
