import { accountRequest } from '#/features/account/api'
import { ApiKeysPage } from '#/features/account/api-keys-page'
import { useAppConnection } from '#/features/connection/hooks/use-app-connection'
import { ErrorMessage } from '#/shared/components/error-message'
import { Button } from '#/shared/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '#/shared/ui/card'
import { Input } from '#/shared/ui/input'
import { useMutation } from '@tanstack/react-query'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

export function AccountPage() {
  const { t } = useTranslation('account')
  const { connection, browserIdentity } = useAppConnection()
  const [current, setCurrent] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [confirmation, setConfirmation] = React.useState('')
  const mutation = useMutation({
    mutationFn: () =>
      accountRequest('/api/v1/auth/password', 'PUT', {
        current_password: current,
        password,
      }),
    onSuccess: () => {
      setCurrent('')
      setPassword('')
      setConfirmation('')
      toast.success(t('passwordChanged'))
    },
  })
  return (
    <div className="grid gap-6">
      <h1 className="text-2xl font-semibold">{t('accountTitle')}</h1>
      <p className="text-muted-foreground">
        {browserIdentity?.accountId ?? connection.accountId} / {browserIdentity?.userId ?? connection.userId}
      </p>
      <ApiKeysPage />
      <Card>
        <CardHeader>
          <CardTitle>{t('changePassword')}</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="grid max-w-md gap-4"
            onSubmit={(event) => {
              event.preventDefault()
              if (password === confirmation) mutation.mutate()
            }}
          >
            <label className="grid gap-2 text-sm">
              {t('currentPassword')}
              <Input
                type="password"
                value={current}
                autoComplete="current-password"
                required
                onChange={(event) => setCurrent(event.target.value)}
              />
            </label>
            <label className="grid gap-2 text-sm">
              {t('newPassword')}
              <Input
                type="password"
                value={password}
                autoComplete="new-password"
                minLength={12}
                maxLength={128}
                required
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            <label className="grid gap-2 text-sm">
              {t('confirmPassword')}
              <Input
                type="password"
                value={confirmation}
                autoComplete="new-password"
                required
                onChange={(event) => setConfirmation(event.target.value)}
              />
            </label>
            <p className="text-xs text-muted-foreground">{t('passwordHint')}</p>
            {confirmation && confirmation !== password && (
              <p role="alert">{t('passwordMismatch')}</p>
            )}
            {mutation.isError && <ErrorMessage error={mutation.error} />}
            <Button
              type="submit"
              disabled={mutation.isPending || password !== confirmation}
            >
              {t('save')}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
