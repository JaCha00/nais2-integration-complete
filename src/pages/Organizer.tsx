import { open } from '@tauri-apps/plugin-dialog'
import { dirname } from '@tauri-apps/api/path'
import type { TFunction } from 'i18next'
import { FolderOpen, GripVertical, RefreshCw, RotateCcw, UploadCloud } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
    assignArtifactToNextEmptySlot,
    assignArtifactToSlot,
    clearOrganizerAssignment,
    type OrganizerAssignmentSlot,
} from '@/domain/organizer/assignments'
import type { ArtifactRecord, DistributionPolicy } from '@/domain/organizer/types'
import { sha256Bytes } from '@/lib/binary-digest'
import { createThumbnail } from '@/lib/image-utils'
import { calculateFixedGridVirtualRange } from '@/lib/virtualization/fixed-range'
import { runtimeCapabilities } from '@/platform/capabilities'
import { ensureImageFileExtension, renderFilenameTemplate, splitFileName } from '@/services/output/filename-policy'
import {
    getRuntimeArtifactDistributionCoordinator,
    getRuntimeArtifactRepository,
    getRuntimeOrganizerCollectionAdapter,
} from '@/services/organizer/runtime'
import type { OrganizerCollection, OrganizerCollectionEntry } from '@/services/organizer/collection-adapter'
import { dataUrlForOrganizerImage } from '@/services/organizer/image-transcoder'
import { getRuntimeR2UploadRepository } from '@/services/r2/runtime'
import type { R2ProfileV2 } from '@/domain/r2/types'
import { useDiagnosticsStore } from '@/stores/diagnostics-store'
import { consumeOrganizerHandoff } from '@/services/organizer/handoff'

const GRID_GAP = 12
const GRID_TILE_MIN_WIDTH = 152
const GRID_TILE_HEIGHT = 194
const SLOT_COUNT = 8

const INITIAL_SLOTS: readonly OrganizerAssignmentSlot[] = Array.from({ length: SLOT_COUNT }, (_, index) => ({
    slotId: `slot-${index + 1}`,
    artifactId: null,
}))

type MetadataPolicy = 'preserve' | 'strip'
type AlphaPolicy = 'preserve' | 'flatten'
type CollisionPolicy = 'unique' | 'overwrite' | 'error'
type DistributionFormat = 'png' | 'webp'

interface OrganizerPolicyState {
    filenameTemplate: string
    format: DistributionFormat
    webpLossless: boolean
    quality: number
    alphaPolicy: AlphaPolicy
    matteColor: string
    metadataPolicy: MetadataPolicy
    collisionPolicy: CollisionPolicy
    r2ProfileId: string
    r2Prefix: string
}

const DEFAULT_POLICY: OrganizerPolicyState = {
    filenameTemplate: '{original.name}-distribution',
    format: 'png',
    webpLossless: false,
    quality: 92,
    alphaPolicy: 'preserve',
    matteColor: '#ffffff',
    metadataPolicy: 'strip',
    collisionPolicy: 'unique',
    r2ProfileId: '',
    r2Prefix: 'organizer',
}

function entryKey(entry: OrganizerCollectionEntry): string {
    return entry.entryId
}

function samePortableFile(
    left: OrganizerCollectionEntry['file'],
    right: ArtifactRecord['original']['file'],
): boolean {
    return left.fileName === right.fileName
        && JSON.stringify(left.directory) === JSON.stringify(right.directory)
}

function collectionForArtifact(record: ArtifactRecord): OrganizerCollection {
    return {
        id: `artifact-source:${record.artifactId}`,
        label: record.original.file.fileName,
        directory: record.original.file.directory,
        // This can be a standard root or an existing bookmark. It is not the
        // managed Organizer collection, but its portable reference is already
        // owned by the immutable ArtifactRecord.
        source: 'external',
    }
}

function thumbnailAlt(t: TFunction, entry: OrganizerCollectionEntry): string {
    return t('organizer.thumbnailAlt', { fileName: entry.file.fileName })
}

function filenamePreview(t: TFunction, entry: OrganizerCollectionEntry | null, policy: OrganizerPolicyState): string {
    if (entry === null) return t('organizer.selectImageForFilenamePreview')
    const originalName = splitFileName(entry.file.fileName).stem
    const rendered = renderFilenameTemplate({
        template: policy.filenameTemplate,
        fallback: originalName || 'artifact',
        context: {
            originalName,
            original: { name: originalName, format: entry.format },
            distribution: { variantId: 'preview' },
        },
    })
    return ensureImageFileExtension(rendered, policy.format) ?? `artifact.${policy.format}`
}

function makePolicy(collection: OrganizerCollection, state: OrganizerPolicyState, r2Enabled: boolean): DistributionPolicy {
    const quality = Number.isFinite(state.quality) ? Math.min(100, Math.max(0, state.quality)) / 100 : 0.92
    return {
        destination: collection.directory,
        filenameTemplate: state.filenameTemplate,
        collisionPolicy: state.collisionPolicy,
        format: state.format,
        webpLossless: state.webpLossless,
        quality,
        alphaPolicy: state.alphaPolicy,
        matteColor: state.matteColor,
        metadataPolicy: state.metadataPolicy,
        r2FollowUp: state.r2ProfileId && r2Enabled
            ? { profileId: state.r2ProfileId, remoteKeyPrefix: state.r2Prefix.trim() || 'organizer' }
            : null,
    }
}

function r2KeyPreview(t: TFunction, profile: R2ProfileV2 | null, prefix: string, fileName: string): string | null {
    if (profile === null) return null
    const parts = [profile.prefix, prefix, fileName].flatMap(part => part.split('/').filter(Boolean))
    if (parts.length === 0 || parts.some(part => part === '.' || part === '..' || /[\\\0]/.test(part))) {
        return t('organizer.invalidRemoteKey')
    }
    return parts.join('/')
}

function distributionModePreview(t: TFunction, entry: OrganizerCollectionEntry | null, policy: OrganizerPolicyState): string {
    if (entry === null) return t('organizer.selectImageForOperationPreview')
    if (entry.format === policy.format && policy.alphaPolicy === 'preserve') {
        return policy.metadataPolicy === 'strip'
            ? t('organizer.copyRenameStripMetadata')
            : t('organizer.copyRenamePreserveBytes')
    }
    const formats = { sourceFormat: entry.format.toUpperCase(), targetFormat: policy.format.toUpperCase() }
    return policy.alphaPolicy === 'flatten'
        ? t('organizer.convertAndFlattenOperation', formats)
        : t('organizer.convertOperation', formats)
}

function statusForResult(t: TFunction, status: string): string {
    if (status === 'succeeded') return t('organizer.distributionSucceeded')
    if (status === 'cancelled') return t('organizer.distributionCancelled')
    return t('organizer.distributionFailed')
}

/**
 * Organizer stays deliberately thin: it scans through the platform capability
 * boundary and asks OutputWriter-backed coordination to make every mutation.
 */
export default function Organizer() {
    const { t } = useTranslation()
    const collectionAdapter = useMemo(() => getRuntimeOrganizerCollectionAdapter(), [])
    const artifactRepository = useMemo(() => getRuntimeArtifactRepository(), [])
    const distributionCoordinator = useMemo(() => getRuntimeArtifactDistributionCoordinator(), [])
    const viewportRef = useRef<HTMLDivElement>(null)
    const refreshGeneration = useRef(0)
    const [collection, setCollection] = useState<OrganizerCollection>(() => collectionAdapter.managedCollection())
    // The one-shot History handoff awaits this refresh. Keep its default collection
    // and status translator outside the callback identity so setCollection cannot
    // restart the handoff effect and erase its recovered artifact selection.
    const collectionRef = useRef(collection)
    const tRef = useRef(t)
    collectionRef.current = collection
    tRef.current = t
    const [siblingCollections, setSiblingCollections] = useState<readonly OrganizerCollection[]>([])
    const [entries, setEntries] = useState<readonly OrganizerCollectionEntry[]>([])
    const [records, setRecords] = useState<readonly ArtifactRecord[]>([])
    const [artifactIdsByEntry, setArtifactIdsByEntry] = useState<Record<string, string>>({})
    const [thumbnails, setThumbnails] = useState<Record<string, string>>({})
    const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null)
    const [slots, setSlots] = useState<readonly OrganizerAssignmentSlot[]>(INITIAL_SLOTS)
    const [draggedEntryId, setDraggedEntryId] = useState<string | null>(null)
    const [policy, setPolicy] = useState<OrganizerPolicyState>(DEFAULT_POLICY)
    const [profiles, setProfiles] = useState<readonly R2ProfileV2[]>([])
    const [scrollTop, setScrollTop] = useState(0)
    const [viewport, setViewport] = useState({ width: 720, height: 480 })
    const [gridTileWidth, setGridTileWidth] = useState(168)
    const [conflictPreview, setConflictPreview] = useState(() => t('organizer.selectImageForConflictPreview'))
    const [executionStage, setExecutionStage] = useState<'idle' | 'registering' | 'writing' | 'requeueing'>('idle')
    const [busy, setBusy] = useState(false)
    const [status, setStatus] = useState(() => t('organizer.initialStatus'))
    const diagnosticEvents = useDiagnosticsStore(state => state.events)

    const selectedEntry = useMemo(
        () => entries.find(entry => entry.entryId === selectedEntryId) ?? null,
        [entries, selectedEntryId],
    )
    const selectedPreview = useMemo(() => filenamePreview(t, selectedEntry, policy), [policy, selectedEntry, t])
    const selectedProfile = useMemo(
        () => profiles.find(profile => profile.id === policy.r2ProfileId) ?? null,
        [policy.r2ProfileId, profiles],
    )
    const r2Capability = runtimeCapabilities.r2ForegroundUpload
    const remotePreview = useMemo(
        () => r2KeyPreview(t, selectedProfile, policy.r2Prefix, selectedPreview),
        [policy.r2Prefix, selectedPreview, selectedProfile, t],
    )
    const modePreview = useMemo(() => distributionModePreview(t, selectedEntry, policy), [policy, selectedEntry, t])
    const organizerDiagnostics = useMemo(
        () => diagnosticEvents.filter(event => event.operation === 'organizer.distribution').slice(0, 3),
        [diagnosticEvents],
    )
    const assignedArtifactIds = useMemo(
        () => new Set(slots.flatMap(slot => slot.artifactId === null ? [] : [slot.artifactId])),
        [slots],
    )
    const recordsById = useMemo(() => new Map(records.map(record => [record.artifactId, record])), [records])

    const loadRecords = useCallback(async () => {
        const next: ArtifactRecord[] = []
        let cursor: string | null = null
        do {
            const page = await artifactRepository.list({ cursor, limit: 500 })
            next.push(...page.items)
            cursor = page.nextCursor
        } while (cursor !== null)
        setRecords(next)
    }, [artifactRepository])

    const refreshCollection = useCallback(async (nextCollection = collectionRef.current): Promise<readonly OrganizerCollectionEntry[] | null> => {
        const requestId = ++refreshGeneration.current
        setBusy(true)
        try {
            const [nextEntries, siblings] = await Promise.all([
                collectionAdapter.listEntries(nextCollection),
                collectionAdapter.listSiblingCollections(nextCollection),
            ])
            if (requestId !== refreshGeneration.current) return null
            collectionRef.current = nextCollection
            setCollection(nextCollection)
            setEntries(nextEntries)
            setSiblingCollections(siblings)
            setThumbnails({})
            setArtifactIdsByEntry({})
            setSelectedEntryId(current => nextEntries.some(entry => entry.entryId === current) ? current : null)
            await loadRecords()
            if (requestId === refreshGeneration.current) {
                setStatus(tRef.current('organizer.collectionReady', { count: nextEntries.length.toLocaleString() }))
            }
            return nextEntries
        } catch {
            if (requestId === refreshGeneration.current) setStatus(tRef.current('organizer.collectionReadFailed'))
            return null
        } finally {
            if (requestId === refreshGeneration.current) setBusy(false)
        }
    }, [collectionAdapter, loadRecords])

    useEffect(() => {
        let active = true
        const handoff = consumeOrganizerHandoff()
        if (handoff === null) {
            void refreshCollection()
            return () => { active = false }
        }

        const selectPathFallback = () => dirname(handoff.path)
            .then(path => collectionAdapter.registerExternalDirectory(path))
            .then(async external => {
                const nextEntries = await refreshCollection(external)
                if (!active || nextEntries === null) return
                setSelectedEntryId(`${external.id}:${handoff.fileName}`)
            })

        // Queue-backed History carries an artifact id. Reuse its portable file
        // identity before falling back to the legacy raw-path navigation hint,
        // so a generated original is not re-imported under a second artifact id.
        const reuseArtifact = async (): Promise<boolean> => {
            if (handoff.artifactId === undefined) return false
            const record = await artifactRepository.get(handoff.artifactId)
            if (record === null) return false
            const nextEntries = await refreshCollection(collectionForArtifact(record))
            if (!active) return true
            if (nextEntries === null) return false
            const matchingEntry = nextEntries.find(entry => samePortableFile(entry.file, record.original.file))
            if (matchingEntry === undefined) return false
            setArtifactIdsByEntry(current => ({ ...current, [matchingEntry.entryId]: record.artifactId }))
            setSelectedEntryId(matchingEntry.entryId)
            return true
        }

        void reuseArtifact()
            .then(reused => reused ? undefined : selectPathFallback())
            .catch(() => selectPathFallback())
            .catch(() => { if (active) void refreshCollection() })
        return () => { active = false }
    }, [artifactRepository, collectionAdapter, refreshCollection])

    useEffect(() => {
        const viewportNode = viewportRef.current
        if (viewportNode === null) return
        const update = () => setViewport({
            width: Math.max(1, viewportNode.clientWidth),
            height: Math.max(1, viewportNode.clientHeight),
        })
        update()
        const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
        observer?.observe(viewportNode)
        return () => observer?.disconnect()
    }, [])

    useEffect(() => {
        let active = true
        if (selectedEntry === null) {
            setConflictPreview(t('organizer.selectImageForConflictPreview'))
            return () => { active = false }
        }
        setConflictPreview(t('organizer.checkingDestination'))
        void collectionAdapter.previewDistributionConflict(collection, selectedPreview)
            .then(preview => {
                if (!active) return
                if (preview.status === 'available') {
                    setConflictPreview(t('organizer.destinationAvailable'))
                    return
                }
                const collisions = [
                    ...(preview.imageExists ? [t('organizer.collisionImage')] : []),
                    ...(preview.artifactSidecarExists ? [t('organizer.collisionArtifactSidecar')] : []),
                ]
                const collisionPolicy = policy.collisionPolicy === 'unique'
                    ? t('organizer.collisionPolicyUnique')
                    : policy.collisionPolicy === 'overwrite'
                        ? t('organizer.collisionPolicyOverwrite')
                        : t('organizer.collisionPolicyError')
                setConflictPreview(t('organizer.destinationConflict', {
                    items: collisions.join(t('organizer.collisionListSeparator')),
                    policy: collisionPolicy,
                }))
            })
            .catch(() => { if (active) setConflictPreview(t('organizer.conflictPreviewUnavailable')) })
        return () => { active = false }
    }, [collection, collectionAdapter, policy.collisionPolicy, selectedEntry, selectedPreview, t])

    useEffect(() => {
        let active = true
        void getRuntimeR2UploadRepository().listProfiles()
            .then(next => { if (active) setProfiles(next) })
            .catch(() => { if (active) setProfiles([]) })
        return () => { active = false }
    }, [])

    const gridRange = useMemo(() => calculateFixedGridVirtualRange({
        itemCount: entries.length,
        scrollTop,
        viewportHeight: viewport.height,
        viewportWidth: viewport.width,
        itemWidth: gridTileWidth + GRID_GAP,
        itemHeight: GRID_TILE_HEIGHT + GRID_GAP,
        overscanRows: 2,
    }), [entries.length, gridTileWidth, scrollTop, viewport.height, viewport.width])

    const getArtifactId = useCallback(async (entry: OrganizerCollectionEntry): Promise<string> => {
        // Stable logical identity prevents source-folder paths from becoming
        // authority data while still detecting an edited original on re-import.
        const identityBytes = new TextEncoder().encode(JSON.stringify(entry.file))
        return `artifact-${(await sha256Bytes(identityBytes)).slice('sha256:'.length)}`
    }, [])

    const ensureArtifact = useCallback(async (entry: OrganizerCollectionEntry): Promise<string> => {
        const bytes = await collectionAdapter.readEntry(entry)
        const contentChecksum = await sha256Bytes(bytes)
        const linkedArtifactId = artifactIdsByEntry[entry.entryId]
        if (linkedArtifactId !== undefined) {
            const linked = await artifactRepository.get(linkedArtifactId)
            // The handoff mapping is only a read model. Recheck file bytes here
            // before distribution so an externally edited original becomes a new
            // immutable import instead of silently reusing Queue provenance.
            if (linked !== null
                && linked.contentChecksum === contentChecksum
                && samePortableFile(entry.file, linked.original.file)) {
                return linked.artifactId
            }
        }
        const logicalArtifactId = await getArtifactId(entry)
        const existing = await artifactRepository.get(logicalArtifactId)
        // The first import keeps the stable logical ID. If the same portable
        // file reference now contains different bytes, combine identity and
        // checksum into a new immutable version instead of reusing stale data.
        const artifactId = existing === null || existing.contentChecksum === contentChecksum
            ? logicalArtifactId
            : `artifact-${(await sha256Bytes(new TextEncoder().encode(
                `${JSON.stringify(entry.file)}\n${contentChecksum}`,
            ))).slice('sha256:'.length)}`
        await artifactRepository.putOriginal({
            artifactId,
            file: entry.file,
            format: entry.format,
            contentChecksum,
            size: bytes.byteLength,
        })
        await loadRecords()
        setArtifactIdsByEntry(current => ({ ...current, [entry.entryId]: artifactId }))
        return artifactId
    }, [artifactIdsByEntry, artifactRepository, collectionAdapter, getArtifactId, loadRecords])

    const ensureThumbnail = useCallback(async (entry: OrganizerCollectionEntry) => {
        const key = entryKey(entry)
        if (thumbnails[key] !== undefined) return
        try {
            const bytes = await collectionAdapter.readEntry(entry)
            const thumb = await createThumbnail(dataUrlForOrganizerImage(bytes, entry.format), 224)
            setThumbnails(current => current[key] === undefined ? { ...current, [key]: thumb } : current)
        } catch {
            // The collection continues to be useful even if one preview fails.
            setThumbnails(current => current[key] === undefined ? { ...current, [key]: '' } : current)
        }
    }, [collectionAdapter, thumbnails])

    useEffect(() => {
        for (const entry of entries.slice(gridRange.start, gridRange.end)) void ensureThumbnail(entry)
    }, [ensureThumbnail, entries, gridRange.end, gridRange.start])

    const assignToNextSlot = useCallback(async (entry: OrganizerCollectionEntry) => {
        try {
            const artifactId = await ensureArtifact(entry)
            const result = assignArtifactToNextEmptySlot(slots, artifactId)
            setSlots(result.slots)
            setStatus(result.ok
                ? t('organizer.assignedToSlot', { fileName: entry.file.fileName, slotId: result.assignedSlotId })
                : t('organizer.noEmptySlot'))
        } catch {
            setStatus(t('organizer.originalRegistrationFailed'))
        }
    }, [ensureArtifact, slots, t])

    const assignToSlot = useCallback(async (slotId: string, entryId: string | null) => {
        const entry = entries.find(candidate => candidate.entryId === entryId)
        if (entry === undefined) return
        try {
            const artifactId = await ensureArtifact(entry)
            const result = assignArtifactToSlot(slots, artifactId, slotId)
            setSlots(result.slots)
            setStatus(result.ok
                ? t('organizer.assignedToSlot', { fileName: entry.file.fileName, slotId })
                : result.reason === 'duplicate-assignment'
                    ? t('organizer.duplicateAssignmentBlocked')
                    : t('organizer.slotAssignmentRejected'))
        } catch {
            setStatus(t('organizer.originalRegistrationFailed'))
        }
    }, [ensureArtifact, entries, slots, t])

    const chooseExternalFolder = useCallback(async () => {
        try {
            const capability = collectionAdapter.externalFolderCapability()
            if (!capability.supported) {
                setStatus(t('organizer.externalFoldersUnavailable', {
                    reason: capability.reason ?? t('organizer.externalFoldersUnavailableFallback'),
                    alternative: capability.alternative ?? '',
                }).trim())
                return
            }
            const selected = await open({ directory: true, multiple: false, title: t('organizer.selectFolderDialogTitle') })
            if (typeof selected !== 'string') return
            const external = collectionAdapter.registerExternalDirectory(selected)
            await refreshCollection(external)
        } catch {
            setStatus(t('organizer.folderSelectionUnavailable'))
        }
    }, [collectionAdapter, refreshCollection, t])

    const moveSibling = useCallback((direction: -1 | 1) => {
        const choices = [collection, ...siblingCollections]
        const currentIndex = choices.findIndex(candidate => candidate.id === collection.id)
        const next = choices[(Math.max(0, currentIndex) + direction + choices.length) % choices.length]
        if (next !== undefined) void refreshCollection(next)
    }, [collection, refreshCollection, siblingCollections])

    const runDistribution = useCallback(async () => {
        if (selectedEntry === null) {
            setStatus(t('organizer.selectImageBeforeDistribution'))
            return
        }
        setBusy(true)
        try {
            setExecutionStage('registering')
            const artifactId = await ensureArtifact(selectedEntry)
            setExecutionStage('writing')
            const result = await distributionCoordinator.createAndRun(artifactId, makePolicy(collection, policy, r2Capability.supported))
            setStatus(statusForResult(t, result.status))
            await loadRecords()
        } catch {
            setStatus(t('organizer.distributionStartFailed'))
        } finally {
            setExecutionStage('idle')
            setBusy(false)
        }
    }, [collection, distributionCoordinator, ensureArtifact, loadRecords, policy, r2Capability.supported, selectedEntry, t])

    const retryFailed = useCallback(async () => {
        setBusy(true)
        try {
            setExecutionStage('requeueing')
            const summary = await distributionCoordinator.retryFailed()
            setStatus(t('organizer.retryCompleted', {
                distributionCount: summary.distributionRuns.length,
                remoteCount: summary.remoteRetryCount,
            }))
            await loadRecords()
        } catch {
            setStatus(t('organizer.retryFailedMessage'))
        } finally {
            setExecutionStage('idle')
            setBusy(false)
        }
    }, [distributionCoordinator, loadRecords, t])

    const latestSelectedRecord = selectedEntry === null
        ? null
        : recordsById.get(artifactIdsByEntry[selectedEntry.entryId] ?? '') ?? null
    const failedCount = useMemo(() => records.reduce((count, record) => (
        count + record.distributionVariants.filter(variant => variant.status === 'failed').length
    ), 0), [records])
    const columnWidth = Math.max(GRID_TILE_MIN_WIDTH, Math.floor((viewport.width - Math.max(0, gridRange.columnCount - 1) * GRID_GAP) / gridRange.columnCount))
    const gridHeight = Math.ceil(entries.length / gridRange.columnCount) * (GRID_TILE_HEIGHT + GRID_GAP)
    const executionProgress = executionStage === 'registering' ? 25 : executionStage === 'writing' ? 75 : executionStage === 'requeueing' ? 50 : 0
    const executionStageLabel = executionStage === 'idle'
        ? t('organizer.executionStageIdle')
        : executionStage === 'registering'
            ? t('organizer.executionStageRegistering')
            : executionStage === 'writing'
                ? t('organizer.executionStageWriting')
                : t('organizer.executionStageRequeueing')

    return (
        <main
            className="flex h-full min-h-0 min-w-0 flex-col overflow-y-auto bg-canvas lg:overflow-hidden"
            aria-label={t('organizer.title')}
        >
            <header className="shrink-0 border-b border-border px-3 py-3 sm:px-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                        <h1 className="text-lg font-semibold">{t('organizer.title')}</h1>
                        <p className="text-xs text-muted-foreground">{t('organizer.description')}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <Button variant="outline" onClick={() => void refreshCollection()} disabled={busy}>
                            <RefreshCw className="mr-2 h-4 w-4" />{t('organizer.refresh')}
                        </Button>
                        <Button variant="outline" onClick={() => void chooseExternalFolder()} disabled={busy}>
                            <FolderOpen className="mr-2 h-4 w-4" />{t('organizer.chooseFolder')}
                        </Button>
                    </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-sm" onKeyDown={event => {
                    if (event.key === 'PageUp') {
                        event.preventDefault()
                        moveSibling(-1)
                    }
                    if (event.key === 'PageDown') {
                        event.preventDefault()
                        moveSibling(1)
                    }
                }}>
                    <label className="sr-only" htmlFor="organizer-collection">{t('organizer.currentCollection')}</label>
                    <select
                        id="organizer-collection"
                        className="min-h-11 max-w-full rounded-control border border-input bg-background px-3"
                        value={collection.id}
                        onChange={event => {
                            const next = [collection, ...siblingCollections].find(candidate => candidate.id === event.target.value)
                            if (next !== undefined) void refreshCollection(next)
                        }}
                    >
                        <option value={collection.id}>{collection.label}</option>
                        {siblingCollections.filter(candidate => candidate.id !== collection.id).map(candidate => (
                            <option key={candidate.id} value={candidate.id}>{candidate.label}</option>
                        ))}
                    </select>
                    <span className="rounded-full border border-border px-2 py-1 text-xs text-muted-foreground">
                        {collection.source === 'external'
                            ? t('organizer.externalCollection')
                            : t('organizer.managedCollection')}
                    </span>
                    <span className="text-xs text-muted-foreground">{t('organizer.folderShortcut')}</span>
                </div>
            </header>

            {/* Narrow screens scroll the two sections as one document; desktop constrains the grid and policy pane to independent scrollers. */}
            <div className="grid min-w-0 flex-none grid-cols-1 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.42fr)]">
                <section className="flex min-h-[420px] min-w-0 flex-col border-b border-border lg:min-h-0 lg:border-b-0 lg:border-r" aria-label={t('organizer.virtualizedArtifactBrowserAria')}>
                    <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border px-3 py-2 sm:px-5">
                        <p className="text-sm text-muted-foreground">{t('organizer.imageCount', { count: entries.length })}</p>
                        <label className="flex min-h-11 items-center gap-2 text-xs">
                            {t('organizer.gridSize')}
                            <input
                                type="range"
                                min="128"
                                max="280"
                                step="8"
                                value={gridTileWidth}
                                aria-label={t('organizer.thumbnailGridSizeAria')}
                                onChange={event => setGridTileWidth(Number(event.target.value))}
                            />
                            <span>{gridTileWidth}px</span>
                        </label>
                    </div>
                    <div
                        ref={viewportRef}
                        className="min-h-[320px] min-w-0 flex-1 overflow-auto overscroll-contain p-3 sm:p-5"
                        onScroll={event => setScrollTop(event.currentTarget.scrollTop)}
                        role="grid"
                        aria-label={t('organizer.artifactThumbnailBrowserAria')}
                    >
                        {entries.length === 0 ? (
                            <div className="flex min-h-48 items-center justify-center text-center text-sm text-muted-foreground">
                                {t('organizer.empty')}
                            </div>
                        ) : (
                            <div className="relative" style={{ height: gridHeight }}>
                                {entries.slice(gridRange.start, gridRange.end).map((entry, offset) => {
                                    const index = gridRange.start + offset
                                    const row = Math.floor(index / gridRange.columnCount)
                                    const column = index % gridRange.columnCount
                                    const selected = entry.entryId === selectedEntryId
                                    const thumb = thumbnails[entryKey(entry)]
                                    return (
                                        <button
                                            key={entry.entryId}
                                            type="button"
                                            draggable
                                            role="gridcell"
                                            aria-selected={selected}
                                            aria-label={t('organizer.assignNextSlotAria', { fileName: entry.file.fileName })}
                                            data-testid="organizer-grid-item"
                                            data-organizer-index={index}
                                            onClick={() => setSelectedEntryId(entry.entryId)}
                                            onKeyDown={event => {
                                                if (event.key === 'Enter') {
                                                    event.preventDefault()
                                                    void assignToNextSlot(entry)
                                                }
                                            }}
                                            onDragStart={event => {
                                                event.dataTransfer.effectAllowed = 'copy'
                                                event.dataTransfer.setData('text/plain', entry.entryId)
                                                setDraggedEntryId(entry.entryId)
                                            }}
                                            onDragEnd={() => setDraggedEntryId(null)}
                                            className={`absolute flex min-w-0 flex-col overflow-hidden rounded-control border bg-card text-left outline-none transition focus-visible:ring-2 focus-visible:ring-ring ${selected ? 'border-primary ring-1 ring-primary/30' : 'border-border hover:border-primary/60'}`}
                                            style={{
                                                width: columnWidth,
                                                height: GRID_TILE_HEIGHT,
                                                left: column * (columnWidth + GRID_GAP),
                                                top: row * (GRID_TILE_HEIGHT + GRID_GAP),
                                            }}
                                        >
                                            <span className="flex min-h-0 flex-1 items-center justify-center bg-muted/30">
                                                {thumb ? <img src={thumb} alt={thumbnailAlt(t, entry)} className="h-full w-full object-cover" /> : <span className="text-xs text-muted-foreground">{t('organizer.loadingPreview')}</span>}
                                            </span>
                                            <span className="flex min-h-11 items-center gap-1 px-2 py-1">
                                                <GripVertical className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />
                                                <span className="truncate text-xs" title={entry.file.fileName}>{entry.file.fileName}</span>
                                            </span>
                                        </button>
                                    )
                                })}
                            </div>
                        )}
                    </div>
                </section>

                <aside className="overflow-visible lg:min-h-0 lg:overflow-y-auto" aria-label={t('organizer.distributionPolicyAndSlotsAria')}>
                    <section className="border-b border-border p-3 sm:p-5">
                        <h2 className="font-semibold">{t('organizer.assignmentSlots')}</h2>
                        <p className="mt-1 text-xs text-muted-foreground">{t('organizer.assignmentHelp')}</p>
                        <div className="mt-3 grid grid-cols-2 gap-2">
                            {slots.map(slot => {
                                const record = slot.artifactId === null ? null : recordsById.get(slot.artifactId) ?? null
                                const filled = record !== null
                                return (
                                    <button
                                        key={slot.slotId}
                                        type="button"
                                        className="min-h-16 rounded-control border border-dashed border-border px-2 py-2 text-left text-xs hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                        data-testid="organizer-slot"
                                        data-slot-id={slot.slotId}
                                        onDragOver={event => event.preventDefault()}
                                        onDrop={event => {
                                            event.preventDefault()
                                            void assignToSlot(slot.slotId, draggedEntryId ?? event.dataTransfer.getData('text/plain'))
                                            setDraggedEntryId(null)
                                        }}
                                        onPointerUp={event => {
                                            if (event.pointerType === 'touch' && selectedEntryId !== null) {
                                                void assignToSlot(slot.slotId, selectedEntryId)
                                            }
                                        }}
                                        onClick={() => {
                                            if (selectedEntryId !== null) void assignToSlot(slot.slotId, selectedEntryId)
                                        }}
                                    >
                                        <span className="block font-medium">{slot.slotId}</span>
                                        <span className="mt-1 block truncate text-muted-foreground">{filled ? record.original.file.fileName : t('organizer.slotEmpty')}</span>
                                    </button>
                                )
                            })}
                        </div>
                        {assignedArtifactIds.size > 0 && (
                            <Button variant="ghost" size="sm" className="mt-2" onClick={() => setSlots(current => clearOrganizerAssignment(current, slots.find(slot => slot.artifactId !== null)?.slotId ?? ''))}>
                                {t('organizer.clearSlot')}
                            </Button>
                        )}
                    </section>

                    <section className="space-y-3 p-3 sm:p-5">
                        <div>
                            <h2 className="font-semibold">{t('organizer.exportSettings')}</h2>
                            <p className="mt-1 text-xs text-muted-foreground">{t('organizer.exportDescription')}</p>
                        </div>
                        <label className="block text-xs font-medium">{t('organizer.filenameTemplate')}
                            <input value={policy.filenameTemplate} onChange={event => setPolicy(current => ({ ...current, filenameTemplate: event.target.value }))} className="mt-1 min-h-11 w-full rounded-control border border-input bg-background px-3 text-sm" />
                        </label>
                        <div className="rounded-control border border-border bg-muted/30 p-2 text-xs">
                            <span className="font-medium">{t('organizer.filenamePreview')}: </span>{selectedPreview}
                            <p className="mt-1 text-muted-foreground">{t('organizer.conflictPreview')}: {conflictPreview}</p>
                            <p className="mt-1 text-muted-foreground">{t('organizer.operationPreview')}: {modePreview}</p>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                            <label className="text-xs font-medium">{t('organizer.format')}
                                <select value={policy.format} onChange={event => setPolicy(current => ({ ...current, format: event.target.value as DistributionFormat }))} className="mt-1 min-h-11 w-full rounded-control border border-input bg-background px-2">
                                    <option value="png">PNG</option><option value="webp">WebP</option>
                                </select>
                            </label>
                            <label className="text-xs font-medium">{t('organizer.collision')}
                                <select value={policy.collisionPolicy} onChange={event => setPolicy(current => ({ ...current, collisionPolicy: event.target.value as CollisionPolicy }))} className="mt-1 min-h-11 w-full rounded-control border border-input bg-background px-2">
                                    <option value="unique">{t('organizer.collisionPolicyUnique')}</option><option value="overwrite">{t('organizer.collisionPolicyOverwrite')}</option><option value="error">{t('organizer.collisionPolicyError')}</option>
                                </select>
                            </label>
                        </div>
                        <label className="block text-xs font-medium">{t('organizer.quality')} {policy.quality}
                            <input type="range" min="1" max="100" value={policy.quality} onChange={event => setPolicy(current => ({ ...current, quality: Number(event.target.value) }))} className="mt-1 w-full" />
                        </label>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                            <label className="flex min-h-11 items-center gap-2 rounded-control border border-input px-2"><input type="checkbox" checked={policy.metadataPolicy === 'strip'} onChange={event => setPolicy(current => ({ ...current, metadataPolicy: event.target.checked ? 'strip' : 'preserve' }))} />{t('organizer.stripMetadata')}</label>
                            <label className="flex min-h-11 items-center gap-2 rounded-control border border-input px-2"><input type="checkbox" checked={policy.alphaPolicy === 'flatten'} onChange={event => setPolicy(current => ({ ...current, alphaPolicy: event.target.checked ? 'flatten' : 'preserve' }))} />{t('organizer.flattenAlpha')}</label>
                            <label className="flex min-h-11 items-center gap-2 rounded-control border border-input px-2"><input type="checkbox" checked={policy.webpLossless} disabled={policy.format !== 'webp'} onChange={event => setPolicy(current => ({ ...current, webpLossless: event.target.checked }))} />{t('organizer.losslessWebp')}</label>
                            <label className="text-xs font-medium">{t('organizer.matte')}<input type="color" value={policy.matteColor} onChange={event => setPolicy(current => ({ ...current, matteColor: event.target.value }))} className="mt-1 block h-9 w-full" /></label>
                        </div>
                        {policy.format === 'webp' && policy.webpLossless && <p className="rounded-control border border-warning/40 bg-warning/10 p-2 text-xs">{t('organizer.losslessWebpUnsupported')}</p>}
                        <label className="block text-xs font-medium">{t('organizer.optionalR2FollowUp')}
                            <select value={policy.r2ProfileId} disabled={!r2Capability.supported} onChange={event => setPolicy(current => ({ ...current, r2ProfileId: event.target.value }))} className="mt-1 min-h-11 w-full rounded-control border border-input bg-background px-2 disabled:opacity-50">
                                <option value="">{t('organizer.doNotEnqueueR2')}</option>
                                {profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
                            </select>
                        </label>
                        {!r2Capability.supported && <p className="rounded-control border border-warning/40 bg-warning/10 p-2 text-xs">{r2Capability.reason ?? t('organizer.r2FollowUpUnavailable')} {r2Capability.alternative ?? ''}</p>}
                        {policy.r2ProfileId && <label className="block text-xs font-medium">{t('organizer.r2KeyPrefix')}<input value={policy.r2Prefix} onChange={event => setPolicy(current => ({ ...current, r2Prefix: event.target.value }))} className="mt-1 min-h-11 w-full rounded-control border border-input bg-background px-3" /></label>}
                        {remotePreview !== null && <p className="rounded-control border border-border bg-muted/30 p-2 text-xs"><span className="font-medium">{t('organizer.r2KeyPreview')}: </span>{remotePreview}</p>}
                        <div className="flex flex-wrap gap-2">
                            <Button onClick={() => void runDistribution()} disabled={busy || selectedEntry === null} data-testid="organizer-run-distribution">
                                <UploadCloud className="mr-2 h-4 w-4" />{t('organizer.createExport')}
                            </Button>
                            <Button variant="outline" onClick={() => void retryFailed()} disabled={busy || failedCount === 0}>
                                <RotateCcw className="mr-2 h-4 w-4" />{t('organizer.retryFailed')} ({failedCount})
                            </Button>
                        </div>
                        <div className="space-y-1">
                            <div className="flex justify-between text-xs text-muted-foreground"><span>{t('organizer.progress')}</span><span>{executionStageLabel}</span></div>
                            <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label={t('organizer.executionProgressAria')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={executionProgress}>
                                <div className="h-full bg-primary transition-[width]" style={{ width: `${executionProgress}%` }} />
                            </div>
                        </div>
                        <p className="rounded-control border border-border p-2 text-xs text-muted-foreground" role="status">{status}</p>
                        <details className="rounded-control border border-border p-2 text-xs">
                            <summary className="cursor-pointer font-medium">{t('organizer.diagnostics')} ({organizerDiagnostics.length})</summary>
                            {organizerDiagnostics.length === 0 ? <p className="mt-2 text-muted-foreground">{t('organizer.noDiagnostics')}</p> : (
                                <ul className="mt-2 space-y-1 text-muted-foreground">
                                    {organizerDiagnostics.map(event => <li key={event.eventId}><span className="font-mono">{event.code}</span> · {event.userSummary}</li>)}
                                </ul>
                            )}
                        </details>
                        {latestSelectedRecord !== null && <p className="text-xs text-muted-foreground">{t('organizer.artifactRecordConnected', { artifactId: latestSelectedRecord.artifactId })}</p>}
                    </section>
                </aside>
            </div>
        </main>
    )
}
