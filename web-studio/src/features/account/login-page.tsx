import { accountRequest } from '#/features/account/api'
import { ErrorMessage } from '#/shared/components/error-message'
import { OpenVikingMark } from '#/shared/components/openviking-mark'
import { Button } from '#/shared/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/shared/ui/card'
import { Input } from '#/shared/ui/input'
import { useMutation } from '@tanstack/react-query'
import * as React from 'react'
import { useTranslation } from 'react-i18next'

export function LoginPage({
  oidc,
  onSuccess,
}: {
  oidc: boolean
  onSuccess: () => void
}) {
  const { t } = useTranslation('account')
  const [setup, setSetup] = React.useState(false)
  const [accountId, setAccountId] = React.useState('default')
  const [userId, setUserId] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [rootKey, setRootKey] = React.useState('')
  const [confirmation, setConfirmation] = React.useState('')
  const mutation = useMutation({
    mutationFn: () =>
      accountRequest(`/api/v1/auth/${setup ? 'bootstrap' : 'login'}`, 'POST', {
        account_id: accountId.trim(),
        user_id: userId.trim(),
        password,
        ...(setup ? { root_key: rootKey } : {}),
      }),
    onSuccess: () => {
      setPassword('')
      setRootKey('')
      setConfirmation('')
      onSuccess()
    },
  })
  return (
    <main className="grid min-h-svh place-items-center bg-muted/30 px-4 py-12">
      <Card className="w-full max-w-md">
        <CardHeader className="gap-3">
          <OpenVikingMark className="size-12" />
          <CardTitle role="heading" aria-level={1} className="text-2xl">
            {t(setup ? 'setupTitle' : 'loginTitle')}
          </CardTitle>
          <CardDescription>
            {t(setup ? 'setupDescription' : 'loginDescription')}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault()
              if (!mutation.isPending && (!setup || password === confirmation))
                mutation.mutate()
            }}
          >
            <label className="grid gap-2 text-sm">
              {t('account')}
              <Input
                value={accountId}
                onChange={(event) => setAccountId(event.target.value)}
                required
                autoComplete="organization"
              />
            </label>
            <label className="grid gap-2 text-sm">
              {t('username')}
              <Input
                value={userId}
                onChange={(event) => setUserId(event.target.value)}
                required
                autoComplete="username"
                autoFocus
              />
            </label>
            <label className="grid gap-2 text-sm">
              {t('password')}
              <Input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                minLength={setup ? 12 : 1}
                maxLength={128}
                autoComplete={setup ? 'new-password' : 'current-password'}
              />
            </label>
            {setup && (
              <>
                <label className="grid gap-2 text-sm">
                  {t('confirmPassword')}
                  <Input
                    type="password"
                    value={confirmation}
                    onChange={(event) => setConfirmation(event.target.value)}
                    required
                    minLength={12}
                    autoComplete="new-password"
                  />
                </label>
                <label className="grid gap-2 text-sm">
                  {t('setupCredential')}
                  <Input
                    type="password"
                    value={rootKey}
                    onChange={(event) => setRootKey(event.target.value)}
                    required
                    autoComplete="off"
                  />
                </label>
                <p className="text-xs text-muted-foreground">
                  {t('passwordHint')}
                </p>
              </>
            )}
            {setup && confirmation && confirmation !== password && (
              <p role="alert" className="text-sm text-destructive">
                {t('passwordMismatch')}
              </p>
            )}
            {mutation.isError && <ErrorMessage error={mutation.error} />}
            <Button
              type="submit"
              disabled={
                mutation.isPending || (setup && password !== confirmation)
              }
            >
              {t(
                mutation.isPending
                  ? 'loading'
                  : setup
                    ? 'createAdministrator'
                    : 'login',
              )}
            </Button>
          </form>
          {oidc && !setup && (
            <Button
              variant="outline"
              onClick={() => window.location.assign('/api/v1/auth/oidc/login')}
            >
              {t('oidcLogin')}
            </Button>
          )}
          <Button
            variant="link"
            disabled={mutation.isPending}
            onClick={() => {
              setSetup(!setup)
              setPassword('')
              setRootKey('')
              setConfirmation('')
              mutation.reset()
            }}
          >
            {t(setup ? 'backToLogin' : 'setupLink')}
          </Button>
        </CardContent>
      </Card>
    </main>
  )
}
