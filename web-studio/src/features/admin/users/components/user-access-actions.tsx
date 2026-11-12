import { createAdminClient } from '#/shared/api/admin'
import type { AdminConnection, AdminUser } from '#/shared/api/admin'
import { getOvResult } from '#/shared/api/ov-client'
import { ErrorMessage } from '#/shared/components/error-message'
import { showErrorToast } from '#/shared/lib/error-toast'
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
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { LockKeyholeIcon, UserCheckIcon, UserXIcon } from 'lucide-react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

export function UserAccessActions({
  connection,
  user,
  cannotDisable,
}: {
  connection: AdminConnection
  user: AdminUser
  cannotDisable: boolean
}) {
  const { t } = useTranslation('account')
  const queryClient = useQueryClient()
  const [mode, setMode] = React.useState<'disable' | 'password' | null>(null)
  const [password, setPassword] = React.useState('')
  const status = useMutation({
    mutationFn: () =>
      getOvResult(
        createAdminClient(connection).put({
          url: '/api/v1/admin/accounts/{account_id}/users/{user_id}/disabled',
          path: { account_id: user.accountId, user_id: user.userId },
          headers: { 'Content-Type': 'application/json' },
          body: { disabled: !user.disabled },
        }),
      ),
    onError: (error) => showErrorToast(error),
    onSuccess: async () => {
      setMode(null)
      toast.success(t('userUpdated'))
      await queryClient.invalidateQueries({ queryKey: ['managed-users'] })
    },
  })
  const reset = useMutation({
    mutationFn: () =>
      getOvResult(
        createAdminClient(connection).put({
          url: '/api/v1/admin/accounts/{account_id}/users/{user_id}/password',
          path: { account_id: user.accountId, user_id: user.userId },
          headers: { 'Content-Type': 'application/json' },
          body: { password },
        }),
      ),
    onSuccess: () => {
      setMode(null)
      setPassword('')
      toast.success(t('passwordSaved'))
    },
  })
  const pending = status.isPending || reset.isPending
  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        title={t('passwordReset')}
        aria-label={t('passwordReset')}
        onClick={() => {
          reset.reset()
          setMode('password')
        }}
      >
        <LockKeyholeIcon />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        disabled={pending || (!user.disabled && cannotDisable)}
        title={t(user.disabled ? 'enable' : 'disable')}
        aria-label={t(user.disabled ? 'enable' : 'disable')}
        onClick={() => (user.disabled ? status.mutate() : setMode('disable'))}
      >
        {user.disabled ? <UserCheckIcon /> : <UserXIcon />}
      </Button>
      <Dialog
        open={mode !== null}
        onOpenChange={(open) => {
          if (!open && !pending) {
            setMode(null)
            setPassword('')
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t(mode === 'password' ? 'passwordReset' : 'disable')}
            </DialogTitle>
            <DialogDescription>
              {t(
                mode === 'password'
                  ? 'passwordResetDescription'
                  : 'disableDescription',
                { user: user.userId },
              )}
            </DialogDescription>
          </DialogHeader>
          {mode === 'password' ? (
            <form
              className="grid gap-4"
              onSubmit={(event) => {
                event.preventDefault()
                reset.mutate()
              }}
            >
              <label className="grid gap-2 text-sm">
                {t('newPassword')}
                <Input
                  type="password"
                  value={password}
                  minLength={12}
                  maxLength={128}
                  autoComplete="new-password"
                  required
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>
              <p className="text-xs text-muted-foreground">
                {t('passwordHint')}
              </p>
              {reset.isError && <ErrorMessage error={reset.error} />}
              <DialogFooter>
                <Button
                  type="submit"
                  disabled={pending || password.length < 12}
                >
                  {t('save')}
                </Button>
              </DialogFooter>
            </form>
          ) : (
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setMode(null)}
                disabled={pending}
              >
                {t('cancel')}
              </Button>
              <Button
                variant="destructive"
                onClick={() => status.mutate()}
                disabled={pending}
              >
                {t('disable')}
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
