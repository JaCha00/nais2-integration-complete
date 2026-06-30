export interface Tag {
    label: string
    value: string
    count: number
    type: string
}

export interface IndexedTag extends Tag {
    _lower: string
}

interface AutocompleteTagIndex {
    all: IndexedTag[]
    byFirstChar: Record<string, IndexedTag[]>
}

let tagsPromise: Promise<Tag[]> | null = null
let autocompleteIndexPromise: Promise<AutocompleteTagIndex> | null = null

// Shared by AutocompleteTextarea and tag-matcher so the large tags JSON stays out of
// the startup bundle and is fetched only after a tag feature is actually used.
export function loadTags(): Promise<Tag[]> {
    if (!tagsPromise) {
        tagsPromise = import('@/assets/tags.json').then(module => module.default as Tag[])
    }

    return tagsPromise
}

export function loadAutocompleteTagIndex(): Promise<AutocompleteTagIndex> {
    if (!autocompleteIndexPromise) {
        autocompleteIndexPromise = loadTags().then(tags => {
            const all = tags.map(tag => ({
                ...tag,
                _lower: tag.label.toLowerCase(),
            }))

            const byFirstChar: Record<string, IndexedTag[]> = {}
            for (const tag of all) {
                const firstChar = tag._lower[0] || '_'
                if (!byFirstChar[firstChar]) byFirstChar[firstChar] = []
                byFirstChar[firstChar].push(tag)
            }

            return { all, byFirstChar }
        })
    }

    return autocompleteIndexPromise
}
