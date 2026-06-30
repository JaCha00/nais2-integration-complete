import { BaseDirectory, exists, mkdir } from '@tauri-apps/plugin-fs'
import { join, pictureDir } from '@tauri-apps/api/path'
import { useCharacterPromptStore } from '@/stores/character-prompt-store'
import { useRotationStore } from '@/stores/character-rotation-store'

export interface SceneOutputPathRequest {
    savePath: string
    useAbsolutePath: boolean
    presetName: string
    sceneName: string
    fileName: string
}

export interface SceneOutputPath {
    fullPath: string
    writePath: string
    baseDir?: BaseDirectory
    safePresetName: string
    safeSceneName: string
    safeCharacterName: string | null
}

export const sanitizePathComponent = (value: string, fallback: string): string =>
    value.replace(/[<>:"/\\|?*]/g, '_').trim() || fallback

export function getRotationCharacterFolderName(): string | null {
    const rotation = useRotationStore.getState()
    if (!rotation.active || !rotation.snapshot) return null

    const currentId = rotation.characterIds[rotation.currentIndex]
    if (!currentId) return null

    const character = useCharacterPromptStore.getState().characters.find(c => c.id === currentId)
    const promptLabel = character?.prompt?.split(',')[0]?.trim()
    const rawName = character?.name?.trim() || promptLabel || `Character_${rotation.currentIndex + 1}`
    return sanitizePathComponent(rawName, `Character_${rotation.currentIndex + 1}`)
}

// save-scene-result.ts writes the bytes; this helper owns only the directory
// contract shared by normal scenes and rotation scenes.
export async function resolveSceneOutputPath(request: SceneOutputPathRequest): Promise<SceneOutputPath> {
    const safePresetName = sanitizePathComponent(request.presetName || 'Default', 'Default')
    const safeSceneName = sanitizePathComponent(request.sceneName || 'Untitled_Scene', 'Untitled_Scene')
    const safeCharacterName = getRotationCharacterFolderName()
    const pathSegments = ['NAIS_Scene', safePresetName, ...(safeCharacterName ? [safeCharacterName] : []), safeSceneName]

    if (request.useAbsolutePath && request.savePath) {
        const directoryPath = await join(request.savePath, ...pathSegments)
        if (!(await exists(directoryPath))) {
            await mkdir(directoryPath, { recursive: true })
        }
        return {
            fullPath: await join(directoryPath, request.fileName),
            writePath: await join(directoryPath, request.fileName),
            safePresetName,
            safeSceneName,
            safeCharacterName,
        }
    }

    const relativeDirectory = pathSegments.join('/')
    if (!(await exists(relativeDirectory, { baseDir: BaseDirectory.Picture }))) {
        await mkdir(relativeDirectory, { baseDir: BaseDirectory.Picture, recursive: true })
    }

    return {
        fullPath: await join(await pictureDir(), relativeDirectory, request.fileName),
        writePath: `${relativeDirectory}/${request.fileName}`,
        baseDir: BaseDirectory.Picture,
        safePresetName,
        safeSceneName,
        safeCharacterName,
    }
}
