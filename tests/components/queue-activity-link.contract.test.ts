import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = (path: string) => readFile(resolve(process.cwd(), path), 'utf8')

describe('global Queue activity entry contract', () => {
    it('keeps a globally visible Queue link in the wrapping header utility row', async () => {
        const layout = await source('src/components/layout/ThreeColumnLayout.tsx')

        expect(layout).toContain("import { QueueActivityLink } from './QueueActivityLink'")
        expect(layout).toContain('<QueueActivityLink />')
        expect(layout).toContain('composition routes retain their rail-free canvas width')
        expect(layout).toContain('historyPanelIsDocked = isDesktopShell && !compositionWorkspaceOwnsRails')
        expect(layout).toContain('(!rightSidebarVisible || compositionWorkspaceOwnsRails) && "2xl:hidden"')
    })

    it('uses indexed activity counts rather than Queue Center job projections', async () => {
        const [link, repository] = await Promise.all([
            source('src/components/layout/QueueActivityLink.tsx'),
            source('src/services/queue/indexeddb-queue-repository.ts'),
        ])

        expect(link).toContain('to="/queue"')
        expect(link).toContain('data-testid="global-queue-activity"')
        expect(link).toContain('getActivitySummary()')
        expect(link).not.toContain('listJobProjections')
        expect(link).toContain('document.addEventListener(\'visibilitychange\', refreshWhenVisible)')
        expect(link).toContain('window.setInterval(refreshWhenVisible, QUEUE_ACTIVITY_REFRESH_MS)')
        expect(link).toContain('min-h-11')
        expect(repository).toContain('async getActivitySummary(): Promise<QueueActivitySummary>')
        expect(repository).toContain("transaction.objectStore('jobs').index('by-state-order')")
    })
})
