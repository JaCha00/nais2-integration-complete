import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/components/ui/use-toast'
import { useSceneStore, type SceneCard } from '@/stores/scene-store'
import { useGenerationStore } from '@/stores/generation-store'
import { useSettingsStore } from '@/stores/settings-store'
import { useAuthStore, type ApiSlot } from '@/stores/auth-store'
import { generateImage, generateImageStream } from '@/services/novelai-api'
import { useCharacterStore } from '@/stores/character-store'
import { useRotationStore } from '@/stores/character-rotation-store'
import { buildSceneGenerationParams } from '@/lib/scene-generation/build-scene-params'
import { saveSceneResult } from '@/lib/scene-generation/save-scene-result'

let activeSceneWorkerCount = 0
const runningSceneSlots = new Set<ApiSlot>()
let releasedImageDataSessionId: number | null = null

type Translate = ReturnType<typeof useTranslation>['t']

interface SceneWorkerContext {
    activePresetId: string
    sessionId: number
    savePath: string
    streamingView: boolean
    t: Translate
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

function isSessionAlive(sessionId: number): boolean {
    const state = useSceneStore.getState()
    return state.isGenerating && !state.isCancelling && state.generationSessionId === sessionId
}

function shouldStopForSession(sessionId: number): boolean {
    return !isSessionAlive(sessionId)
}

function releaseImageDataOnce(sessionId: number): void {
    if (releasedImageDataSessionId === sessionId) return
    releasedImageDataSessionId = sessionId
    useCharacterStore.getState().releaseImageData()
}

async function processSceneWithSlot(slot: ApiSlot, token: string, scene: SceneCard, ctx: SceneWorkerContext): Promise<boolean> {
    if (!isSessionAlive(ctx.sessionId)) return false

    useSceneStore.getState().setStreamingData(scene.id, null, 0)

    const { params, finalPrompt, mimeType } = await buildSceneGenerationParams(scene)
    if (!isSessionAlive(ctx.sessionId)) return false

    // Streaming renders a single shared preview, so startWorkers limits the
    // session to one worker whenever this flag is true.
    const canUseStreaming = ctx.streamingView
    const streamMimeType = params.imageFormat === 'webp' ? 'image/webp' : 'image/png'
    const result = canUseStreaming
        ? await generateImageStream(token, params, (progress, image) => {
            if (!isSessionAlive(ctx.sessionId)) return
            if (image) {
                useSceneStore.getState().setStreamingData(scene.id, `data:${streamMimeType};base64,${image}`, progress / 100)
            } else {
                useSceneStore.getState().setStreamingData(scene.id, null, progress / 100)
            }
        })
        : await generateImage(token, params)

    if (!isSessionAlive(ctx.sessionId)) return false

    if (!result.success || !result.imageData) {
        console.error(`[Scene Worker slot ${slot}] generation failed:`, result.error)
        toast({ title: ctx.t('common.error', '오류'), description: result.error || 'Generation failed', variant: 'destructive' })
        return false
    }

    if (!isSessionAlive(ctx.sessionId)) return false

    const saved = await saveSceneResult(scene, ctx, finalPrompt, params, result.imageData, mimeType, result.encodedVibes, {
        canSave: () => isSessionAlive(ctx.sessionId),
    })
    if (!saved || !isSessionAlive(ctx.sessionId)) return false

    useAuthStore.getState().refreshAnlas(slot)

    const currentState = useSceneStore.getState()
    currentState.setGenerationProgress(currentState.completedCount + 1, currentState.totalQueuedCount)
    return true
}

function finalizeWorkers(ctx: SceneWorkerContext): void {
    if (activeSceneWorkerCount !== 0) return

    const sceneStore = useSceneStore.getState()
    const sessionMatches = sceneStore.generationSessionId === ctx.sessionId
    const wasCancelling = sceneStore.isCancelling
    const queueRemaining = sceneStore.getQueuedScenes(ctx.activePresetId).length

    sceneStore.setStreamingData(null, null, 0)
    useGenerationStore.getState().setGeneratingMode(null)
    releaseImageDataOnce(ctx.sessionId)

    if (!sessionMatches && !wasCancelling) {
        return
    }

    sceneStore.setIsGenerating(false)

    if (queueRemaining === 0) {
        sceneStore.setGenerationProgress(0, 0)
        if (!wasCancelling) {
            toast({
                title: ctx.t('generate.complete', '생성 완료'),
                description: ctx.t('generate.allComplete', '모든 예약된 작업이 완료되었습니다.'),
                variant: 'success',
            })
        }
    }
}

async function workerLoop(slot: ApiSlot, token: string, ctx: SceneWorkerContext): Promise<void> {
    activeSceneWorkerCount++
    try {
        while (true) {
            if (shouldStopForSession(ctx.sessionId)) return
            if (!useAuthStore.getState().isSlotActive(slot)) return

            const scene = useSceneStore.getState().decrementFirstQueuedScene(ctx.activePresetId)
            if (!scene) return

            let shouldRetryScene = true
            while (shouldRetryScene) {
                shouldRetryScene = false
                try {
                    await processSceneWithSlot(slot, token, scene, ctx)
                } catch (error) {
                    const errorMessage = String(error)
                    console.error(`[Scene Worker slot ${slot}] process error:`, error)
                    useSceneStore.getState().setStreamingData(null, null, 0)

                    if (errorMessage.includes('429') || errorMessage.toLowerCase().includes('too many requests')) {
                        await sleep(3000)
                        shouldRetryScene = isSessionAlive(ctx.sessionId) && useAuthStore.getState().isSlotActive(slot)
                        continue
                    }

                    toast({ title: ctx.t('common.error', '오류'), description: errorMessage, variant: 'destructive' })
                    useSceneStore.getState().setIsGenerating(false)
                    return
                }
            }

            useSceneStore.getState().setStreamingData(null, null, 0)

            const state = useSceneStore.getState()
            const hasMoreScenes = isSessionAlive(ctx.sessionId) && state.getQueuedScenes(ctx.activePresetId).length > 0
            if (hasMoreScenes) {
                const { generationDelay } = useSettingsStore.getState()
                if (generationDelay > 0) {
                    await sleep(generationDelay)
                }
            }
        }
    } finally {
        activeSceneWorkerCount--
        finalizeWorkers(ctx)
    }
}

export function useSceneGeneration() {
    const { t } = useTranslation()
    const savePath = useSettingsStore(state => state.savePath)
    const streamingView = useSettingsStore(state => state.useStreaming)
    const isGenerating = useSceneStore(state => state.isGenerating)
    const activePresetId = useSceneStore(state => state.activePresetId)
    const generationSessionId = useSceneStore(state => state.generationSessionId)
    const completedCount = useSceneStore(state => state.completedCount)
    const totalQueuedCount = useSceneStore(state => state.totalQueuedCount)
    const initGenerationProgress = useSceneStore(state => state.initGenerationProgress)
    const setIsGenerating = useSceneStore(state => state.setIsGenerating)
    const slot1Enabled = useAuthStore(state => state.slot1Enabled)
    const slot2Enabled = useAuthStore(state => state.slot2Enabled)
    const isVerified = useAuthStore(state => state.isVerified)
    const isVerified2 = useAuthStore(state => state.isVerified2)
    const token = useAuthStore(state => state.token)
    const token2 = useAuthStore(state => state.token2)

    useEffect(() => {
        if (!isGenerating) return

        const startWorkers = () => {
            if (!activePresetId) {
                setIsGenerating(false)
                return
            }

            const sceneState = useSceneStore.getState()
            if (sceneState.isCancelling) {
                setIsGenerating(false)
                return
            }

            const activeGeneratingMode = useGenerationStore.getState().generatingMode
            if (activeGeneratingMode && activeGeneratingMode !== 'scene') {
                setIsGenerating(false)
                toast({
                    title: t('common.error', '오류'),
                    description: activeGeneratingMode === 'main'
                        ? t('generate.conflictMain', '메인 모드에서 생성 중입니다.')
                        : t('generate.conflictStyleLab', '그림체 연구소에서 생성 중입니다.'),
                    variant: 'destructive',
                })
                return
            }

            const tokens = useAuthStore.getState().getActiveTokens()
            if (tokens.length === 0) {
                setIsGenerating(false)
                toast({
                    title: t('toast.tokenRequired.title', '토큰 필요'),
                    description: t('toast.tokenRequired.desc', '먼저 API 토큰을 검증해주세요.'),
                    variant: 'destructive',
                })
                return
            }

            if (completedCount === 0 && totalQueuedCount === 0) {
                initGenerationProgress()
            }

            if (useGenerationStore.getState().generatingMode !== 'scene') {
                useGenerationStore.getState().setGeneratingMode('scene')
            }

            const ctx: SceneWorkerContext = {
                activePresetId,
                sessionId: generationSessionId,
                savePath,
                streamingView,
                t,
            }

            const workerTokens = streamingView ? tokens.slice(0, 1) : tokens

            for (const activeToken of workerTokens) {
                if (runningSceneSlots.has(activeToken.slot)) continue
                useRotationStore.getState().onWorkerConfirmed()
                runningSceneSlots.add(activeToken.slot)
                void workerLoop(activeToken.slot, activeToken.token, ctx).finally(() => {
                    runningSceneSlots.delete(activeToken.slot)
                })
            }
        }

        startWorkers()
    }, [
        isGenerating,
        activePresetId,
        generationSessionId,
        savePath,
        streamingView,
        t,
        completedCount,
        totalQueuedCount,
        initGenerationProgress,
        setIsGenerating,
        slot1Enabled,
        slot2Enabled,
        isVerified,
        isVerified2,
        token,
        token2,
    ])

    useEffect(() => {
        if (!isGenerating && activeSceneWorkerCount === 0) {
            runningSceneSlots.clear()
        }
    }, [isGenerating])

    return {
        isGenerating,
    }
}
