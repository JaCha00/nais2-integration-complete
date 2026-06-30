import { useEffect, useMemo, useState } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import { relaunch } from '@tauri-apps/plugin-process'
import { AlertTriangle, Loader2, RefreshCw, RotateCcw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from '@/components/ui/use-toast'
import {
    formatStoreSnapshotTimestamp,
    listStoreSnapshots,
    restoreStoreSnapshot,
    type StoreSnapshotGroup,
} from '@/lib/store-snapshots'

interface StoreSnapshotRestoreDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
}

export function StoreSnapshotRestoreDialog({ open, onOpenChange }: StoreSnapshotRestoreDialogProps) {
    const { t } = useTranslation()
    const [groups, setGroups] = useState<StoreSnapshotGroup[]>([])
    const [selectedStoreKey, setSelectedStoreKey] = useState('')
    const [selectedRelPath, setSelectedRelPath] = useState('')
    const [loading, setLoading] = useState(false)
    const [restoring, setRestoring] = useState(false)
    const [pendingRestart, setPendingRestart] = useState(false)

    const selectedGroup = useMemo(
        () => groups.find((group) => group.storeKey === selectedStoreKey),
        [groups, selectedStoreKey],
    )

    const reload = async () => {
        setLoading(true)
        try {
            const nextGroups = await listStoreSnapshots()
            setGroups(nextGroups)
            const nextGroup = nextGroups.find((group) => group.storeKey === selectedStoreKey) ?? nextGroups[0]
            setSelectedStoreKey(nextGroup?.storeKey ?? '')
            setSelectedRelPath(nextGroup?.entries[0]?.relPath ?? '')
        } catch (error) {
            console.error('[StoreSnapshot] Failed to list store snapshots:', error)
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

    const handleStoreChange = (storeKey: string) => {
        const group = groups.find((item) => item.storeKey === storeKey)
        setSelectedStoreKey(storeKey)
        setSelectedRelPath(group?.entries[0]?.relPath ?? '')
    }

    const handleRestore = async () => {
        if (!selectedGroup || !selectedRelPath) return

        const entry = selectedGroup.entries.find((item) => item.relPath === selectedRelPath)
        const label = entry ? formatStoreSnapshotTimestamp(entry.timestamp) : selectedRelPath
        const confirmed = window.confirm(
            `${t('settingsPage.backup.confirmRestoreDesc')}\n\n${selectedGroup.storeKey}\n${label}\n${t('settingsPage.backup.restoreWarning')}`
        )
        if (!confirmed) return

        setRestoring(true)
        try {
            const result = await restoreStoreSnapshot(selectedGroup.storeKey, selectedRelPath)
            toast({
                title: t('settingsPage.backup.imported'),
                description: t('settingsPage.backup.importedDesc', { success: result.success.length }),
                variant: 'success',
            })
            setPendingRestart(true)
        } catch (error) {
            console.error('[StoreSnapshot] Store snapshot restore failed:', error)
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
            console.error('[StoreSnapshot] Relaunch failed:', error)
        }
        window.location.reload()
    }

    return (
        <Dialog open={open} onOpenChange={(nextOpen) => !restoring && onOpenChange(nextOpen)}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>{t('settingsPage.backup.restoreStoreSnapshots')}</DialogTitle>
                    <DialogDescription>
                        {t('settingsPage.backup.restoreStoreSnapshotsDesc')}
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>
                            {loading
                                ? t('settingsPage.backup.loadingSnapshots')
                                : t('settingsPage.backup.storeSnapshotCount', { count: groups.length })}
                        </span>
                        <Button variant="ghost" size="sm" onClick={reload} disabled={loading || restoring}>
                            <RefreshCw className={`h-3 w-3 mr-1 ${loading ? 'animate-spin' : ''}`} />
                            {t('common.change', 'Refresh')}
                        </Button>
                    </div>

                    {groups.length > 0 && selectedGroup ? (
                        <div className="space-y-3">
                            <div className="space-y-1">
                                <p className="text-xs font-medium text-muted-foreground">
                                    {t('settingsPage.backup.storeSnapshotSelectStore')}
                                </p>
                                <Select value={selectedStoreKey} onValueChange={handleStoreChange} disabled={restoring}>
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {groups.map((group) => (
                                            <SelectItem key={group.storeKey} value={group.storeKey}>
                                                {group.storeKey.replace('nais2-', '')}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="space-y-1">
                                <p className="text-xs font-medium text-muted-foreground">
                                    {t('settingsPage.backup.storeSnapshotSelectSnapshot')}
                                </p>
                                <Select value={selectedRelPath} onValueChange={setSelectedRelPath} disabled={restoring}>
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {selectedGroup.entries.map((entry) => (
                                            <SelectItem key={entry.relPath} value={entry.relPath}>
                                                {formatStoreSnapshotTimestamp(entry.timestamp)}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                    ) : (
                        <div className="rounded-lg border border-border/50 bg-muted/20 p-4 text-sm text-muted-foreground">
                            {t('settingsPage.backup.storeSnapshotEmpty')}
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
                            <Button onClick={handleRestore} disabled={!selectedGroup || !selectedRelPath || restoring}>
                                {restoring ? (
                                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                ) : (
                                    <RotateCcw className="h-4 w-4 mr-2" />
                                )}
                                {t('settingsPage.backup.storeSnapshotRestore')}
                            </Button>
                        )}
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
