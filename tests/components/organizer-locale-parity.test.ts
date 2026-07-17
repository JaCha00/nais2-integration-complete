import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import en from '@/i18n/locales/en.json'
import ja from '@/i18n/locales/ja.json'
import ko from '@/i18n/locales/ko.json'

type LocaleTree = Record<string, unknown>

const locales = { en, ko, ja } as const

function leafKeys(value: unknown, prefix = ''): string[] {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [prefix]
    return Object.entries(value as LocaleTree)
        .flatMap(([key, child]) => leafKeys(child, prefix ? `${prefix}.${key}` : key))
        .sort()
}

function getPath(value: unknown, path: string): unknown {
    return path.split('.').reduce<unknown>((current, segment) => {
        if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined
        return (current as LocaleTree)[segment]
    }, value)
}

describe('Organizer locale contract', () => {
    it('keeps the English, Korean, and Japanese Organizer keys aligned', () => {
        const englishKeys = leafKeys(en.organizer)

        expect(leafKeys(ko.organizer)).toEqual(englishKeys)
        expect(leafKeys(ja.organizer)).toEqual(englishKeys)
        expect(englishKeys.length).toBeGreaterThan(80)
    })

    it('defines every Organizer translation used by the page and keeps dynamic values technical', () => {
        const source = readFileSync(resolve(process.cwd(), 'src/pages/Organizer.tsx'), 'utf8')
        const referencedKeys = [...source.matchAll(/t\(['"](organizer\.[^'"]+)['"]/g)]
            .map(match => match[1])

        expect(referencedKeys.length).toBeGreaterThan(70)
        for (const [locale, messages] of Object.entries(locales)) {
            for (const key of new Set(referencedKeys)) {
                const value = getPath(messages, key)
                expect(value, `${locale} is missing ${key}`).toBeTypeOf('string')
                expect((value as string).trim(), `${locale} has an empty ${key}`).not.toBe('')
            }
        }

        for (const migratedUserString of [
            'Thumbnail grid size',
            'Select an image to check conflicts.',
            'This WebView cannot prove lossless WebP conversion.',
            'Optional R2 follow-up',
            'Organizer execution progress',
            'Artifact record connected:',
        ]) expect(source).not.toContain(migratedUserString)

        expect(source).toContain('latestSelectedRecord.artifactId')
        expect(source).toContain('entry.file.fileName')
        expect(source).toContain('event.code')
    })
})
