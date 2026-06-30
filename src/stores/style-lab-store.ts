import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { indexedDBStorage } from '@/lib/indexed-db'
import {
    DEFAULT_STYLE_LAB_ARTISTS,
    STYLE_LAB_DEFAULT_TEMPLATE,
    WeightedPromptTag,
    applyArenaBattleResult,
    createEvolutionPlan,
    createRandomWeightedTags,
    genomeSignature,
    normalizePromptTag,
    normalizeArtistList,
    parseArtistInput,
    pickArenaPair,
    StyleLabArenaLeague,
} from '@/lib/style-lab'

export type StyleLabLeague = StyleLabArenaLeague

export interface StyleCombination {
    id: string
    tags: WeightedPromptTag[]
    elo: number
    wins: number
    losses: number
    battles: number
    favorite: boolean
    locked: boolean
    note: string
    generation: number
    createdAt: number
    updatedAt: number
    previewImage?: string
    previewPath?: string
    previewThumbnail?: string
    previewSeed?: number
    previewPrompt?: string
    previewProgress?: number
    isPreviewing?: boolean
    previewError?: string
}

export interface EvolutionLogItem {
    id: string
    timestamp: number
    generation: number
    parentIds: string[]
    childIds: string[]
    parentCount?: number
    childCount?: number
    note?: string
}

export interface StyleLabSettings {
    minTags: number
    maxTags: number
    minWeight: number
    maxWeight: number
    randomBatchCount: number
    battleLeague: StyleLabLeague
    promptTemplate: string
    previewDelayMs: number
    autoPreviewBattlePair: boolean
    evolutionParentCount: number
    evolutionChildrenCount: number
    mutationRate: number
}

interface StyleLabState {
    artists: string[]
    combinations: StyleCombination[]
    evolutionLogs: EvolutionLogItem[]
    settings: StyleLabSettings
    activeBattlePair: [string, string] | null
    isPreviewQueueRunning: boolean
    previewQueueTotal: number
    previewQueueDone: number

    addArtists: (input: string) => number
    removeArtist: (artist: string) => void
    resetArtistsToDefault: () => void
    resetLabData: () => void
    updateSettings: (settings: Partial<StyleLabSettings>) => void

    generateRandomCombinations: (count?: number) => number
    addCombinationFromTags: (tags: WeightedPromptTag[], generation?: number) => string | null
    removeCombination: (id: string) => void
    toggleFavorite: (id: string) => void
    toggleLock: (id: string) => void
    updateNote: (id: string, note: string) => void

    pickBattlePair: () => [string, string] | null
    setBattleLeague: (league: StyleLabLeague) => void
    recordBattle: (winnerId: string, loserId: string) => void

    evolve: () => string[]
    cleanup: (minBattles: number, eloBelow: number) => number

    setPreviewQueueState: (running: boolean, total?: number, done?: number) => void
    updateCombinationPreview: (id: string, patch: Partial<Pick<StyleCombination, 'previewImage' | 'previewPath' | 'previewThumbnail' | 'previewSeed' | 'previewPrompt' | 'previewProgress' | 'isPreviewing' | 'previewError'>>) => void
    clearPreviewRuntime: () => void
}

const now = () => Date.now()
const makeId = (prefix: string) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`

const defaultSettings: StyleLabSettings = {
    minTags: 5,
    maxTags: 10,
    minWeight: 0.2,
    maxWeight: 2.0,
    randomBatchCount: 8,
    battleLeague: 'all',
    promptTemplate: STYLE_LAB_DEFAULT_TEMPLATE,
    previewDelayMs: 500,
    autoPreviewBattlePair: false,
    evolutionParentCount: 6,
    evolutionChildrenCount: 8,
    mutationRate: 0.18,
}

function isTemporaryPreviewPath(path?: string): boolean {
    return Boolean(path?.startsWith('memory://'))
}

function normalizeCombinationTags(tags: WeightedPromptTag[]): WeightedPromptTag[] {
    return tags
        .map(normalizePromptTag)
        .filter(tag => tag.tag)
}

function createCombination(tags: WeightedPromptTag[], generation = 0): StyleCombination {
    return {
        id: makeId('combo'),
        tags: normalizeCombinationTags(tags),
        elo: 1200,
        wins: 0,
        losses: 0,
        battles: 0,
        favorite: false,
        locked: false,
        note: '',
        generation,
        createdAt: now(),
        updatedAt: now(),
    }
}

function shouldTouchCombinationUpdatedAt(patch: Partial<StyleCombination>): boolean {
    return patch.previewPath !== undefined ||
        patch.previewThumbnail !== undefined ||
        patch.previewSeed !== undefined ||
        patch.previewPrompt !== undefined
}

function sanitizeSettings(settings: Partial<StyleLabSettings>): StyleLabSettings {
    const merged = { ...defaultSettings, ...settings }
    const minTags = Math.max(1, Math.min(20, Math.floor(merged.minTags)))
    const maxTags = Math.max(minTags, Math.min(30, Math.floor(merged.maxTags)))
    const minWeight = Math.max(0.2, Math.min(2.0, Number(merged.minWeight)))
    const maxWeight = Math.max(minWeight, Math.min(2.0, Number(merged.maxWeight)))

    return {
        ...merged,
        minTags,
        maxTags,
        minWeight,
        maxWeight,
        randomBatchCount: Math.max(1, Math.min(100, Math.floor(merged.randomBatchCount))),
        previewDelayMs: Math.max(250, Math.min(10000, Math.floor(merged.previewDelayMs))),
        autoPreviewBattlePair: Boolean(merged.autoPreviewBattlePair),
        evolutionParentCount: Math.max(2, Math.min(50, Math.floor(merged.evolutionParentCount))),
        evolutionChildrenCount: Math.max(1, Math.min(100, Math.floor(merged.evolutionChildrenCount))),
        mutationRate: Math.max(0, Math.min(1, Number(merged.mutationRate))),
    }
}

export const useStyleLabStore = create<StyleLabState>()(
    persist(
        (set, get) => ({
            artists: DEFAULT_STYLE_LAB_ARTISTS,
            combinations: [],
            evolutionLogs: [],
            settings: defaultSettings,
            activeBattlePair: null,
            isPreviewQueueRunning: false,
            previewQueueTotal: 0,
            previewQueueDone: 0,

            addArtists: (input) => {
                const parsed = parseArtistInput(input)
                if (parsed.length === 0) return 0
                let added = 0
                set(state => {
                    const existing = new Set(state.artists.map(artist => artist.toLowerCase()))
                    const next = [...state.artists]
                    for (const artist of parsed) {
                        const key = artist.toLowerCase()
                        if (existing.has(key)) continue
                        existing.add(key)
                        next.push(artist)
                        added++
                    }
                    return { artists: normalizeArtistList(next) }
                })
                return added
            },

            removeArtist: (artist) => set(state => ({
                artists: state.artists.filter(item => item.toLowerCase() !== artist.toLowerCase()),
            })),

            resetArtistsToDefault: () => set({ artists: DEFAULT_STYLE_LAB_ARTISTS }),

            resetLabData: () => set({
                artists: DEFAULT_STYLE_LAB_ARTISTS,
                combinations: [],
                evolutionLogs: [],
                settings: defaultSettings,
                activeBattlePair: null,
                isPreviewQueueRunning: false,
                previewQueueTotal: 0,
                previewQueueDone: 0,
            }),

            updateSettings: (patch) => set(state => ({
                settings: sanitizeSettings({ ...state.settings, ...patch }),
            })),

            generateRandomCombinations: (count) => {
                const state = get()
                const target = count ?? state.settings.randomBatchCount
                const signatures = new Set(state.combinations.map(combo => genomeSignature(combo.tags)))
                const created: StyleCombination[] = []
                let attempts = 0

                while (created.length < target && attempts < target * 40) {
                    attempts++
                    const tags = createRandomWeightedTags(
                        state.artists,
                        state.settings.minTags,
                        state.settings.maxTags,
                        state.settings.minWeight,
                        state.settings.maxWeight,
                    )
                    if (tags.length === 0) break
                    const signature = genomeSignature(tags)
                    if (signatures.has(signature)) continue
                    signatures.add(signature)
                    created.push(createCombination(tags))
                }

                if (created.length > 0) {
                    set(current => ({ combinations: [...created, ...current.combinations] }))
                }
                return created.length
            },

            addCombinationFromTags: (tags, generation = 0) => {
                const normalizedTags = normalizeCombinationTags(tags)
                if (normalizedTags.length === 0) return null

                const signature = genomeSignature(normalizedTags)
                if (get().combinations.some(combo => genomeSignature(combo.tags) === signature)) return null

                const combination = createCombination(normalizedTags, generation)
                set(state => ({ combinations: [combination, ...state.combinations] }))
                return combination.id
            },

            removeCombination: (id) => set(state => ({
                combinations: state.combinations.filter(combo => combo.id !== id || combo.locked),
                activeBattlePair: state.activeBattlePair?.includes(id) ? null : state.activeBattlePair,
            })),

            toggleFavorite: (id) => set(state => ({
                combinations: state.combinations.map(combo => combo.id === id
                    ? { ...combo, favorite: !combo.favorite, updatedAt: now() }
                    : combo),
            })),

            toggleLock: (id) => set(state => ({
                combinations: state.combinations.map(combo => combo.id === id
                    ? { ...combo, locked: !combo.locked, updatedAt: now() }
                    : combo),
            })),

            updateNote: (id, note) => set(state => ({
                combinations: state.combinations.map(combo => combo.id === id
                    ? { ...combo, note, updatedAt: now() }
                    : combo),
            })),

            pickBattlePair: () => {
                const state = get()
                const pair = pickArenaPair(state.combinations, state.settings.battleLeague)
                if (!pair) {
                    set({ activeBattlePair: null })
                    return null
                }
                set({ activeBattlePair: pair })
                return pair
            },

            setBattleLeague: (league) => {
                set(state => ({ settings: { ...state.settings, battleLeague: league }, activeBattlePair: null }))
            },

            recordBattle: (winnerId, loserId) => {
                set(state => ({
                    combinations: applyArenaBattleResult(state.combinations, winnerId, loserId, now()),
                    activeBattlePair: null,
                }))
            },

            evolve: () => {
                const state = get()
                const plan = createEvolutionPlan(state.combinations, {
                    artistPool: state.artists,
                    minTags: state.settings.minTags,
                    maxTags: state.settings.maxTags,
                    minWeight: state.settings.minWeight,
                    maxWeight: state.settings.maxWeight,
                    parentCount: state.settings.evolutionParentCount,
                    childCount: state.settings.evolutionChildrenCount,
                    mutationRate: state.settings.mutationRate,
                })
                if (!plan) return []

                const children = plan.childTags.map(tags => createCombination(tags, plan.generation))

                const log: EvolutionLogItem = {
                    id: makeId('evolution'),
                    timestamp: now(),
                    generation: plan.generation,
                    parentIds: plan.parentIds,
                    childIds: children.map(child => child.id),
                    parentCount: plan.parentCount,
                    childCount: children.length,
                }

                set(current => ({
                    combinations: [...children, ...current.combinations],
                    evolutionLogs: [log, ...current.evolutionLogs].slice(0, 50),
                }))

                return children.map(child => child.id)
            },

            cleanup: (minBattles, eloBelow) => {
                const state = get()
                const removable = state.combinations.filter(combo =>
                    !combo.locked &&
                    combo.battles >= minBattles &&
                    combo.elo < eloBelow
                )
                if (removable.length === 0) return 0
                const ids = new Set(removable.map(combo => combo.id))
                set(current => ({
                    combinations: current.combinations.filter(combo => !ids.has(combo.id)),
                    activeBattlePair: current.activeBattlePair?.some(id => ids.has(id)) ? null : current.activeBattlePair,
                }))
                return removable.length
            },

            setPreviewQueueState: (running, total, done) => set(state => ({
                isPreviewQueueRunning: running,
                previewQueueTotal: total ?? state.previewQueueTotal,
                previewQueueDone: done ?? state.previewQueueDone,
            })),

            updateCombinationPreview: (id, patch) => set(state => ({
                combinations: state.combinations.map(combo => combo.id === id
                    ? { ...combo, ...patch, updatedAt: shouldTouchCombinationUpdatedAt(patch) ? now() : combo.updatedAt }
                    : combo),
            })),

            clearPreviewRuntime: () => set(state => ({
                combinations: state.combinations.map(combo => (
                    combo.previewProgress || combo.isPreviewing
                        ? { ...combo, previewProgress: 0, isPreviewing: false }
                        : combo
                )),
                isPreviewQueueRunning: false,
                previewQueueTotal: 0,
                previewQueueDone: 0,
            })),
        }),
        {
            name: 'nais2-style-lab',
            storage: createJSONStorage(() => indexedDBStorage),
            partialize: (state) => ({
                artists: state.artists,
                combinations: state.combinations.map(combo => {
                    const previewPath = isTemporaryPreviewPath(combo.previewPath) ? undefined : combo.previewPath
                    return {
                        ...combo,
                        tags: normalizeCombinationTags(combo.tags),
                        previewPath,
                        previewImage: undefined,
                        previewThumbnail: combo.previewThumbnail,
                        previewProgress: 0,
                        isPreviewing: false,
                        previewError: undefined,
                    }
                }),
                evolutionLogs: state.evolutionLogs,
                settings: state.settings,
                activeBattlePair: state.activeBattlePair,
            }),
            onRehydrateStorage: () => (state) => {
                if (!state) return
                state.artists = normalizeArtistList(state.artists?.length ? state.artists : DEFAULT_STYLE_LAB_ARTISTS)
                state.settings = sanitizeSettings(state.settings || defaultSettings)
                state.combinations = (state.combinations || []).map(combo => ({
                    ...combo,
                    tags: normalizeCombinationTags(combo.tags || []),
                    elo: combo.elo ?? 1200,
                    wins: combo.wins ?? 0,
                    losses: combo.losses ?? 0,
                    battles: combo.battles ?? 0,
                    favorite: combo.favorite ?? false,
                    locked: combo.locked ?? false,
                    note: combo.note ?? '',
                    generation: combo.generation ?? 0,
                    createdAt: combo.createdAt ?? now(),
                    updatedAt: combo.updatedAt ?? now(),
                    previewPath: isTemporaryPreviewPath(combo.previewPath) ? undefined : combo.previewPath,
                    previewImage: undefined,
                    previewThumbnail: combo.previewThumbnail,
                    previewProgress: 0,
                    isPreviewing: false,
                    previewError: undefined,
                }))
                state.evolutionLogs = state.evolutionLogs || []
                state.isPreviewQueueRunning = false
                state.previewQueueTotal = 0
                state.previewQueueDone = 0
            },
        }
    )
)
