import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { indexedDBStorage } from '@/lib/indexed-db'

export interface PromptWindow {
    id: string
    title: string
    text: string
    excluded: boolean
}

export interface PromptTab {
    id: string
    name: string
    windows: PromptWindow[]
}

interface PromptLibraryState {
    tabs: PromptTab[]
    activeLeftId: string | null
    activeRightId: string | null

    addTab: (name?: string) => string
    renameTab: (id: string, name: string) => void
    deleteTab: (id: string) => void
    setActive: (column: 'left' | 'right', id: string) => void

    addWindow: (tabId: string, title?: string) => void
    deleteWindow: (tabId: string, windowId: string) => void
    renameWindow: (tabId: string, windowId: string, title: string) => void
    toggleExcluded: (tabId: string, windowId: string) => void
    moveWindow: (tabId: string, windowId: string, dir: -1 | 1) => void
    setWindowText: (tabId: string, windowId: string, text: string) => void

    importFromEditorState: (state: unknown) => boolean
    importFile: (json: unknown) => boolean
}

type JsonRecord = Record<string, unknown>

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8)

const asRecord = (value: unknown): JsonRecord | null =>
    value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : null

const readString = (value: unknown, fallback: string) =>
    typeof value === 'string' && value.trim().length > 0 ? value : fallback

function makeWindow(title: string, text = '', excluded = false): PromptWindow {
    return { id: uid(), title, text, excluded }
}

function tagsToText(tags: unknown): string {
    return Array.isArray(tags) ? tags.map(item => String(item)).join(', ') : ''
}

function convertEditorState(source: unknown): { tabs: PromptTab[]; activeLeftId: string | null; activeRightId: string | null } | null {
    const state = asRecord(source)
    if (!state) return null

    const globalTabs = Array.isArray(state.globalTabs) ? state.globalTabs : null
    const tabPanes = asRecord(state.tabPanes)
    if (!globalTabs || !tabPanes) return null

    const tabs: PromptTab[] = globalTabs.map((tabSource) => {
        const tab = asRecord(tabSource) ?? {}
        const tabId = String(tab.id ?? uid())
        const pane = asRecord(tabPanes[tabId])
        const promptWindows = Array.isArray(pane?.promptWindows) ? pane.promptWindows : []

        const windows = promptWindows.map((windowSource) => {
            const promptWindow = asRecord(windowSource) ?? {}
            return makeWindow(
                readString(promptWindow.title, 'Untitled'),
                tagsToText(promptWindow.tags),
                promptWindow.isExcluded === true
            )
        })

        return {
            id: tabId,
            name: readString(tab.name, 'Untitled tab'),
            windows,
        }
    })

    if (tabs.length === 0) return null

    const hasTab = (id: unknown) => tabs.some(tab => tab.id === String(id))

    return {
        tabs,
        activeLeftId: hasTab(state.activeLeftTabId) ? String(state.activeLeftTabId) : tabs[0].id,
        activeRightId: hasTab(state.activeRightTabId) ? String(state.activeRightTabId) : (tabs[1]?.id ?? tabs[0].id),
    }
}

function convertFragmentExport(source: unknown): PromptTab[] | null {
    const state = asRecord(source)
    const contents = asRecord(state?.contents)
    if (!state || !Array.isArray(state.meta) || !contents) return null

    const windowsByFolder = new Map<string, PromptWindow[]>()

    for (const metaSource of state.meta) {
        const meta = asRecord(metaSource)
        if (!meta) continue

        const id = String(meta.id ?? '')
        const folder = readString(meta.folder, '').trim() || 'Uncategorized'
        const lines = Array.isArray(contents[id]) ? contents[id].map(item => String(item)) : []
        const window = makeWindow(readString(meta.name, 'untitled'), lines.join('\n'))

        const folderWindows = windowsByFolder.get(folder) ?? []
        folderWindows.push(window)
        windowsByFolder.set(folder, folderWindows)
    }

    const tabs = [...windowsByFolder.entries()].map(([name, windows]) => ({
        id: uid(),
        name: `Fragments: ${name}`,
        windows,
    }))

    return tabs.length > 0 ? tabs : null
}

function updateWindow(
    tabs: PromptTab[],
    tabId: string,
    windowId: string,
    updater: (window: PromptWindow) => PromptWindow
): PromptTab[] {
    return tabs.map(tab => tab.id !== tabId
        ? tab
        : { ...tab, windows: tab.windows.map(window => window.id === windowId ? updater(window) : window) })
}

function cloneWithFreshIds(tabs: PromptTab[]): PromptTab[] {
    return tabs.map(tab => ({
        id: uid(),
        name: tab.name,
        windows: tab.windows.map(window => ({ ...window, id: uid() })),
    }))
}

export const usePromptLibraryStore = create<PromptLibraryState>()(
    persist(
        (set, get) => ({
            tabs: [],
            activeLeftId: null,
            activeRightId: null,

            addTab: (name) => {
                const tab: PromptTab = {
                    id: uid(),
                    name: name || `Prompt tab ${get().tabs.length + 1}`,
                    windows: [],
                }

                set(state => ({
                    tabs: [...state.tabs, tab],
                    activeLeftId: state.activeLeftId ?? tab.id,
                    activeRightId: state.activeRightId ?? tab.id,
                }))

                return tab.id
            },

            renameTab: (id, name) => set(state => ({
                tabs: state.tabs.map(tab => tab.id === id ? { ...tab, name } : tab),
            })),

            deleteTab: (id) => set(state => {
                const tabs = state.tabs.filter(tab => tab.id !== id)
                const fallback = tabs[0]?.id ?? null

                return {
                    tabs,
                    activeLeftId: state.activeLeftId === id ? fallback : state.activeLeftId,
                    activeRightId: state.activeRightId === id ? fallback : state.activeRightId,
                }
            }),

            setActive: (column, id) => set(column === 'left' ? { activeLeftId: id } : { activeRightId: id }),

            addWindow: (tabId, title) => set(state => ({
                tabs: state.tabs.map(tab => tab.id !== tabId
                    ? tab
                    : {
                        ...tab,
                        windows: [...tab.windows, makeWindow(title || `Prompt ${tab.windows.length + 1}`)],
                    }),
            })),

            deleteWindow: (tabId, windowId) => set(state => ({
                tabs: state.tabs.map(tab => tab.id !== tabId
                    ? tab
                    : { ...tab, windows: tab.windows.filter(window => window.id !== windowId) }),
            })),

            renameWindow: (tabId, windowId, title) => set(state => ({
                tabs: updateWindow(state.tabs, tabId, windowId, window => ({ ...window, title })),
            })),

            toggleExcluded: (tabId, windowId) => set(state => ({
                tabs: updateWindow(state.tabs, tabId, windowId, window => ({ ...window, excluded: !window.excluded })),
            })),

            moveWindow: (tabId, windowId, dir) => set(state => ({
                tabs: state.tabs.map(tab => {
                    if (tab.id !== tabId) return tab

                    const sourceIndex = tab.windows.findIndex(window => window.id === windowId)
                    const targetIndex = sourceIndex + dir

                    if (sourceIndex < 0 || targetIndex < 0 || targetIndex >= tab.windows.length) return tab

                    const windows = [...tab.windows]
                    ;[windows[sourceIndex], windows[targetIndex]] = [windows[targetIndex], windows[sourceIndex]]
                    return { ...tab, windows }
                }),
            })),

            setWindowText: (tabId, windowId, text) => set(state => ({
                tabs: updateWindow(state.tabs, tabId, windowId, window => ({ ...window, text })),
            })),

            importFromEditorState: (source) => {
                const converted = convertEditorState(source)
                if (!converted) return false
                set(converted)
                return true
            },

            importFile: (json) => {
                const editor = convertEditorState(json)
                const tabs = editor ? cloneWithFreshIds(editor.tabs) : convertFragmentExport(json)
                if (!tabs || tabs.length === 0) return false

                set(state => ({
                    tabs: [...state.tabs, ...tabs],
                    activeLeftId: state.activeLeftId ?? tabs[0].id,
                    activeRightId: tabs[0].id,
                }))

                return true
            },
        }),
        {
            name: 'nais2-prompt-library',
            storage: createJSONStorage(() => indexedDBStorage),
            // This store stays inside B's IndexedDB/export pipeline. Phase 2 may add
            // store-level snapshots, but this phase deliberately avoids A's backup hook.
            onRehydrateStorage: () => (state) => {
                if (!state) return

                let migrated = false
                for (const tab of state.tabs) {
                    for (const window of tab.windows as Array<PromptWindow & { tags?: unknown }>) {
                        if (typeof window.text !== 'string') {
                            window.text = tagsToText(window.tags)
                            delete window.tags
                            migrated = true
                        }
                    }
                }

                if (migrated) {
                    console.log('[PromptLibrary] Migrated chip tag windows to text windows')
                }

                if (state.tabs.length > 0 || typeof localStorage === 'undefined') return

                try {
                    const legacy = localStorage.getItem('novelaiPromptEditorState')
                    const converted = legacy ? convertEditorState(JSON.parse(legacy)) : null
                    if (converted) {
                        state.tabs = converted.tabs
                        state.activeLeftId = converted.activeLeftId
                        state.activeRightId = converted.activeRightId
                    }
                } catch (error) {
                    console.warn('[PromptLibrary] Legacy prompt editor migration failed', error)
                }
            },
        }
    )
)
