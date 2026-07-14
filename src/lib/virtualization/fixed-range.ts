export interface FixedVirtualRange {
    start: number
    end: number
}

/** DOM-free, end-exclusive fixed-row window shared by large list shells. */
export function calculateFixedVirtualRange({
    itemCount,
    scrollTop,
    viewportHeight,
    rowHeight = 68,
    overscan = 5,
}: {
    itemCount: number
    scrollTop: number
    viewportHeight: number
    rowHeight?: number
    overscan?: number
}): FixedVirtualRange {
    const count = Number.isFinite(itemCount) ? Math.max(0, Math.trunc(itemCount)) : 0
    if (count === 0) return { start: 0, end: 0 }

    const height = Number.isFinite(rowHeight) && rowHeight > 0 ? rowHeight : 68
    const padding = Number.isFinite(overscan) ? Math.max(0, Math.trunc(overscan)) : 0
    const top = Number.isFinite(scrollTop) ? Math.max(0, scrollTop) : 0
    const viewport = Number.isFinite(viewportHeight) ? Math.max(0, viewportHeight) : 0
    const firstVisible = Math.min(count - 1, Math.floor(top / height))
    const visibleCount = Math.max(1, Math.ceil(viewport / height))

    return {
        start: Math.max(0, firstVisible - padding),
        end: Math.min(count, firstVisible + visibleCount + padding),
    }
}
