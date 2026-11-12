import { object } from '#/features/admin/server-configuration/lib/config-file-api'
import { copyTextToClipboard } from '#/shared/lib/clipboard'
import { showErrorToast } from '#/shared/lib/error-toast'
import { Button } from '#/shared/ui/button'
import { Input } from '#/shared/ui/input'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

export function OidcSettings({
  content,
  disabled,
  readOnly,
  onChange,
}: {
  content: string
  disabled: boolean
  readOnly: boolean
  onChange: (content: string) => void
}) {
  const { t } = useTranslation('account')
  let raw: Record<string, unknown> = {}
  let parsed = true
  try {
    raw = object(JSON.parse(content))
  } catch {
    parsed = false
  }
  const server = object(raw.server)
  const oidc = object(server.oidc)
  const identity = object(oidc.identity)
  const account = object(identity.account_id)
  const user = object(identity.user_id)
  const [enabled, setEnabled] = useState(Boolean(server.oidc))
  const [issuer, setIssuer] = useState(String(oidc.issuer ?? ''))
  const [clientId, setClientId] = useState(String(oidc.client_id ?? ''))
  const [secret, setSecret] = useState(String(oidc.client_secret ?? ''))
  const [audience, setAudience] = useState(String(oidc.audience ?? ''))
  const [jwks, setJwks] = useState(String(oidc.jwks_uri ?? ''))
  const [mapping, setMapping] = useState(
    account.source === 'claim' ? 'claim' : 'fixed',
  )
  const [accountValue, setAccountValue] = useState(
    String(
      account.source === 'claim'
        ? (account.claim ?? '')
        : (account.value ?? 'default'),
    ),
  )
  const [userClaim, setUserClaim] = useState(String(user.claim ?? 'sub'))
  const [error, setError] = useState(false)
  const advancedMapping =
    !['fixed', 'claim'].includes(String(account.source ?? 'fixed')) ||
    String(user.source ?? 'claim') !== 'claim' ||
    [account, user].some((mappingSource) =>
      ['claims', 'parts', 'regex', 'mapping', 'prefix', 'normalize'].some(
        (field) => Boolean(mappingSource[field]),
      ),
    )
  // Work with verbatim JSON, never expanded secrets. References in unrelated
  // sections can be preserved while editing a plain OIDC configuration.
  const environmentMapping = readOnly && /\$|%[^%]+%/.test(JSON.stringify(oidc))
  const callback = `${window.location.origin}/api/v1/auth/oidc/callback`
  function apply(event: React.FormEvent) {
    event.preventDefault()
    let valid = true
    try {
      const url = new URL(issuer)
      valid =
        ['https:', 'http:'].includes(url.protocol) &&
        !url.username &&
        !url.password
    } catch {
      valid = false
    }
    if (
      enabled &&
      (!valid || !clientId.trim() || !accountValue.trim() || !userClaim.trim())
    ) {
      setError(true)
      return
    }
    const nextServer = { ...server }
    if (enabled)
      nextServer.oidc = {
        ...oidc,
        issuer: issuer.trim(),
        client_id: clientId.trim(),
        client_secret: secret || null,
        audience: audience.trim() || null,
        jwks_uri: jwks.trim() || null,
        identity: {
          ...identity,
          account_id: {
            ...account,
            source: mapping,
            ...(mapping === 'fixed'
              ? { value: accountValue.trim() }
              : { claim: accountValue.trim(), fallback: null }),
          },
          user_id: { ...user, source: 'claim', claim: userClaim.trim() },
        },
      }
    else {
      delete nextServer.oidc
      if (nextServer.auth_mode === 'oidc') nextServer.auth_mode = 'api_key'
    }
    onChange(JSON.stringify({ ...raw, server: nextServer }, null, 2) + '\n')
  }
  return (
    <section className="grid gap-4 border-b pb-6" aria-label={t('oidcTitle')}>
      <div>
        <h2 className="text-base font-semibold">{t('oidcTitle')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('oidcDescription')}
        </p>
      </div>
      {!parsed || environmentMapping || advancedMapping ? (
        <p className="text-sm text-muted-foreground">{t('oidcReadOnly')}</p>
      ) : (
        <form className="grid gap-4" onSubmit={apply}>
          <fieldset className="grid gap-4" disabled={disabled}>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(event) => setEnabled(event.target.checked)}
              />
              {t('oidcEnabled')}
            </label>
            {enabled && (
              <>
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="grid gap-2 text-sm">
                    {t('issuer')}
                    <Input
                      type="url"
                      value={issuer}
                      required
                      onChange={(event) => setIssuer(event.target.value)}
                    />
                  </label>
                  <label className="grid gap-2 text-sm">
                    {t('clientId')}
                    <Input
                      value={clientId}
                      required
                      onChange={(event) => setClientId(event.target.value)}
                    />
                  </label>
                  <label className="grid gap-2 text-sm">
                    {t('clientSecret')}
                    <Input
                      type="password"
                      autoComplete="off"
                      value={secret}
                      onChange={(event) => setSecret(event.target.value)}
                    />
                  </label>
                  <label className="grid gap-2 text-sm">
                    {t('userClaim')}
                    <Input
                      value={userClaim}
                      required
                      onChange={(event) => setUserClaim(event.target.value)}
                    />
                  </label>
                  <label className="grid gap-2 text-sm">
                    {t('accountMapping')}
                    <select
                      className="h-9 rounded-md border bg-background px-3"
                      value={mapping}
                      onChange={(event) => {
                        setMapping(event.target.value)
                        setAccountValue(
                          event.target.value === 'fixed' ? 'default' : '',
                        )
                      }}
                    >
                      <option value="fixed">{t('fixedAccount')}</option>
                      <option value="claim">{t('accountClaim')}</option>
                    </select>
                  </label>
                  <label className="grid gap-2 text-sm">
                    {t(mapping === 'fixed' ? 'fixedAccount' : 'accountClaim')}
                    <Input
                      value={accountValue}
                      required
                      onChange={(event) => setAccountValue(event.target.value)}
                    />
                  </label>
                </div>
                <div className="grid gap-2">
                  <p className="text-sm">{t('callback')}</p>
                  <div className="flex flex-wrap gap-2">
                    <code className="break-all rounded border bg-muted p-2 text-xs">
                      {callback}
                    </code>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        void copyTextToClipboard(callback)
                          .then(() => toast.success(t('copied')))
                          .catch(showErrorToast)
                      }
                    >
                      {t('copy')}
                    </Button>
                  </div>
                </div>
                <details>
                  <summary className="cursor-pointer text-sm">
                    {t('oidcAdvanced')}
                  </summary>
                  <div className="mt-3 grid gap-4 md:grid-cols-2">
                    <label className="grid gap-2 text-sm">
                      {t('audience')}
                      <Input
                        value={audience}
                        onChange={(event) => setAudience(event.target.value)}
                      />
                    </label>
                    <label className="grid gap-2 text-sm">
                      {t('jwksUri')}
                      <Input
                        type="url"
                        value={jwks}
                        onChange={(event) => setJwks(event.target.value)}
                      />
                    </label>
                  </div>
                </details>
                <p className="text-sm text-muted-foreground">{t('oidcHint')}</p>
              </>
            )}
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {t('oidcInvalid')}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="outline" type="submit">
                {t('oidcApply')}
              </Button>
              <p className="text-xs text-muted-foreground">
                {t('oidcRestart')}
              </p>
            </div>
          </fieldset>
        </form>
      )}
    </section>
  )
}
