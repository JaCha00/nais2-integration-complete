import {
    generateImage,
    generateImageStream,
    type GenerateImageResult,
    type GenerationParams,
} from '@/services/novelai-api'

export interface MainGenerationTransportRequest {
    token: string
    params: GenerationParams
    imageFormat: NonNullable<GenerationParams['imageFormat']>
    streaming: boolean
    signal: AbortSignal
    shouldPublishProgress: () => boolean
    onProgress: (progress: number, previewImage?: string) => void
}

/**
 * Depends only on the NovelAI client and is called by the Main store.
 * The store retains session, output, History, and CAS ownership; this boundary
 * invokes its caller-supplied gate before forwarding format-normalized previews.
 */
export async function executeMainGenerationTransport(
    request: MainGenerationTransportRequest,
): Promise<GenerateImageResult> {
    if (!request.streaming) {
        return generateImage(request.token, request.params, request.signal)
    }

    const mimeType = request.imageFormat === 'webp' ? 'image/webp' : 'image/png'
    return generateImageStream(
        request.token,
        request.params,
        (progress, partialImage) => {
            if (!request.shouldPublishProgress()) return
            request.onProgress(
                progress,
                partialImage ? `data:${mimeType};base64,${partialImage}` : undefined,
            )
        },
        request.signal,
    )
}
