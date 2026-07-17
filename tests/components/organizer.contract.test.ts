import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = (path: string) => readFile(resolve(process.cwd(), path), 'utf8')

describe('Organizer user-flow contract', () => {
    it('wires the organizer route, virtualized thumbnail browser, sibling navigation, and keyboard/touch/drag slots', async () => {
        const [page, app, layout] = await Promise.all([
            source('src/pages/Organizer.tsx'),
            source('src/App.tsx'),
            source('src/components/layout/ThreeColumnLayout.tsx'),
        ])

        for (const required of [
            'calculateFixedGridVirtualRange',
            'entries.slice(gridRange.start, gridRange.end)',
            "event.key === 'PageUp'",
            "event.key === 'PageDown'",
            "event.key === 'Enter'",
            'onDragStart',
            'onDrop',
            'onPointerUp',
            "t('organizer.duplicateAssignmentBlocked'",
            "t('organizer.thumbnailGridSizeAria'",
            "t('organizer.filenamePreview'",
            "t('organizer.conflictPreview'",
            "t('organizer.r2KeyPreview'",
            "t('organizer.copyRenameStripMetadata'",
            "t('organizer.executionProgressAria'",
            "t('organizer.diagnostics'",
            "t('organizer.optionalR2FollowUp'",
            'retryFailed',
            "t('organizer.description'",
            'consumeOrganizerHandoff',
        ]) expect(page).toContain(required)

        expect(app).toContain('path="/organizer"')
        expect(layout).toContain("path: '/organizer'")
    })

    it('keeps artifact authority portable and delegates every file/sidecar mutation to OutputWriter', async () => {
        const [types, repository, coordinator, page] = await Promise.all([
            source('src/domain/organizer/types.ts'),
            source('src/services/organizer/artifact-repository.ts'),
            source('src/services/organizer/distribution-coordinator.ts'),
            source('src/pages/Organizer.tsx'),
        ])

        expect(types).toContain('never stores raw absolute paths')
        expect(repository).toContain('cannot persist')
        expect(repository).toContain('assertArtifactOriginalUnchanged')
        expect(coordinator).toContain('new OutputWriter')
        expect(coordinator).toContain('artifactSidecarBytes')
        expect(coordinator).toContain('stripImageMetadata')
        expect(coordinator).toContain('enqueueR2FollowUp')
        expect(page).not.toContain('.writeFile(')
        expect(page).toContain('const bytes = await collectionAdapter.readEntry(entry)')
        expect(page).toContain('existing === null || existing.contentChecksum === contentChecksum')
        expect(page).toContain('`${JSON.stringify(entry.file)}\\n${contentChecksum}`')
        expect(`${types}\n${repository}\n${coordinator}`).not.toMatch(/\b(?:Electron|Sharp|better-sqlite3)\b/i)
    })

    it('reuses an Artifact handoff only after its portable file and checksum still match', async () => {
        const page = await source('src/pages/Organizer.tsx')

        expect(page).toContain('const record = await artifactRepository.get(handoff.artifactId)')
        expect(page).toContain('refreshCollection(collectionForArtifact(record))')
        expect(page).toContain('samePortableFile(entry.file, record.original.file)')
        expect(page).toContain('linked.contentChecksum === contentChecksum')
        expect(page).toContain('samePortableFile(entry.file, linked.original.file)')
        expect(page).toContain('const refreshCollection = useCallback(async (nextCollection = collectionRef.current)')
        expect(page).toContain('collectionRef.current = nextCollection')
        expect(page).toContain('}, [collectionAdapter, loadRecords])')
    })
})
