/**
 * Stable bridge between page-level command docks and ThreeColumnLayout.
 * Keeping these names outside either component prevents an import cycle while
 * the layout remains the sole owner of prompt/history Sheet state.
 */
export const LAYOUT_SHEET_EVENTS = {
    OPEN_PROMPT: 'nais2:open-prompt-sheet',
    OPEN_HISTORY: 'nais2:open-history-sheet',
} as const
