import type { ConnectionRole } from '#/features/connection/lib/types'
import type { ServerAuthMode } from '#/shared/types/auth'
import i18n from '#/i18n/core'

export type BrowserSession = {
  enabled: boolean
  authenticated: boolean
  oidc: boolean
  auth_mode?: ServerAuthMode
  account_id?: string
  user_id?: string
  role?: Exclude<ConnectionRole, 'unknown'>
}

export type PersonalApiKey = {
  key_id: string
  label: string
  prefix: string
  created_at: string
}

class AccountRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

export async function accountRequest<T>(
  path: string,
  method = 'GET',
  body?: unknown,
): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-OpenViking-CSRF': '1' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  if (response.status === 401)
    window.dispatchEvent(new Event('ov-session-expired'))
  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    throw new AccountRequestError(
      data.error?.message ||
        (typeof data.detail === 'string'
          ? data.detail
          : i18n.t('account:requestFailed', { status: response.status })),
      response.status,
    )
  }
  const data = await response.json()
  return data.result as T
}

export async function getBrowserSession(): Promise<BrowserSession> {
  try {
    return await accountRequest<BrowserSession>('/api/v1/auth/session')
  } catch (error) {
    // Standalone/cloud Studio can still connect to an external service.
    if (error instanceof AccountRequestError && error.status === 404)
      return { enabled: false, authenticated: false, oidc: false }
    throw error
  }
}
