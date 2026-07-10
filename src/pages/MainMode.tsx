import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { ImageIcon, ImagePlus, Download, Copy, RotateCcw, Save, Users, FolderOpen, Paintbrush, SlidersHorizontal, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AVAILABLE_MODELS, useGenerationStore } from '@/stores/generation-store'
import { useAuthStore } from '@/stores/auth-store'
import { useSettingsStore } from '@/stores/settings-store'
import { MetadataDialog } from '@/components/metadata/MetadataDialog'
import { ImageReferenceDialog } from '@/components/metadata/ImageReferenceDialog'
import { parseMetadataFromBase64 } from '@/lib/metadata-parser'
import { generateImage } from '@/services/novelai-api'
import { toast } from '@/components/ui/use-toast'
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuTrigger,
    ContextMenuSeparator,
} from '@/components/ui/context-menu'
import { openPath } from '@tauri-apps/plugin-opener'
import { save } from '@tauri-apps/plugin-dialog'
import { join } from '@tauri-apps/api/path'
import { writeFile, mkdir, exists } from '@tauri-apps/plugin-fs'
import {
    getMediaStorageRoot,
    MEDIA_STORAGE_BASE_DIRECTORY,
    shouldUseAbsoluteMediaPath,
} from '@/platform/storage'
import { useNavigate } from 'react-router-dom'
import { useToolsStore } from '@/stores/tools-store'
import { Wand2 } from 'lucide-react'
import { InpaintingDialog } from '@/components/tools/InpaintingDialog'
import { LAYOUT_SHEET_EVENTS } from '@/components/layout/layout-events'

export default function MainMode() {
    const { t } = useTranslation()
    const {
        previewImage,
        isGenerating,
        selectedResolution,
        seed,
        previewSeed,

        lastGenerationTime,
        batchCount,
        currentBatch,
        streamProgress,
        model,
        isCancelled,
        generatingMode,
        generate,
        cancelGeneration,
        setSourceImage,
        setI2IMode,
    } = useGenerationStore()

    const navigate = useNavigate()
    const { setActiveImage } = useToolsStore()
    const anlas = useAuthStore(state => state.anlas)
    const anlas2 = useAuthStore(state => state.anlas2)
    const slot2Enabled = useAuthStore(state => state.slot2Enabled)
    const selectedModelName = AVAILABLE_MODELS.find(option => option.id === model)?.name ?? model
    const visibleBalance = slot2Enabled && anlas2 ? anlas2.total : anlas?.total

    const [metadataDialogOpen, setMetadataDialogOpen] = useState(false)
    const [metadataImage, setMetadataImage] = useState<string | undefined>(undefined)
    const [isDragOver, setIsDragOver] = useState(false)
    const [imageRefDialogOpen, setImageRefDialogOpen] = useState(false)
    // Inpainting dialog state
    const [inpaintDialogOpen, setInpaintDialogOpen] = useState(false)

    // Get more store functions for regenerate with metadata
    const genStore = useGenerationStore()

    // Regenerate with metadata - direct API call without modifying UI
    const handleRegenerateWithMetadata = async () => {
        if (!previewImage || isGenerating) return

        const token = useAuthStore.getState().token
        if (!token) {
            toast({
                title: t('toast.tokenRequired.title', '토큰 필요'),
                variant: 'destructive',
            })
            return
        }

        try {
            // Parse metadata from current image
            const metadata = await parseMetadataFromBase64(previewImage)
            if (!metadata) {
                toast({
                    title: t('toast.noMetadata', '메타데이터 없음'),
                    description: t('toast.noMetadataDesc', '이 이미지에서 메타데이터를 찾을 수 없습니다'),
                    variant: 'destructive',
                })
                return
            }

            // Set generating state
            genStore.setIsGenerating(true)

            // Generate random seed
            const newSeed = Math.floor(Math.random() * 4294967295)

            // Map metadata model name to API model ID
            // Metadata returns display names like "NovelAI Diffusion V4.5 ..." 
            // but API needs IDs like "nai-diffusion-4-5-full"
            const mapModelNameToId = (name?: string): string => {
                if (!name) return 'nai-diffusion-4-5-full'
                const lower = name.toLowerCase()
                if (lower.includes('4.5') || lower.includes('4-5')) {
                    if (lower.includes('curated')) return 'nai-diffusion-4-5-curated'
                    return 'nai-diffusion-4-5-full'
                }
                if (lower.includes('v4') || lower.includes('4')) {
                    if (lower.includes('curated')) return 'nai-diffusion-4-curated-preview'
                    return 'nai-diffusion-4-full'
                }
                if (lower.includes('furry')) return 'nai-diffusion-furry-3'
                if (lower.includes('v3') || lower.includes('3')) return 'nai-diffusion-3'
                return 'nai-diffusion-4-5-full'
            }

            // Call API directly with metadata (without modifying UI store)
            // Use all settings from metadata, only randomize seed
            const result = await generateImage(token, {
                prompt: metadata.prompt || '',
                negative_prompt: metadata.negativePrompt || '',
                model: mapModelNameToId(metadata.model),
                width: metadata.width || 832,
                height: metadata.height || 1216,
                steps: metadata.steps || 28,
                cfg_scale: metadata.cfgScale || 5,
                cfg_rescale: metadata.cfgRescale || 0,
                sampler: metadata.sampler || 'k_euler',
                scheduler: metadata.scheduler || 'native',
                smea: metadata.smea ?? true,
                smea_dyn: metadata.smeaDyn ?? false,
                variety: metadata.variety ?? false,
                seed: newSeed,
                imageFormat: useSettingsStore.getState().imageFormat,
            })

            if (result.success && result.imageData) {
                // Update preview with new image
                const { imageFormat } = useSettingsStore.getState()
                const mimeType = imageFormat === 'webp' ? 'image/webp' : 'image/png'
                const fileExt = imageFormat === 'webp' ? 'webp' : 'png'
                genStore.setPreviewImage(`data:${mimeType};base64,${result.imageData}`)

                // Save to disk if autoSave is enabled
                const { savePath, autoSave, useAbsolutePath } = useSettingsStore.getState()
                if (autoSave) {
                    try {
                        const binaryString = atob(result.imageData)
                        const bytes = new Uint8Array(binaryString.length)
                        for (let j = 0; j < binaryString.length; j++) {
                            bytes[j] = binaryString.charCodeAt(j)
                        }

                        const fileName = `NAIS_${Date.now()}.${fileExt}`
                        const outputDir = savePath || 'NAIS_Output'

                        let fullPath: string

                        if (shouldUseAbsoluteMediaPath(useAbsolutePath)) {
                            // Save to absolute path directly
                            const dirExists = await exists(outputDir)
                            if (!dirExists) {
                                await mkdir(outputDir, { recursive: true })
                            }
                            fullPath = await join(outputDir, fileName)
                            await writeFile(fullPath, bytes)
                        } else {
                            // Save relative to Pictures directory
                            const dirExists = await exists(outputDir, { baseDir: MEDIA_STORAGE_BASE_DIRECTORY })
                            if (!dirExists) {
                                await mkdir(outputDir, { baseDir: MEDIA_STORAGE_BASE_DIRECTORY })
                            }
                            await writeFile(`${outputDir}/${fileName}`, bytes, { baseDir: MEDIA_STORAGE_BASE_DIRECTORY })
                            fullPath = await join(await getMediaStorageRoot(), outputDir, fileName)
                        }

                        // Dispatch event for instant history update
                        try {
                            window.dispatchEvent(new CustomEvent('newImageGenerated', {
                                detail: { path: fullPath, data: `data:${mimeType};base64,${result.imageData}` }
                            }))
                        } catch (e) {
                            console.warn('Failed to dispatch newImageGenerated event:', e)
                        }
                    } catch (e) {
                        console.warn('Failed to save regenerated image:', e)
                    }
                }

                toast({
                    title: t('toast.regenerated', '재생성 완료'),
                    variant: 'success',
                })
            } else {
                toast({
                    title: t('toast.generateFailed', '생성 실패'),
                    description: result.error,
                    variant: 'destructive',
                })
            }
        } catch (e) {
            console.error('Regenerate failed:', e)
        } finally {
            genStore.setIsGenerating(false)
        }
    }



    const handleCopy = async () => {
        if (!previewImage) return
        try {
            const response = await fetch(previewImage)
            const blob = await response.blob()
            await navigator.clipboard.write([
                new ClipboardItem({ [blob.type]: blob })
            ])
        } catch (e) {
            console.error('Copy failed', e)
        }
    }

    // Save As with native Windows dialog
    const handleSaveAs = async () => {
        if (!previewImage) return
        try {
            const { imageFormat } = useSettingsStore.getState()
            const fileExt = imageFormat === 'webp' ? 'webp' : 'png'
            const filterName = imageFormat === 'webp' ? 'WebP Image' : 'PNG Image'
            const filePath = await save({
                defaultPath: `NAIS_${Date.now()}.${fileExt}`,
                filters: [{ name: filterName, extensions: [fileExt] }],
            })

            if (filePath) {
                const base64Data = previewImage.split(',')[1]
                const binaryString = atob(base64Data)
                const bytes = new Uint8Array(binaryString.length)
                for (let i = 0; i < binaryString.length; i++) {
                    bytes[i] = binaryString.charCodeAt(i)
                }

                await writeFile(filePath, bytes)
                toast({
                    title: t('toast.saved', '저장 완료'),
                    variant: 'success',
                })
            }
        } catch (e) {
            console.error('Save failed:', e)
            toast({
                title: t('toast.saveFailed', '저장 실패'),
                variant: 'destructive',
            })
        }
    }

    // Open folder containing saved images
    const handleOpenFolder = async () => {
        try {
            const { savePath, useAbsolutePath } = useSettingsStore.getState()
            const finalSavePath = savePath || 'NAIS_Output'

            let folderPath: string
            if (shouldUseAbsoluteMediaPath(useAbsolutePath)) {
                folderPath = finalSavePath
            } else {
                folderPath = await join(await getMediaStorageRoot(), finalSavePath)
            }

            const dirExists = await exists(folderPath)
            if (!dirExists) {
                await mkdir(folderPath, { recursive: true })
            }

            await openPath(folderPath)
        } catch (e) {
            console.error('Failed to open folder:', e)
        }
    }

    const handleOpenSmartTools = () => {
        if (previewImage) {
            setActiveImage(previewImage)
            navigate('/tools')
        }
    }

    // Inpainting: Open dialog directly (source/mode set when mask is saved)
    const handleInpaint = () => {
        if (!previewImage) return
        setInpaintDialogOpen(true)
    }

    // I2I: Set source and stay on page (already in main mode)
    const handleI2I = () => {
        if (!previewImage) return
        setSourceImage(previewImage)
        setI2IMode('i2i')
    }

    // Image Reference popup
    const handleAddAsReference = () => {
        if (previewImage) {
            setImageRefDialogOpen(true)
        }
    }

    // Metadata loading from current preview
    const handleLoadMetadata = () => {
        if (previewImage) {
            setMetadataImage(previewImage)
            setMetadataDialogOpen(true)
        }
    }

    // ThreeColumnLayout owns Sheet state. This event keeps MainMode's compact
    // command dock decoupled while making the primary prompt flow discoverable.
    const handleOpenPromptSheet = () => {
        window.dispatchEvent(new Event(LAYOUT_SHEET_EVENTS.OPEN_PROMPT))
    }

    const handlePrimaryGeneration = () => {
        if (isGenerating && generatingMode === 'main') {
            cancelGeneration()
            return
        }
        if (!isGenerating) {
            generate()
        }
    }

    const handleSeedAction = () => {
        const targetSeed = previewSeed ?? seed
        if (targetSeed === null || targetSeed === undefined) return

        if (previewSeed !== null && previewSeed !== undefined) {
            genStore.setSeed(previewSeed)
            genStore.setPreviewSeed(null)
            toast({ title: t('toast.seedApplied', '시드 적용됨'), variant: 'success' })
            return
        }

        navigator.clipboard.writeText(targetSeed.toString())
        toast({ title: t('toast.copied', '복사됨'), variant: 'success' })
    }

    // Drag counter to prevent flickering from child elements
    const dragCounter = useRef(0)

    // Drag & Drop for metadata loading
    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        dragCounter.current = 0
        setIsDragOver(false)

        const file = e.dataTransfer.files[0]
        if (file && file.type.startsWith('image/')) {
            // Convert file to base64
            const reader = new FileReader()
            reader.onload = () => {
                setMetadataImage(reader.result as string)
                setMetadataDialogOpen(true)
            }
            reader.readAsDataURL(file)
        }
    }, [])

    const handleDragEnter = useCallback((e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        dragCounter.current++
        if (e.dataTransfer.types.includes('Files')) {
            setIsDragOver(true)
        }
    }, [])

    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
    }, [])

    const handleDragLeave = useCallback((e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        dragCounter.current--
        if (dragCounter.current === 0) {
            setIsDragOver(false)
        }
    }, [])

    // Memory cleanup on unmount - release large Base64 data when leaving main mode
    // This prevents OOM when switching between modes (Issue #6)
    useEffect(() => {
        return () => {
            console.log('[MainMode] Unmounting - clearing runtime data')
            useGenerationStore.getState().clearRuntimeData()
        }
    }, [])

    // Timer Logic
    const [elapsedTime, setElapsedTime] = useState(0)

    useEffect(() => {
        let interval: any
        if (isGenerating) {
            const start = Date.now()
            setElapsedTime(0)
            interval = setInterval(() => {
                setElapsedTime(Date.now() - start)
            }, 100)
        } else {
            setElapsedTime(0)
        }
        return () => clearInterval(interval)
    }, [isGenerating])

    // Format time (s.ms)
    const formatTime = (ms: number) => (ms / 1000).toFixed(1)

    return (
        <div
            className="relative h-full min-h-0 w-full overflow-hidden bg-canvas"
            onDrop={handleDrop}
            onDragEnter={handleDragEnter}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
        >
            {/* DESIGN.md Cobalt Instrument: drag feedback is a single semantic
                layer so metadata import stays clear without glow or glass. */}
            {isDragOver && (
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-scrim/70 p-4" role="status" aria-live="polite">
                    <div className="w-full max-w-md rounded-panel border-2 border-primary bg-card p-6 text-center shadow-overlay sm:p-8">
                        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-panel bg-accent text-primary">
                            <ImagePlus className="h-8 w-8" />
                        </div>
                        <p className="text-lg font-semibold text-foreground">
                            {t('metadata.dropToLoad', '이미지를 드롭하여 메타데이터 불러오기')}
                        </p>
                        <p className="mt-2 text-sm text-muted-foreground">
                            {t('metadata.extractDesc', 'PNG 파일에서 프롬프트와 설정을 추출합니다')}
                        </p>
                    </div>
                </div>
            )}

            {/* Full Screen Image Area */}
            <div className="flex h-full w-full items-center justify-center overflow-hidden pb-36 sm:pb-28 2xl:pb-0">
                {previewImage ? (
                    // Generated Image with Context Menu
                    <ContextMenu>
                        <ContextMenuTrigger asChild>
                            <div className="group relative h-full w-full cursor-context-menu">
                                <img
                                    src={previewImage}
                                    alt="Generated preview"
                                    className="w-full h-full object-contain"
                                />
                                {/* Image Actions Overlay (Visible on hover) */}
                                <div className="absolute right-3 top-3 flex gap-2 opacity-100 transition-opacity duration-standard sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
                                    <Button
                                        size="icon"
                                        variant="secondary"
                                        className="h-11 w-11 rounded-control border border-border bg-card/95 text-foreground shadow-panel hover:bg-accent"
                                        onClick={handleRegenerateWithMetadata}
                                        disabled={isGenerating}
                                        aria-label={t('actions.regenerate', '재생성')}
                                    >
                                        <RotateCcw className="h-5 w-5" />
                                    </Button>
                                    <Button
                                        size="icon"
                                        variant="secondary"
                                        className="h-11 w-11 rounded-control border border-border bg-card/95 text-foreground shadow-panel hover:bg-accent"
                                        onClick={handleCopy}
                                        aria-label={t('actions.copy', '복사')}
                                    >
                                        <Copy className="h-5 w-5" />
                                    </Button>
                                    <Button
                                        size="icon"
                                        variant="secondary"
                                        className="h-11 w-11 rounded-control border border-border bg-card/95 text-foreground shadow-panel hover:bg-accent"
                                        onClick={handleSaveAs}
                                        aria-label={t('actions.saveAs', '저장')}
                                    >
                                        <Download className="h-5 w-5" />
                                    </Button>
                                </div>
                            </div>
                        </ContextMenuTrigger>
                        <ContextMenuContent>
                            <ContextMenuItem onClick={handleSaveAs}>
                                <Save className="h-4 w-4 mr-2" />
                                {t('actions.saveAs', '저장')}
                            </ContextMenuItem>
                            <ContextMenuItem onClick={handleCopy}>
                                <Copy className="h-4 w-4 mr-2" />
                                {t('actions.copy', '복사')}
                            </ContextMenuItem>
                            <ContextMenuItem onClick={handleRegenerateWithMetadata} disabled={isGenerating}>
                                <RotateCcw className="h-4 w-4 mr-2" />
                                {t('actions.regenerate', '재생성')}
                            </ContextMenuItem>
                            <ContextMenuItem onClick={handleOpenSmartTools}>
                                <Wand2 className="h-4 w-4 mr-2" />
                                {t('smartTools.title', '스마트 툴')}
                            </ContextMenuItem>
                            <ContextMenuSeparator />
                            <ContextMenuItem onClick={handleInpaint}>
                                <Paintbrush className="h-4 w-4 mr-2" />
                                {t('tools.inpainting.title', '인페인팅')}
                            </ContextMenuItem>
                            <ContextMenuItem onClick={handleI2I}>
                                <ImageIcon className="h-4 w-4 mr-2" />
                                {t('tools.i2i.title', 'Image to Image')}
                            </ContextMenuItem>
                            <ContextMenuSeparator />
                            <ContextMenuItem onClick={handleAddAsReference}>
                                <Users className="h-4 w-4 mr-2" />
                                {t('actions.addAsRef', '이미지 참조')}
                            </ContextMenuItem>
                            <ContextMenuItem onClick={handleOpenFolder}>
                                <FolderOpen className="h-4 w-4 mr-2" />
                                {t('actions.openFolder', '폴더 열기')}
                            </ContextMenuItem>
                            <ContextMenuItem onClick={handleLoadMetadata}>
                                <ImageIcon className="h-4 w-4 mr-2" />
                                {t('metadata.loadFromImage', '메타데이터 불러오기')}
                            </ContextMenuItem>
                        </ContextMenuContent>
                    </ContextMenu>
                ) : isGenerating ? (
                    // Loading State (Only shown when no previous image exists)
                    <div className="z-10 flex max-w-sm flex-col items-center justify-center px-6 text-center" role="status" aria-live="polite">
                        <div className="relative mb-4 flex h-16 w-16 items-center justify-center rounded-panel border border-border bg-card shadow-panel">
                            <div className="absolute inset-2 animate-spin rounded-full border-2 border-primary/20 border-t-primary" />
                            <ImagePlus className="h-6 w-6 text-primary" />
                        </div>
                        <p className="text-base font-semibold text-foreground">
                            {batchCount > 1
                                ? `${t('generate.loadingTitle')} (${currentBatch}/${batchCount})`
                                : t('generate.loadingTitle')
                            }
                        </p>
                        <p className="mt-2 font-mono text-xs tabular-nums text-muted-foreground">
                            {formatTime(elapsedTime)}s
                            {lastGenerationTime && (
                                <span className="mx-1 text-muted-foreground/70">/ ~{formatTime(lastGenerationTime)}s</span>
                            )}
                        </p>
                    </div>
                ) : (
                    // Empty state intentionally keeps one action and one import hint.
                    <div className="flex max-w-md flex-col items-center justify-center px-6 text-center">
                        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-panel border border-border bg-muted text-muted-foreground">
                            <ImageIcon className="h-8 w-8" />
                        </div>
                        <h1 className="text-lg font-semibold text-foreground">{t('generate.emptyState')}</h1>
                        <p className="mt-1 max-w-sm text-sm leading-6 text-muted-foreground">
                            {t('generate.emptyDescription')}
                        </p>
                        <Button variant="outline" className="mt-4" onClick={handleOpenPromptSheet}>
                            <SlidersHorizontal className="h-4 w-4" />
                            {t('generate.openPrompt', '프롬프트 열기')}
                        </Button>
                        <p className="mt-3 hidden text-xs text-muted-foreground sm:block">
                            {t('metadata.dropHint', '이미지를 드래그하여 메타데이터를 불러올 수 있습니다')}
                        </p>
                    </div>
                )}
            </div>

            {/* Generation Progress Bar - Above Info Bar */}
            {isGenerating && (
                <div className="absolute bottom-36 left-1/2 z-20 flex w-[min(30rem,calc(100%-1rem))] -translate-x-1/2 items-center gap-3 rounded-panel border border-border bg-card px-3 py-2 shadow-overlay sm:bottom-28 2xl:bottom-16" role="status" aria-live="polite">
                    <div className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
                    <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-3">
                            <span className="truncate text-xs font-medium text-foreground">
                            {t('generate.generating')}
                            </span>
                            <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                                {formatTime(elapsedTime)}s
                                {lastGenerationTime && <> / {formatTime(lastGenerationTime)}s</>}
                            </span>
                        </div>
                        {streamProgress > 0 && streamProgress < 100 && (
                            <div className="mt-2 flex items-center gap-2">
                                <div
                                    className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"
                                    role="progressbar"
                                    aria-label={t('generate.progress', '생성 진행률')}
                                    aria-valuemin={0}
                                    aria-valuemax={100}
                                    aria-valuenow={streamProgress}
                                >
                                <div
                                        className="h-full bg-primary transition-[width] duration-standard ease-out"
                                    style={{ width: `${streamProgress}%` }}
                                />
                                </div>
                                <span className="w-9 text-right font-mono text-xs tabular-nums text-primary">{streamProgress}%</span>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Compact generation command dock. ThreeColumnLayout supplies the
                full PromptPanel only at 2xl, so all smaller widths keep the core
                prompt/generate path visible without hiding any advanced fields. */}
            <div data-testid="main-command-dock" className="absolute inset-x-2 bottom-2 z-10 mx-auto grid max-w-4xl gap-2 rounded-panel border border-border bg-card p-2 shadow-overlay sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center 2xl:hidden">
                <dl className="grid min-w-0 grid-cols-2 gap-x-3 gap-y-1 px-1 sm:grid-cols-4">
                    <div className="min-w-0">
                        <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t('settings.model', '모델')}</dt>
                        <dd className="truncate text-xs font-medium text-foreground" title={selectedModelName}>{selectedModelName}</dd>
                    </div>
                    <div className="min-w-0">
                        <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t('settings.resolution')}</dt>
                        <dd className="truncate text-xs font-medium text-foreground">{selectedResolution.width} × {selectedResolution.height}</dd>
                    </div>
                    <div className="min-w-0">
                        <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t('settings.seed')}</dt>
                        <dd>
                            <button type="button" className="max-w-full truncate text-left font-mono text-xs text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={handleSeedAction} title={t('actions.copy', '복사')}>
                                {previewSeed ?? seed ?? t('settings.random')}
                            </button>
                        </dd>
                    </div>
                    <div className="min-w-0">
                        <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t('settingsPage.api.token', 'Anlas')}</dt>
                        <dd className="truncate font-mono text-xs font-medium tabular-nums text-foreground">{visibleBalance?.toLocaleString() ?? 'N/A'}</dd>
                    </div>
                </dl>
                <div className="grid grid-cols-2 gap-2 sm:flex">
                    <Button variant="outline" className="min-w-0 sm:min-w-28" onClick={handleOpenPromptSheet}>
                        <SlidersHorizontal className="h-4 w-4" />
                        {t('prompt.title', '프롬프트')}
                    </Button>
                    <Button
                        data-testid="main-generate-action"
                        variant={isGenerating && generatingMode === 'main' ? 'destructive' : 'generate'}
                        className="min-w-0 sm:min-w-32"
                        onClick={handlePrimaryGeneration}
                        disabled={(isGenerating && generatingMode !== 'main') || (isGenerating && isCancelled)}
                    >
                        {isGenerating && generatingMode === 'main' ? <Square className="h-4 w-4" /> : <ImagePlus className="h-4 w-4" />}
                        {isGenerating && generatingMode === 'main' ? t('generate.cancel', '취소') : t('generate.button', '생성')}
                    </Button>
                </div>
            </div>

            {/* At 2xl the side panels are docked, leaving only image provenance
                in this footer. It remains keyboard-operable over bright images. */}
            <div className="absolute bottom-3 left-1/2 hidden -translate-x-1/2 items-center gap-4 rounded-panel border border-border bg-card px-3 py-2 text-xs text-foreground shadow-panel 2xl:flex">
                <span className="whitespace-nowrap text-muted-foreground">
                    {t('settings.resolution')} <strong className="ml-1 font-medium text-foreground">{selectedResolution.width} × {selectedResolution.height}</strong>
                </span>
                <span className="h-4 w-px bg-border" aria-hidden="true" />
                <button type="button" className="whitespace-nowrap text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={handleSeedAction}>
                    {t('settings.seed')} <strong className="ml-1 font-mono font-medium text-primary">{previewSeed ?? seed ?? t('settings.random')}</strong>
                </button>
            </div>

            {/* Metadata Dialog */}
            <MetadataDialog
                open={metadataDialogOpen}
                onOpenChange={(open) => {
                    setMetadataDialogOpen(open)
                    if (!open) setMetadataImage(undefined)
                }}
                initialImage={metadataImage}
            />

            {/* Image Reference Dialog */}
            <ImageReferenceDialog
                open={imageRefDialogOpen}
                onOpenChange={setImageRefDialogOpen}
                imageBase64={previewImage || null}
            />

            {/* Inpainting Dialog */}
            <InpaintingDialog
                open={inpaintDialogOpen}
                onOpenChange={setInpaintDialogOpen}
                sourceImage={previewImage}
            />
        </div>
    )
}
