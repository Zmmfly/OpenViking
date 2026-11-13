import { useAppConnection } from '#/features/connection/hooks/use-app-connection'
import { useIdentityScopeGuard } from '#/features/connection/hooks/use-identity-scope-guard'
import { usePeers } from '#/features/workbench/peers/lib/use-peers'
import { useSessionTitles } from '#/features/workbench/sessions/lib/use-session-titles'
import { useCreateSession } from '#/features/workbench/sessions/lib/use-sessions'
import { normalizeOvClientError } from '#/shared/api/ov-client/index'
import { Button } from '#/shared/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#/shared/ui/dialog'
import { useNavigate } from '@tanstack/react-router'
import { LoaderCircleIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

export function NewSessionDialog({
  open,
  onOpenChange,
  peerId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  peerId?: string
}) {
  const { t } = useTranslation('account')
  const { identityScopeKey } = useAppConnection()
  const isCurrentScope = useIdentityScopeGuard(identityScopeKey)
  const { setTitle } = useSessionTitles(identityScopeKey)
  const peers = usePeers(open)
  const create = useCreateSession()
  const navigate = useNavigate()
  const [selected, setSelected] = useState(peerId ?? '')
  useEffect(() => {
    if (open) {
      setSelected(peerId ?? '')
      create.reset()
    }
  }, [open, peerId])
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!create.isPending) onOpenChange(value)
      }}
    >
      <DialogContent>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            if (create.isPending) return
            const sourceScope = identityScopeKey
            create.mutate(selected ? { peerId: selected } : undefined, {
              onSuccess: (result) => {
                if (!isCurrentScope(sourceScope)) return
                setTitle(result.session_id, t('sessions:threadList.newSession'))
                onOpenChange(false)
                void navigate({
                  to: '/sessions',
                  search: { s: result.session_id },
                })
              },
            })
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('sessions:threadList.newSession')}</DialogTitle>
            <DialogDescription>{t('newSessionDescription')}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-5">
            <label className="grid gap-2 text-sm">
              {t('sessionMemoryScope')}
              <select
                className="h-10 w-full rounded-md border border-input bg-background px-3"
                value={selected}
                disabled={create.isPending}
                onChange={(event) => setSelected(event.target.value)}
              >
                <option value="">{t('selfMemory')}</option>
                {(peers.data ?? []).map((peer) => (
                  <option value={peer.id} key={peer.id}>
                    {peer.id}
                  </option>
                ))}
                {selected &&
                  !peers.data?.some((peer) => peer.id === selected) && (
                    <option value={selected}>{selected}</option>
                  )}
              </select>
            </label>
            <p className="text-xs text-muted-foreground">
              {t(selected ? 'peerSessionHint' : 'selfSessionHint')}
            </p>
            {peers.isError && (
              <p role="alert" className="text-sm text-destructive">
                {normalizeOvClientError(peers.error).message}
              </p>
            )}
            {create.isError && (
              <p role="alert" className="text-sm text-destructive">
                {create.error.message}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={create.isPending}
              onClick={() => onOpenChange(false)}
            >
              {t('cancel')}
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending && (
                <LoaderCircleIcon className="animate-spin" />
              )}
              {t('createSession')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
