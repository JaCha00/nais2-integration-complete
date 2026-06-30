import { useEffect, useState } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import { relaunch } from '@tauri-apps/plugin-process'
import { AlertTriangle, Loader2, RefreshCw, RotateCcw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from '@/components/ui/use-toast'
import {
    formatAutoBackupTimestamp,
    listFullAutoBackups,
    restoreFullAutoBackup,
    type FullAutoBackupEntry,
} from '@/lib/auto-backup'

interface RestoreDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
}

export function RestoreDialog({ open, onOpenChange }: RestoreDialogProps) {
    const { t } = useTranslation()
    const [entries, setEntries] = useState<FullAutoBackupEntry[]>([])
    const [selectedRelPath, setSelectedRelPath] = useState('')
    const [loading, setLoading] = useState(false)
    const [restoring, setRestoring] = useState(false)
    const [pendingRestart, setPendingRestart] = useState(false)

    const reload = async () => {
        setLoading(true)
        try {
            const nextEntries = await listFullAutoBackups()
            setEntries(nextEntries)
            setSelectedRelPath((current) => current || nextEntries[0]?.relPath || '')
        } catch (error) {
            console.error('[AutoBackup] Failed to list disk snapshots:', error)
            toast({
                title: t('settingsPage.backup.snapshotListFailed'),
                description: String(error),
                variant: 'destructive',
            })
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        if (open) void reload()
    }, [open])

    const handleRestore = async () => {
        if (!selectedRelPath) return
        const entry = entries.find((item) => item.relPath === selectedRelPath)
        const label = entry ? formatAutoBackupTimestamp(entry.timestamp) : selectedRelPath
        const confirmed = window.confirm(
            `${t('settingsPage.backup.confirmRestoreDesc')}\n\n${label}\n${t('settingsPage.backup.restoreWarning')}`
        )
        if (!confirmed) return

        setRestoring(true)
        try {
            const result = await restoreFullAutoBackup(selectedRelPath)
            toast({
                title: t('settingsPage.backup.imported'),
                description: t('settingsPage.backup.importedDesc', { success: result.success.length }),
                variant: 'success',
            })
            setPendingRestart(true)
        } catch (error) {
            console.error('[AutoBackup] Disk snapshot restore failed:', error)
            toast({
                title: t('settingsPage.backup.importFailed'),
                description: String(error),
                variant: 'destructive',
            })
        } finally {
            setRestoring(false)
        }
    }

    const handleRestart = async () => {
        try {
            if (isTauri()) {
                await relaunch()
                return
            }
        } catch (error) {
            console.error('[AutoBackup] Relaunch failed:', error)
        }
        window.location.reload()
    }

    return (
        <Dialog open={open} onOpenChange={(nextOpen) => !restoring && onOpenChange(nextOpen)}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>{t('settingsPage.backup.restoreSnapshots')}</DialogTitle>
                    <DialogDescription>
                        {t('settingsPage.backup.restoreSnapshotsDesc')}
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>
                            {loading
                                ? t('settingsPage.backup.loadingSnapshots')
                                : t('settingsPage.backup.snapshotCount', { count: entries.length })}
                        </span>
                        <Button variant="ghost" size="sm" onClick={reload} disabled={loading || restoring}>
                            <RefreshCw className={`h-3 w-3 mr-1 ${loading ? 'animate-spin' : ''}`} />
                            {t('common.change', 'Refresh')}
                        </Button>
                    </div>

                    {entries.length > 0 ? (
                        <Select value={selectedRelPath} onValueChange={setSelectedRelPath} disabled={restoring}>
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {entries.map((entry) => (
                                    <SelectItem key={entry.relPath} value={entry.relPath}>
                                        {formatAutoBackupTimestamp(entry.timestamp)}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    ) : (
                        <div className="rounded-lg border border-border/50 bg-muted/20 p-4 text-sm text-muted-foreground">
                            {t('settingsPage.backup.snapshotEmpty')}
                        </div>
                    )}

                    <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-3 text-xs text-yellow-700 dark:text-yellow-400">
                        <AlertTriangle className="inline h-3 w-3 mr-1" />
                        {t('settingsPage.backup.restoreWarning')}
                    </div>
                </div>

                <DialogFooter className="sm:justify-between">
                    {pendingRestart ? (
                        <span className="text-xs text-yellow-600 dark:text-yellow-400">
                            {t('settingsPage.backup.snapshotRestartRequired')}
                        </span>
                    ) : <span />}
                    <div className="flex gap-2">
                        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={restoring}>
                            {t('common.cancel', 'Close')}
                        </Button>
                        {pendingRestart ? (
                            <Button onClick={handleRestart}>
                                {t('settingsPage.backup.restartNow')}
                            </Button>
                        ) : (
                            <Button onClick={handleRestore} disabled={!selectedRelPath || restoring || entries.length === 0}>
                                {restoring ? (
                                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                ) : (
                                    <RotateCcw className="h-4 w-4 mr-2" />
                                )}
                                {t('settingsPage.backup.snapshotRestore')}
                            </Button>
                        )}
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
