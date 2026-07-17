import { isTerminalJobState } from './state-machine'
import {
    GENERATION_JOB_STATES,
    type GenerationBatchSummary,
    type GenerationJobProjection,
    type GenerationJobState,
} from './types'

/**
 * Creates the durable zero-value summary shared by batch creation, migration,
 * and Queue Center fallbacks. Keeping all state keys present lets consumers
 * render status totals without defensive optional checks.
 */
export function createEmptyGenerationBatchSummary(batchId: string): GenerationBatchSummary {
    return {
        batchId,
        total: 0,
        completed: 0,
        progressCurrent: 0,
        progressTotal: 0,
        states: Object.fromEntries(GENERATION_JOB_STATES.map(state => [state, 0])) as Record<
            GenerationJobState,
            number
        >,
        recentCompletedAt: [],
    }
}

function progressContribution(job: GenerationJobProjection): number {
    return isTerminalJobState(job.state)
        ? 1
        : job.progress.total <= 0
            ? 0
            : Math.min(1, job.progress.current / job.progress.total)
}

function roundProjectionProgress(value: number): number {
    // Progress updates arrive repeatedly from executors. Six decimal places
    // prevents accumulated floating-point residue from making a completed
    // durable batch render as 99.999999% while preserving sub-step progress.
    return Math.round(value * 1_000_000) / 1_000_000
}

/**
 * Applies one immutable job insert or projection-visible mutation to a batch
 * aggregate. Repository write transactions call this with the old and new
 * projections, so Queue Center can read exact totals in O(1) after restart.
 */
export function applyGenerationJobProjectionDelta(
    summary: GenerationBatchSummary,
    previous: GenerationJobProjection | null,
    next: GenerationJobProjection | null,
): GenerationBatchSummary {
    if ((previous !== null && previous.batchId !== summary.batchId)
        || (next !== null && next.batchId !== summary.batchId)) {
        throw new Error('Queue projection delta does not match its batch summary')
    }

    const states = { ...summary.states }
    let total = summary.total
    let completed = summary.completed
    let progressCurrent = summary.progressCurrent
    let progressTotal = summary.progressTotal
    const recentCompletedAt = [...summary.recentCompletedAt]

    if (previous !== null) {
        states[previous.state] -= 1
        total -= 1
        progressTotal -= 1
        progressCurrent -= progressContribution(previous)
        if (isTerminalJobState(previous.state)) completed -= 1
    }
    if (next !== null) {
        states[next.state] += 1
        total += 1
        progressTotal += 1
        progressCurrent += progressContribution(next)
        if (isTerminalJobState(next.state)) {
            completed += 1
            // Terminal jobs are immutable, so a newly terminal projection is
            // the only case that should enter this bounded throughput window.
            if (previous === null || !isTerminalJobState(previous.state)) {
                recentCompletedAt.push(next.updatedAt)
            }
        }
    }

    recentCompletedAt.sort((left, right) => right.localeCompare(left))
    return {
        batchId: summary.batchId,
        total: Math.max(0, total),
        completed: Math.max(0, completed),
        progressCurrent: Math.min(
            Math.max(0, progressTotal),
            Math.max(0, roundProjectionProgress(progressCurrent)),
        ),
        progressTotal: Math.max(0, progressTotal),
        states,
        recentCompletedAt: recentCompletedAt.slice(0, 20),
    }
}

/**
 * Queue Center and the repository share this projection-only aggregate so the
 * UI can render batch-wide progress from the single job read it already needs.
 * It intentionally depends on lightweight job projections, not snapshots, and
 * preserves the summary contract used by retry, throughput, and progress views.
 */
export function summarizeGenerationJobProjections(
    batchId: string,
    jobs: readonly GenerationJobProjection[],
): GenerationBatchSummary {
    let summary = createEmptyGenerationBatchSummary(batchId)

    for (const job of jobs) {
        // Callers pass one batch page set. Ignoring an accidental foreign item
        // keeps the named summary and its retry controls internally consistent.
        if (job.batchId !== batchId) continue
        summary = applyGenerationJobProjectionDelta(summary, null, job)
    }
    return summary
}
