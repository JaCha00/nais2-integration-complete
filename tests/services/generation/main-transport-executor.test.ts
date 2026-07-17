import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GenerateImageResult, GenerationParams } from '@/services/novelai-types'

const provider = vi.hoisted(() => ({
    generateImage: vi.fn(),
    generateImageStream: vi.fn(),
}))

vi.mock('@/services/novelai-api', () => ({
    generateImage: provider.generateImage,
    generateImageStream: provider.generateImageStream,
}))

import { executeMainGenerationTransport } from '@/services/generation/main-transport-executor'

const params: GenerationParams = {
    prompt: 'transport fixture',
    negative_prompt: '',
    model: 'nai-diffusion-4-full',
    width: 832,
    height: 1216,
    steps: 28,
    cfg_scale: 6,
    cfg_rescale: 0,
    sampler: 'k_euler',
    scheduler: 'native',
    smea: false,
    smea_dyn: false,
    variety: false,
    seed: 42,
}

const standardResult: GenerateImageResult = { success: true, imageData: 'standard-result' }
const streamResult: GenerateImageResult = { success: true, imageData: 'stream-result' }

function request(overrides: Partial<Parameters<typeof executeMainGenerationTransport>[0]> = {}) {
    return {
        token: 'credential',
        params,
        imageFormat: 'png' as const,
        streaming: false,
        signal: new AbortController().signal,
        shouldPublishProgress: vi.fn(() => true),
        onProgress: vi.fn(),
        ...overrides,
    }
}

describe('Main generation transport executor', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        provider.generateImage.mockResolvedValue(standardResult)
        provider.generateImageStream.mockResolvedValue(streamResult)
    })

    it('uses the standard provider transport unchanged when streaming is disabled', async () => {
        const input = request()

        await expect(executeMainGenerationTransport(input)).resolves.toBe(standardResult)

        expect(provider.generateImage).toHaveBeenCalledWith(input.token, input.params, input.signal)
        expect(provider.generateImageStream).not.toHaveBeenCalled()
        expect(input.shouldPublishProgress).not.toHaveBeenCalled()
        expect(input.onProgress).not.toHaveBeenCalled()
    })

    it('forwards streaming progress with a format-aware data URL preview', async () => {
        provider.generateImageStream.mockImplementation(async (
            _token: string,
            _params: GenerationParams,
            onProgress: (progress: number, partialImage?: string) => void,
        ) => {
            onProgress(36, 'partial-image')
            onProgress(52)
            return streamResult
        })
        const input = request({ streaming: true, imageFormat: 'webp' })

        await expect(executeMainGenerationTransport(input)).resolves.toBe(streamResult)

        expect(provider.generateImage).not.toHaveBeenCalled()
        expect(provider.generateImageStream).toHaveBeenCalledWith(
            input.token,
            input.params,
            expect.any(Function),
            input.signal,
        )
        expect(input.onProgress).toHaveBeenNthCalledWith(1, 36, 'data:image/webp;base64,partial-image')
        expect(input.onProgress).toHaveBeenNthCalledWith(2, 52, undefined)
    })

    it('normalizes PNG previews before returning the untouched provider result', async () => {
        provider.generateImageStream.mockImplementation(async (
            _token: string,
            _params: GenerationParams,
            onProgress: (progress: number, partialImage?: string) => void,
        ) => {
            onProgress(100, 'final-preview')
            return streamResult
        })
        const input = request({ streaming: true })

        await expect(executeMainGenerationTransport(input)).resolves.toBe(streamResult)

        expect(input.onProgress).toHaveBeenCalledWith(100, 'data:image/png;base64,final-preview')
    })

    it('drops stale progress without changing the provider result', async () => {
        provider.generateImageStream.mockImplementation(async (
            _token: string,
            _params: GenerationParams,
            onProgress: (progress: number, partialImage?: string) => void,
        ) => {
            onProgress(71, 'stale-preview')
            return streamResult
        })
        const input = request({
            streaming: true,
            shouldPublishProgress: vi.fn(() => false),
        })

        await expect(executeMainGenerationTransport(input)).resolves.toBe(streamResult)

        expect(input.shouldPublishProgress).toHaveBeenCalledOnce()
        expect(input.onProgress).not.toHaveBeenCalled()
    })
})
