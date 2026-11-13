import { useAppConnection } from '#/features/connection/hooks/use-app-connection'
import { useIdentityScopeGuard } from '#/features/connection/hooks/use-identity-scope-guard'
import { useStudioService } from '#/features/connection/hooks/use-studio-service'
import { createPeer, isPeerId } from '#/features/workbench/peers/lib/api'
import { usePeers } from '#/features/workbench/peers/lib/use-peers'
import { NewSessionDialog } from '#/features/workbench/sessions/components/new-session-dialog'
import { normalizeOvClientError } from '#/shared/api/ov-client/index'
import { PLAIN_INPUT_PROPS } from '#/shared/lib/form-input'
import { Button } from '#/shared/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#/shared/ui/dialog'
import { Input } from '#/shared/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/shared/ui/table'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { LoaderCircleIcon, PlusIcon, RefreshCwIcon } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

export function PeersPage() {
  const { t } = useTranslation('account')
  const { connection, identityScopeKey } = useAppConnection()
  const service = useStudioService()
  const isCurrentScope = useIdentityScopeGuard(identityScopeKey)
  const peers = usePeers()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [peerId, setPeerId] = useState('')
  const [search, setSearch] = useState('')
  const [sessionPeer, setSessionPeer] = useState<string>()
  const create = useMutation({
    mutationFn: async (id: string) => ({
      peer: await createPeer(connection.userId, id),
      scope: identityScopeKey,
    }),
    onSuccess: async ({ scope }) => {
      if (!isCurrentScope(scope)) return
      setOpen(false)
      setPeerId('')
      await queryClient.invalidateQueries({
        queryKey: ['peers', identityScopeKey],
      })
      await queryClient.invalidateQueries({ queryKey: ['viking-fs-list'] })
      toast.success(t('peerCreated'))
    },
    onError: () => {
      if (isCurrentScope(identityScopeKey)) void peers.refetch()
    },
  })
  if (service.provider !== 'opensource')
    return <p role="status">{t('peersUnavailable')}</p>
  const visible = (peers.data ?? []).filter((peer) =>
    peer.id.toLowerCase().includes(search.trim().toLowerCase()),
  )
  return (
    <div className="grid min-w-0 gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="grid gap-2">
          <h1 className="text-2xl font-semibold">{t('peersTitle')}</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            {t('peersDescription')}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={peers.isFetching}
            onClick={() => void peers.refetch()}
          >
            <RefreshCwIcon />
            {t('refresh')}
          </Button>
          <Button
            onClick={() => {
              create.reset()
              setPeerId('')
              setOpen(true)
            }}
          >
            <PlusIcon />
            {t('createPeer')}
          </Button>
        </div>
      </header>
      <p className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
        {t('peerScopeHint')}
      </p>
      <Input
        aria-label={t('searchPeers')}
        placeholder={t('searchPeers')}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        className="max-w-sm"
      />
      {peers.isError && (
        <p role="alert" className="text-sm text-destructive">
          {normalizeOvClientError(peers.error).message}
        </p>
      )}
      {peers.isPending ? (
        <p role="status">{t('loading')}</p>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('peerId')}</TableHead>
                <TableHead>{t('actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((peer) => (
                <TableRow key={peer.id}>
                  <TableCell className="font-medium">{peer.id}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        nativeButton={false}
                        render={
                          <Link
                            to="/filesystem"
                            search={{
                              uri: `${peer.uri}/memories/`,
                              upload: false,
                            }}
                          />
                        }
                      >
                        {t('peerMemories')}
                      </Button>
                      <Button
                        variant="outline"
                        nativeButton={false}
                        render={
                          <Link
                            to="/filesystem"
                            search={{
                              uri: `${peer.uri}/resources/`,
                              upload: false,
                            }}
                          />
                        }
                      >
                        {t('peerResources')}
                      </Button>
                      <Button onClick={() => setSessionPeer(peer.id)}>
                        {t('newPeerSession')}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {visible.length === 0 && !peers.isError && (
                <TableRow>
                  <TableCell
                    colSpan={2}
                    className="py-10 text-center text-muted-foreground"
                  >
                    {t('noPeers')}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!create.isPending) setOpen(value)
        }}
      >
        <DialogContent>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              if (!create.isPending && isPeerId(peerId.trim()))
                create.mutate(peerId.trim())
            }}
          >
            <DialogHeader>
              <DialogTitle>{t('createPeer')}</DialogTitle>
              <DialogDescription>
                {t('createPeerDescription')}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-3 py-5">
              <label className="grid gap-2 text-sm">
                {t('peerId')}
                <Input
                  {...PLAIN_INPUT_PROPS}
                  required
                  maxLength={255}
                  value={peerId}
                  disabled={create.isPending}
                  onChange={(event) => setPeerId(event.target.value)}
                />
              </label>
              <p className="text-xs text-muted-foreground">{t('peerIdHint')}</p>
              {create.isError && (
                <p role="alert" className="text-sm text-destructive">
                  {normalizeOvClientError(create.error).message}
                </p>
              )}
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={create.isPending}
                onClick={() => setOpen(false)}
              >
                {t('cancel')}
              </Button>
              <Button
                type="submit"
                disabled={create.isPending || !isPeerId(peerId.trim())}
              >
                {create.isPending && (
                  <LoaderCircleIcon className="animate-spin" />
                )}
                {t('createPeer')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <NewSessionDialog
        open={sessionPeer !== undefined}
        peerId={sessionPeer}
        onOpenChange={(value) => {
          if (!value) setSessionPeer(undefined)
        }}
      />
    </div>
  )
}
