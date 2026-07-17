import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { consumeOrganizerHandoff, queueOrganizerHandoff } from '@/services/organizer/handoff'

class MemorySessionStorage {
    private readonly values = new Map<string, string>()

    getItem(key: string): string | null {
        return this.values.get(key) ?? null
    }

    setItem(key: string, value: string): void {
        this.values.set(key, value)
    }

    removeItem(key: string): void {
        this.values.delete(key)
    }
}

describe('Organizer handoff', () => {
    beforeEach(() => {
        vi.stubGlobal('sessionStorage', new MemorySessionStorage())
    })

    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('preserves an optional artifact identity for a one-shot handoff', () => {
        queueOrganizerHandoff({
            path: 'C:/Pictures/queue-output.png',
            fileName: 'queue-output.png',
            artifactId: 'artifact:queue-1',
        })

        expect(consumeOrganizerHandoff()).toEqual({
            path: 'C:/Pictures/queue-output.png',
            fileName: 'queue-output.png',
            artifactId: 'artifact:queue-1',
        })
        expect(consumeOrganizerHandoff()).toBeNull()
    })

    it('keeps existing handoffs valid when no lineage is available', () => {
        queueOrganizerHandoff({ path: 'C:/Pictures/legacy.png', fileName: 'legacy.png' })

        expect(consumeOrganizerHandoff()).toEqual({
            path: 'C:/Pictures/legacy.png',
            fileName: 'legacy.png',
        })
    })
})
