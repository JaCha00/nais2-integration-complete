import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { NavLink } from 'react-router-dom'
import { ListTodo } from 'lucide-react'

import type { QueueActivitySummary } from '@/domain/queue/types'
import { cn } from '@/lib/utils'
import { getRuntimeQueueRepository } from '@/services/queue/indexeddb-queue-repository'
import { Tip } from '@/components/ui/tooltip'

const QUEUE_ACTIVITY_REFRESH_MS = 5_000

const EMPTY_QUEUE_ACTIVITY_SUMMARY: QueueActivitySummary = Object.freeze({
    processing: 0,
    waiting: 0,
    needsAttention: 0,
})

type QueueActivityTone = 'attention' | 'processing' | 'waiting' | 'idle'

interface QueueActivityIndicator {
    tone: QueueActivityTone
    count: number
}

export function getQueueActivityIndicator(summary: QueueActivitySummary): QueueActivityIndicator {
    if (summary.needsAttention > 0) return { tone: 'attention', count: summary.needsAttention }
    if (summary.processing > 0) return { tone: 'processing', count: summary.processing }
    if (summary.waiting > 0) return { tone: 'waiting', count: summary.waiting }
    return { tone: 'idle', count: 0 }
}

export function QueueActivityLink() {
    const { t } = useTranslation()
    const repository = useMemo(() => getRuntimeQueueRepository(), [])
    const refreshId = useRef(0)
    const [summary, setSummary] = useState<QueueActivitySummary>(EMPTY_QUEUE_ACTIVITY_SUMMARY)
    const indicator = getQueueActivityIndicator(summary)

    const refresh = useCallback(async () => {
        const requestId = ++refreshId.current
        try {
            const nextSummary = await repository.getActivitySummary()
            if (requestId === refreshId.current) setSummary(nextSummary)
        } catch {
            // IndexedDB is the durable source for this indicator, but a transient read
            // failure must not remove the common Queue route or replace its last known state.
        }
    }, [repository])

    useEffect(() => {
        const refreshWhenVisible = () => {
            if (document.visibilityState !== 'visible') return
            void refresh()
        }

        refreshWhenVisible()
        document.addEventListener('visibilitychange', refreshWhenVisible)
        const interval = window.setInterval(refreshWhenVisible, QUEUE_ACTIVITY_REFRESH_MS)
        return () => {
            refreshId.current += 1
            window.clearInterval(interval)
            document.removeEventListener('visibilitychange', refreshWhenVisible)
        }
    }, [refresh])

    const labels: Record<QueueActivityTone, string> = {
        attention: t('queue.activity.attention', 'Needs attention'),
        processing: t('queue.activity.processing', 'In progress'),
        waiting: t('queue.activity.waiting', 'Waiting'),
        idle: t('queue.activity.idle', 'No active jobs'),
    }
    const summaryLabel = t(
        'queue.activity.summary',
        '{{processing}} in progress · {{waiting}} waiting · {{attention}} need attention',
        {
            processing: summary.processing,
            waiting: summary.waiting,
            attention: summary.needsAttention,
        },
    )
    const accessibleLabel = t('queue.activity.open', 'Open Queue Center · {{summary}}', { summary: summaryLabel })
    const visibleLabel = indicator.count === 0
        ? t('nav.queue', 'Queue Center')
        : t('queue.activity.indicator', '{{label}} {{count}}', {
            label: labels[indicator.tone],
            count: indicator.count,
        })

    return (
        <Tip content={accessibleLabel}>
            <NavLink
                to="/queue"
                data-testid="global-queue-activity"
                aria-label={accessibleLabel}
                className={({ isActive }) => cn(
                    'inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-control px-2 py-2 text-muted-foreground transition-colors duration-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card sm:px-3',
                    isActive
                        ? 'bg-accent text-primary'
                        : 'hover:bg-accent hover:text-foreground',
                )}
            >
                <ListTodo className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="sr-only">{summaryLabel}</span>
                <span className="hidden whitespace-nowrap text-xs font-medium sm:inline">{visibleLabel}</span>
                {indicator.count > 0 && (
                    <span
                        aria-live="polite"
                        className={cn(
                            'inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold sm:hidden',
                            indicator.tone === 'attention'
                                ? 'bg-destructive/15 text-destructive'
                                : indicator.tone === 'processing'
                                    ? 'bg-primary/15 text-primary'
                                    : 'bg-warning/15 text-warning',
                        )}
                    >
                        {indicator.count}
                    </span>
                )}
            </NavLink>
        </Tip>
    )
}
