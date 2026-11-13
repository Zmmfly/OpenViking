import { useAppConnection } from '#/features/connection/hooks/use-app-connection'
import { fetchAdminAccounts } from '#/shared/api/admin'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { showErrorToast } from '#/shared/lib/error-toast'
import { Link } from '@tanstack/react-router'

export function SessionAccountScope({
  managementMode,
}: {
  managementMode: boolean
}) {
  const { t } = useTranslation('account')
  const {
    connection,
    connectionRole,
    switchManagementAccount,
    browserIdentity,
  } = useAppConnection()
  const accounts = useQuery({
    queryKey: [
      'browser-management-accounts',
      connection.baseUrl,
      connection.userId,
    ],
    queryFn: () => fetchAdminAccounts({ ...connection, apiKey: '' }),
    enabled: managementMode && connectionRole === 'root',
    retry: false,
  })
  if (!managementMode || connectionRole !== 'root')
    return (
      <span className="truncate text-sm text-muted-foreground">
        {browserIdentity?.accountId ?? connection.accountId} /{' '}
        {browserIdentity?.userId ?? connection.userId}
      </span>
    )
  return (
    <div className="flex min-w-0 items-center gap-2">
      <select
        aria-label={t('account')}
        value={connection.accountId}
        className="h-9 max-w-48 rounded-md border bg-background px-3 text-sm"
        onChange={(event) =>
          void switchManagementAccount(event.target.value).catch((error) =>
            showErrorToast(error),
          )
        }
      >
        {(accounts.data?.length
          ? accounts.data
          : [{ accountId: connection.accountId }]
        ).map((account) => (
          <option key={account.accountId} value={account.accountId}>
            {account.accountId}
          </option>
        ))}
      </select>
      <Link
        to="/admin/accounts"
        className="whitespace-nowrap text-xs text-muted-foreground hover:text-foreground"
      >
        {t('workspacesTitle')}
      </Link>
    </div>
  )
}
