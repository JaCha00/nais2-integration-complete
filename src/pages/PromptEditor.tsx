import { useRef, useState, type ChangeEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { usePromptLibraryStore, type PromptTab, type PromptWindow } from '@/stores/prompt-library-store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AutocompleteTextarea } from '@/components/ui/AutocompleteTextarea'
import { DanbooruTagVerifyDialog } from '@/components/prompt/DanbooruTagVerifyDialog'
import { supportsLocalTaggerSidecar } from '@/platform/runtime'
import { toast } from '@/components/ui/use-toast'
import { cn } from '@/lib/utils'
import {
    Plus,
    Copy,
    Trash2,
    Pencil,
    ChevronUp,
    ChevronDown,
    CopyCheck,
    Upload,
    EyeOff,
    Eye,
    ShieldCheck,
} from 'lucide-react'

interface CopyMessages {
    empty: string
    copied: string
    failed: string
}

async function copyText(text: string, label: string, messages: CopyMessages) {
    if (!text.trim()) {
        toast({ title: messages.empty, variant: 'destructive' })
        return
    }

    try {
        await navigator.clipboard.writeText(text)
        toast({ title: messages.copied, description: label, variant: 'success' })
        return
    } catch {
        // Tauri and older WebViews may not expose clipboard permissions; use the DOM fallback below.
    }

    try {
        const textarea = document.createElement('textarea')
        textarea.value = text
        textarea.style.position = 'fixed'
        textarea.style.opacity = '0'
        document.body.appendChild(textarea)
        textarea.select()

        const copied = document.execCommand('copy')
        document.body.removeChild(textarea)

        toast(copied
            ? { title: messages.copied, description: label, variant: 'success' }
            : { title: messages.failed, variant: 'destructive' })
    } catch {
        toast({ title: messages.failed, variant: 'destructive' })
    }
}

function WindowCard({ tabId, window, index, count }: { tabId: string; window: PromptWindow; index: number; count: number }) {
    const { t } = useTranslation()
    const { renameWindow, deleteWindow, toggleExcluded, moveWindow, setWindowText } = usePromptLibraryStore()
    const [editingTitle, setEditingTitle] = useState(false)
    const [titleValue, setTitleValue] = useState(window.title)
    const [isDanbooruOpen, setIsDanbooruOpen] = useState(false)

    const copyMessages: CopyMessages = {
        empty: t('promptEditor.copyEmptyTitle'),
        copied: t('promptEditor.copySuccessTitle'),
        failed: t('promptEditor.copyFailedTitle'),
    }

    const commitTitle = () => {
        setEditingTitle(false)
        const nextTitle = titleValue.trim()
        if (nextTitle) {
            renameWindow(tabId, window.id, nextTitle)
        } else {
            setTitleValue(window.title)
        }
    }

    return (
        <div
            className={cn(
                'rounded-control border bg-muted/20 p-2',
                window.excluded ? 'border-border/50 opacity-50' : 'border-border'
            )}
        >
            <div className="mb-2 grid grid-cols-[44px_minmax(0,1fr)] items-center gap-1 md:grid-cols-[36px_minmax(0,1fr)_auto]">
                <button
                    type="button"
                    onClick={() => toggleExcluded(tabId, window.id)}
                    title={window.excluded ? t('promptEditor.includeInCopy') : t('promptEditor.excludeFromCopy')}
                    aria-label={window.excluded ? t('promptEditor.includeInCopy') : t('promptEditor.excludeFromCopy')}
                    className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-control text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:h-9 md:w-9"
                >
                    {window.excluded ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4 text-primary" />}
                </button>

                {editingTitle ? (
                    <Input
                        autoFocus
                        value={titleValue}
                        onChange={(event) => setTitleValue(event.target.value)}
                        onBlur={commitTitle}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter') commitTitle()
                            if (event.key === 'Escape') {
                                setEditingTitle(false)
                                setTitleValue(window.title)
                            }
                        }}
                        className="h-11 min-w-0 px-2 py-0 text-sm md:h-9"
                    />
                ) : (
                    <button
                        type="button"
                        className="h-11 min-w-0 truncate rounded-control px-2 text-left text-sm font-semibold hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:h-9"
                        onClick={() => {
                            setTitleValue(window.title)
                            setEditingTitle(true)
                        }}
                    >
                        {window.title}
                    </button>
                )}

                <div className="col-span-2 flex flex-wrap justify-end gap-1 border-t border-border/60 pt-1 md:col-span-1 md:border-0 md:pt-0">
                    <button
                        type="button"
                        onClick={() => copyText(window.text, t('promptEditor.copyWindowDescription', { title: window.title }), copyMessages)}
                        title={t('promptEditor.copyWindow')}
                        aria-label={t('promptEditor.copyWindow')}
                        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-control text-muted-foreground hover:bg-accent hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:h-9 md:w-9"
                    >
                        <Copy className="h-4 w-4" />
                    </button>
                    <button
                        type="button"
                        onClick={() => setIsDanbooruOpen(true)}
                        disabled={!supportsLocalTaggerSidecar || !window.text.trim()}
                        title={supportsLocalTaggerSidecar
                            ? t('promptEditor.verifyDanbooru', 'Danbooru 실검증')
                            : t('promptEditor.verifyDanbooruDesktopOnly', '데스크톱에서만 사용할 수 있습니다')}
                        aria-label={t('promptEditor.verifyDanbooru', 'Danbooru 실검증')}
                        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-control text-muted-foreground hover:bg-accent hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-30 md:h-9 md:w-9"
                    >
                        <ShieldCheck className="h-4 w-4" />
                    </button>
                    <button
                        type="button"
                        onClick={() => moveWindow(tabId, window.id, -1)}
                        disabled={index === 0}
                        title={t('promptEditor.moveUp')}
                        aria-label={t('promptEditor.moveUp')}
                        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-control text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-30 md:h-9 md:w-9"
                    >
                        <ChevronUp className="h-4 w-4" />
                    </button>
                    <button
                        type="button"
                        onClick={() => moveWindow(tabId, window.id, 1)}
                        disabled={index === count - 1}
                        title={t('promptEditor.moveDown')}
                        aria-label={t('promptEditor.moveDown')}
                        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-control text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-30 md:h-9 md:w-9"
                    >
                        <ChevronDown className="h-4 w-4" />
                    </button>
                    <button
                        type="button"
                        onClick={() => deleteWindow(tabId, window.id)}
                        title={t('promptEditor.deleteWindow')}
                        aria-label={t('promptEditor.deleteWindow')}
                        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-control text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:h-9 md:w-9"
                    >
                        <Trash2 className="h-4 w-4" />
                    </button>
                </div>
            </div>

            <AutocompleteTextarea
                value={window.text}
                onChange={(event) => setWindowText(tabId, window.id, event.target.value)}
                placeholder={t('promptEditor.promptPlaceholder')}
                className="min-h-[88px] w-full rounded-control border border-border bg-canvas px-3 py-2 text-sm"
            />
            {/* Android/iOS do not bundle the local Python sidecar, so the capability gate owns both trigger and dialog. */}
            {supportsLocalTaggerSidecar && (
                <DanbooruTagVerifyDialog
                    open={isDanbooruOpen}
                    onOpenChange={setIsDanbooruOpen}
                    prompt={window.text}
                    onApply={(nextPrompt) => {
                        setWindowText(tabId, window.id, nextPrompt)
                        setIsDanbooruOpen(false)
                        toast({
                            title: t('promptEditor.danbooruApplied', 'Danbooru 검증 결과가 반영되었습니다'),
                            variant: 'success',
                        })
                    }}
                />
            )}
        </div>
    )
}

function TabColumn({ column }: { column: 'left' | 'right' }) {
    const { t } = useTranslation()
    const { tabs, activeLeftId, activeRightId, setActive, addTab, renameTab, deleteTab, addWindow } = usePromptLibraryStore()
    const activeId = column === 'left' ? activeLeftId : activeRightId
    const tab: PromptTab | undefined = tabs.find(item => item.id === activeId) ?? tabs[0]
    const [editingTab, setEditingTab] = useState(false)
    const [tabName, setTabName] = useState('')

    const copyMessages: CopyMessages = {
        empty: t('promptEditor.copyEmptyTitle'),
        copied: t('promptEditor.copySuccessTitle'),
        failed: t('promptEditor.copyFailedTitle'),
    }

    const copyAll = () => {
        if (!tab) return

        const joined = tab.windows
            .filter(window => !window.excluded)
            .map(window => window.text.trim())
            .filter(Boolean)
            .join(', ')

        void copyText(joined, t('promptEditor.copyAllDescription', { name: tab.name }), copyMessages)
    }

    const commitTabName = () => {
        setEditingTab(false)
        const nextName = tabName.trim()
        if (tab && nextName) {
            renameTab(tab.id, nextName)
        }
    }

    return (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-panel border border-border bg-card">
            <div className="flex flex-wrap items-center gap-1 border-b border-border p-1.5">
                {tabs.map(item => (
                    <button
                        key={item.id}
                        type="button"
                        onClick={() => setActive(column, item.id)}
                        aria-pressed={item.id === tab?.id}
                        className={cn(
                            'min-h-11 max-w-40 truncate rounded-control px-3 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:min-h-9',
                            item.id === tab?.id
                                ? 'bg-primary/20 font-semibold text-primary'
                                : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                        )}
                    >
                        {item.name}
                    </button>
                ))}
                <button
                    type="button"
                    onClick={() => {
                        const id = addTab()
                        setActive(column, id)
                    }}
                    title={t('promptEditor.addTab')}
                    aria-label={t('promptEditor.addTab')}
                    className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-control text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:h-9 md:w-9"
                >
                    <Plus className="h-4 w-4" />
                </button>
            </div>

            {!tab ? (
                <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
                    {t('promptEditor.noTabs')}
                </div>
            ) : (
                <>
                    <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-2 py-1.5">
                        {editingTab ? (
                            <Input
                                autoFocus
                                value={tabName}
                                onChange={(event) => setTabName(event.target.value)}
                                onBlur={commitTabName}
                                onKeyDown={(event) => {
                                    if (event.key === 'Enter') commitTabName()
                                    if (event.key === 'Escape') setEditingTab(false)
                                }}
                                className="h-11 min-w-0 flex-[1_1_12rem] text-sm md:h-9"
                            />
                        ) : (
                            <div className="min-w-0 flex-[1_1_12rem] truncate text-sm font-semibold">{tab.name}</div>
                        )}

                        <Button
                            size="sm"
                            variant="ghost"
                            className="h-11 w-11 px-0 md:h-9 md:w-9"
                            onClick={() => {
                                setTabName(tab.name)
                                setEditingTab(true)
                            }}
                            title={t('promptEditor.renameTab')}
                            aria-label={t('promptEditor.renameTab')}
                        >
                            <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="sm" variant="ghost" className="h-11 px-3 md:h-9" onClick={copyAll} title={t('promptEditor.copyAll')} aria-label={t('promptEditor.copyAll')}>
                            <CopyCheck className="h-4 w-4 sm:mr-1" />
                            <span className="hidden sm:inline">{t('promptEditor.copyAll')}</span>
                        </Button>
                        <Button size="sm" variant="ghost" className="h-11 w-11 px-0 md:h-9 md:w-9" onClick={() => addWindow(tab.id)} title={t('promptEditor.addWindow')} aria-label={t('promptEditor.addWindow')}>
                            <Plus className="h-4 w-4" />
                        </Button>
                        <Button
                            size="sm"
                            variant="ghost"
                            className="h-11 w-11 px-0 text-destructive hover:bg-destructive/10 hover:text-destructive md:h-9 md:w-9"
                            onClick={() => {
                                if (window.confirm(t('promptEditor.confirmDeleteTab', { name: tab.name }))) {
                                    deleteTab(tab.id)
                                }
                            }}
                            title={t('promptEditor.deleteTab')}
                            aria-label={t('promptEditor.deleteTab')}
                        >
                            <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                    </div>

                    <div className="flex-1 space-y-2 overflow-y-auto p-2">
                        {tab.windows.length === 0 ? (
                            <div className="py-8 text-center text-sm text-muted-foreground">{t('promptEditor.noWindows')}</div>
                        ) : (
                            tab.windows.map((window, index) => (
                                <WindowCard
                                    key={window.id}
                                    tabId={tab.id}
                                    window={window}
                                    index={index}
                                    count={tab.windows.length}
                                />
                            ))
                        )}
                    </div>
                </>
            )}
        </div>
    )
}

function parseImportFile(text: string): unknown | null {
    try {
        return JSON.parse(text)
    } catch {
        return null
    }
}

export default function PromptEditor() {
    const { t } = useTranslation()
    const { tabs, addTab, importFile } = usePromptLibraryStore()
    const fileRef = useRef<HTMLInputElement>(null)
    const [mobileColumn, setMobileColumn] = useState<'left' | 'right'>('left')

    const handleImport = (event: ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(event.target.files ?? [])
        event.target.value = ''
        if (files.length === 0) return

        void Promise.all(files.map(file => file.text()))
            .then(texts => {
                let added = 0

                for (const text of texts) {
                    const parsed = parseImportFile(text)
                    if (parsed && importFile(parsed)) {
                        added += 1
                    }
                }

                toast(added > 0
                    ? {
                        title: t('promptEditor.importCompleteTitle'),
                        description: t('promptEditor.importCompleteDescription', { count: added }),
                        variant: 'success',
                    }
                    : {
                        title: t('promptEditor.importFailedTitle'),
                        description: t('promptEditor.importFailedDescription'),
                        variant: 'destructive',
                    })
            })
            .catch(() => {
                toast({
                    title: t('promptEditor.importFailedTitle'),
                    description: t('promptEditor.importFailedDescription'),
                    variant: 'destructive',
                })
            })
    }

    return (
        <div className="flex h-full min-h-0 flex-col gap-2 overflow-hidden">
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
                <h1 className="text-lg font-bold">{t('promptEditor.title')}</h1>
                <div className="flex items-center gap-2">
                    <input
                        ref={fileRef}
                        type="file"
                        accept=".json,application/json"
                        multiple
                        className="hidden"
                        onChange={handleImport}
                    />
                    <Button size="sm" variant="outline" className="h-11" onClick={() => fileRef.current?.click()}>
                        <Upload className="mr-1 h-4 w-4" />
                        {t('promptEditor.importButton')}
                    </Button>
                </div>
            </div>

            {tabs.length === 0 ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
                    <p className="text-sm">{t('promptEditor.emptyTitle')}</p>
                    <div className="flex gap-2">
                        <Button onClick={() => addTab()}>
                            <Plus className="mr-1 h-4 w-4" />
                            {t('promptEditor.newTab')}
                        </Button>
                        <Button variant="outline" onClick={() => fileRef.current?.click()}>
                            <Upload className="mr-1 h-4 w-4" />
                            {t('promptEditor.importExisting')}
                        </Button>
                    </div>
                    <p className="max-w-xl text-center text-xs">{t('promptEditor.emptyHelp')}</p>
                </div>
            ) : (
                <>
                    {/* The compact pane switch keeps both store-backed panes intact while exposing one editor at a time on phones. */}
                    <div className="grid shrink-0 grid-cols-2 rounded-control border border-border bg-card p-1 md:hidden" role="tablist" aria-label={t('promptEditor.paneSelector', '편집 패널 선택')}>
                        {(['left', 'right'] as const).map((column, index) => (
                            <button
                                key={column}
                                type="button"
                                role="tab"
                                id={`prompt-pane-tab-${column}`}
                                aria-controls={`prompt-pane-${column}`}
                                aria-selected={mobileColumn === column}
                                onClick={() => setMobileColumn(column)}
                                className={cn(
                                    'h-11 rounded-control px-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                                    mobileColumn === column ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                                )}
                            >
                                {t(index === 0 ? 'promptEditor.paneA' : 'promptEditor.paneB', `패널 ${index === 0 ? 'A' : 'B'}`)}
                            </button>
                        ))}
                    </div>
                    <div className="flex min-h-0 flex-1 gap-2">
                        <div
                            id="prompt-pane-left"
                            role="tabpanel"
                            aria-labelledby="prompt-pane-tab-left"
                            className={cn('flex min-h-0 min-w-0 flex-1', mobileColumn !== 'left' && 'hidden md:flex')}
                        >
                            <TabColumn column="left" />
                        </div>
                        <div
                            id="prompt-pane-right"
                            role="tabpanel"
                            aria-labelledby="prompt-pane-tab-right"
                            className={cn('flex min-h-0 min-w-0 flex-1', mobileColumn !== 'right' && 'hidden md:flex')}
                        >
                            <TabColumn column="right" />
                        </div>
                    </div>
                </>
            )}
        </div>
    )
}
