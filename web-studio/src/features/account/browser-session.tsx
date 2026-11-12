import { IdentityScopedAppShell } from '#/app/layouts/connection-boundary'
import { AppConnectionContext } from '#/features/connection/hooks/use-app-connection'
import { applyConnection } from '#/features/connection/lib/connection-runtime'
import type { AppConnectionContextValue } from '#/features/connection/lib/connection-runtime'
import { resolveStudioMode } from '#/features/connection/lib/studio-mode'
import type { ConnectionDraft } from '#/features/connection/lib/types'
import { accountRequest, getBrowserSession } from '#/features/account/api'
import type { BrowserSession } from '#/features/account/api'
import { LoginPage } from '#/features/account/login-page'
import { ErrorMessage } from '#/shared/components/error-message'
import { ovClient } from '#/shared/api/ov-client/index'
import { resolvePublicAsset } from '#/shared/lib/public-path'
import { Button } from '#/shared/ui/button'
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { Navigate, useNavigate, useRouterState } from '@tanstack/react-router'
import * as React from 'react'
import { useTranslation } from 'react-i18next'

export function BrowserSessionGate({
  children,
  legacy,
}: {
  children: React.ReactNode
  legacy: React.ReactNode
}) {
  const { t } = useTranslation('account')
  const queryClient = useQueryClient()
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const session = useQuery({
    queryKey: ['browser-session'],
    queryFn: getBrowserSession,
    retry: false,
    refetchInterval: 60_000,
  })
  React.useEffect(() => {
    const expired = () =>
      void queryClient.invalidateQueries({ queryKey: ['browser-session'] })
    window.addEventListener('ov-session-expired', expired)
    return () => window.removeEventListener('ov-session-expired', expired)
  }, [queryClient])
  if (session.isPending)
    return (
      <p role="status" className="grid min-h-svh place-items-center">
        {t('loading')}
      </p>
    )
  if (session.isError)
    return (
      <div className="mx-auto mt-24 grid max-w-md gap-4">
        <ErrorMessage error={session.error} />
        <Button onClick={() => void session.refetch()}>{t('retry')}</Button>
      </div>
    )
  if (!session.data.enabled) return legacy
  if (!session.data.authenticated) {
    if (pathname !== '/login') return <Navigate to="/login" replace />
    return (
      <LoginPage
        oidc={session.data.oidc}
        onSuccess={() => void session.refetch()}
      />
    )
  }
  return (
    <SessionConnection
      key={`${session.data.account_id}:${session.data.user_id}:${session.data.role}`}
      session={session.data}
    >
      {pathname === '/login' ? <Navigate to="/" replace /> : children}
    </SessionConnection>
  )
}

function SessionConnection({
  children,
  session,
}: {
  children: React.ReactNode
  session: BrowserSession
}) {
  const { t } = useTranslation('account')
  const queryClient = useQueryClient()
  const [workspaceQueries] = React.useState(
    () => new QueryClient({ defaultOptions: queryClient.getDefaultOptions() }),
  )
  const navigate = useNavigate()
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const studioMode = resolveStudioMode(pathname)
  const [managementAccount, setManagementAccount] = React.useState(
    session.account_id!,
  )
  const connection = React.useMemo<ConnectionDraft>(
    () => ({
      browserSession: true,
      accountId:
        studioMode === 'management' ? managementAccount : session.account_id!,
      userId: session.user_id!,
      apiKey: '',
      adminApiKey: '',
      baseUrl: window.location.origin,
      serviceSelection: 'opensource',
    }),
    [session.account_id, session.user_id, managementAccount, studioMode],
  )
  const identityScopeKey = JSON.stringify([
    'browser',
    connection.accountId,
    connection.userId,
    session.role,
  ])
  const health = useQuery({
    queryKey: ['browser-health', identityScopeKey],
    queryFn: () =>
      fetch('/health', { credentials: 'same-origin' }).then((response) =>
        response.json(),
      ),
  })
  // Set the imperative SDK client before child hooks send their first requests.
  const serverMode = session.auth_mode ?? 'api_key'
  applyConnection(connection, serverMode, studioMode)
  React.useEffect(() => {
    const interceptor = ovClient.instance.interceptors.response.use(
      undefined,
      (error) => {
        if (error.response?.status === 401)
          window.dispatchEvent(new Event('ov-session-expired'))
        return Promise.reject(error)
      },
    )
    return () => {
      ovClient.instance.interceptors.response.eject(interceptor)
      workspaceQueries.clear()
    }
  }, [workspaceQueries])
  const unavailable = () => {
    throw new Error(t('sessionIdentity'))
  }
  const value: AppConnectionContextValue = {
    browserIdentity: { accountId: session.account_id!, userId: session.user_id! },
    connection,
    connectionRole: session.role!,
    identityScopeKey,
    isConnectionRoleLoading: false,
    serverMode,
    studioMode,
    serverHealth: health.data ?? { auth_mode: 'api_key' },
    profiles: [],
    activeProfileId: 'browser',
    isGatewayHost: false,
    openvikingUrl: '',
    generatedCredential: null,
    clearGeneratedCredential: () => {},
    setGeneratedCredential: () => {},
    saveProfile: unavailable,
    activateProfile: unavailable,
    deleteProfile: unavailable,
    saveConnection: unavailable,
    switchIdentity: async () => unavailable(),
    switchManagementAccount: async (accountId) => {
      if (session.role !== 'root') unavailable()
      setManagementAccount(accountId)
    },
    openConnectionSettings: () => void navigate({ to: '/settings' }),
    reconnect: () => void health.refetch(),
  }
  return (
    <AppConnectionContext.Provider value={value}>
      <QueryClientProvider client={workspaceQueries}>
        <IdentityScopedAppShell>{children}</IdentityScopedAppShell>
      </QueryClientProvider>
    </AppConnectionContext.Provider>
  )
}

export async function logoutBrowser() {
  try {
    await accountRequest('/api/v1/auth/logout', 'POST')
  } finally {
    window.location.assign(resolvePublicAsset('login'))
  }
}
