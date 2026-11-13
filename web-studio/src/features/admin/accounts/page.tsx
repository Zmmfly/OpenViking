import { DeleteAccountButton } from '#/features/admin/users/components/delete-account-button'
import { useAppConnection } from '#/features/connection/hooks/use-app-connection'
import { useIdentityScopeGuard } from '#/features/connection/hooks/use-identity-scope-guard'
import { useStudioService } from '#/features/connection/hooks/use-studio-service'
import { resolveStudioManagementCapabilities } from '#/features/connection/lib/studio-permissions'
import { createAdminAccount, fetchAdminAccounts } from '#/shared/api/admin'
import type { CreateAccountInput } from '#/shared/api/admin'
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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { LoaderCircleIcon, PlusIcon, RefreshCwIcon } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

export function AccountsPage() {
  const { t } = useTranslation('account')
  const {
    connection,
    connectionRole,
    serverMode,
    identityScopeKey,
    isConnectionRoleLoading,
    switchManagementAccount,
    setGeneratedCredential,
  } = useAppConnection()
  const service = useStudioService()
  const isCurrentScope = useIdentityScopeGuard(identityScopeKey)
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const allowed =
    service.ready &&
    resolveStudioManagementCapabilities({
      serviceProvider: service.provider,
      hasControlCredential:
        Boolean(connection.adminApiKey) || Boolean(connection.browserSession),
      isRoleLoading: isConnectionRoleLoading,
      role: connectionRole,
      serverMode,
    }).canManageAccounts
  const adminConnection = {
    ...connection,
    apiKey: connection.adminApiKey || '',
  }
  const accounts = useQuery({
    queryKey: ['managed-accounts', identityScopeKey],
    queryFn: () => fetchAdminAccounts(adminConnection),
    enabled: allowed,
    retry: false,
  })
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [draft, setDraft] = useState<CreateAccountInput>({
    accountId: '',
    adminUserId: '',
  })
  const [switching, setSwitching] = useState(false)
  const create = useMutation({
    mutationFn: async (value: CreateAccountInput) => ({
      result: await createAdminAccount(adminConnection, value),
      scope: identityScopeKey,
    }),
    onSuccess: async ({ result, scope }, value) => {
      if (!isCurrentScope(scope)) return
      if (result.apiKey && !connection.browserSession)
        setGeneratedCredential({
          accountId: value.accountId,
          userId: value.adminUserId,
          apiKey: result.apiKey,
        })
      setOpen(false)
      setDraft({ accountId: '', adminUserId: '' })
      setConfirmation('')
      for (const key of [
        'managed-accounts',
        'browser-management-accounts',
        'scope-accounts',
        'account-switcher',
      ])
        await queryClient.invalidateQueries({ queryKey: [key] })
      toast.success(t('workspaceCreated', { account: value.accountId }))
    },
  })
  async function manage(accountId: string) {
    setSwitching(true)
    try {
      await switchManagementAccount(accountId)
      await navigate({ to: '/admin/users' })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setSwitching(false)
    }
  }
  if (!allowed)
    return (
      <p role="status" className="text-muted-foreground">
        {t(isConnectionRoleLoading ? 'loading' : 'workspacesRootRequired')}
      </p>
    )
  const visible = (accounts.data ?? []).filter((item) =>
    item.accountId.toLowerCase().includes(search.trim().toLowerCase()),
  )
  return (
    <div className="grid min-w-0 gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="grid gap-2">
          <h1 className="text-2xl font-semibold">{t('workspacesTitle')}</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            {t('workspacesDescription')}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={accounts.isFetching}
            onClick={() => void accounts.refetch()}
          >
            <RefreshCwIcon />
            {t('refresh')}
          </Button>
          <Button
            onClick={() => {
              create.reset()
              setDraft({ accountId: '', adminUserId: '' })
              setConfirmation('')
              setOpen(true)
            }}
          >
            <PlusIcon />
            {t('createWorkspace')}
          </Button>
        </div>
      </header>
      <Input
        aria-label={t('searchWorkspaces')}
        placeholder={t('searchWorkspaces')}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        className="max-w-sm"
      />
      {accounts.isError && (
        <p role="alert" className="text-sm text-destructive">
          {accounts.error.message}
        </p>
      )}
      {accounts.isPending ? (
        <p role="status">{t('loading')}</p>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('workspaceId')}</TableHead>
                <TableHead>{t('memberCount')}</TableHead>
                <TableHead>{t('createdAt')}</TableHead>
                <TableHead className="text-right">{t('actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((item) => (
                <TableRow key={item.accountId}>
                  <TableCell className="font-medium">
                    {item.accountId}
                  </TableCell>
                  <TableCell>{item.userCount}</TableCell>
                  <TableCell>{item.createdAt || '—'}</TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="outline"
                        disabled={switching}
                        onClick={() => void manage(item.accountId)}
                      >
                        {t('manageMembers')}
                      </Button>
                      <DeleteAccountButton
                        accountId={item.accountId}
                        adminConnection={adminConnection}
                      />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {visible.length === 0 && !accounts.isError && (
                <TableRow>
                  <TableCell
                    colSpan={4}
                    className="py-10 text-center text-muted-foreground"
                  >
                    {t('noWorkspaces')}
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
          if (!create.isPending) {
            setOpen(value)
            if (!value) {
              setDraft({ accountId: '', adminUserId: '' })
              setConfirmation('')
            }
          }
        }}
      >
        <DialogContent>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              if (create.isPending || (draft.password ?? '') !== confirmation)
                return
              create.mutate({
                ...draft,
                accountId: draft.accountId.trim(),
                adminUserId: draft.adminUserId.trim(),
              })
            }}
          >
            <DialogHeader>
              <DialogTitle>{t('createWorkspace')}</DialogTitle>
              <DialogDescription>
                {t('createWorkspaceDescription')}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-5">
              <label className="grid gap-2 text-sm">
                {t('workspaceId')}
                <Input
                  {...PLAIN_INPUT_PROPS}
                  required
                  value={draft.accountId}
                  disabled={create.isPending}
                  onChange={(event) =>
                    setDraft({ ...draft, accountId: event.target.value })
                  }
                />
              </label>
              <label className="grid gap-2 text-sm">
                {t('initialAdministrator')}
                <Input
                  {...PLAIN_INPUT_PROPS}
                  required
                  value={draft.adminUserId}
                  disabled={create.isPending}
                  onChange={(event) =>
                    setDraft({ ...draft, adminUserId: event.target.value })
                  }
                />
              </label>
              <label className="grid gap-2 text-sm">
                {t('password')}
                <Input
                  type="password"
                  autoComplete="new-password"
                  required={Boolean(connection.browserSession)}
                  minLength={12}
                  maxLength={128}
                  value={draft.password || ''}
                  disabled={create.isPending}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      password: event.target.value || undefined,
                    })
                  }
                />
              </label>
              <label className="grid gap-2 text-sm">
                {t('confirmPassword')}
                <Input
                  type="password"
                  autoComplete="new-password"
                  required={Boolean(draft.password)}
                  value={confirmation}
                  disabled={create.isPending}
                  onChange={(event) => setConfirmation(event.target.value)}
                />
              </label>
              <p className="text-xs text-muted-foreground">
                {t('passwordHint')}
              </p>
              {(draft.password ?? '') !== confirmation && (
                <p role="alert" className="text-sm text-destructive">
                  {t('passwordMismatch')}
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
                onClick={() => {
                  setOpen(false)
                  setDraft({ accountId: '', adminUserId: '' })
                  setConfirmation('')
                }}
              >
                {t('cancel')}
              </Button>
              <Button
                type="submit"
                disabled={
                  create.isPending || (draft.password ?? '') !== confirmation
                }
              >
                {create.isPending && (
                  <LoaderCircleIcon className="animate-spin" />
                )}
                {t('createWorkspace')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
