// @vitest-environment jsdom
import { LoginPage } from './login-page'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

const request = vi.hoisted(() => vi.fn())
vi.mock('./api', () => ({ accountRequest: request }))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function mount(oidc = false) {
  const onSuccess = vi.fn()
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { mutations: { retry: false } } })
      }
    >
      <LoginPage oidc={oidc} onSuccess={onSuccess} />
    </QueryClientProvider>,
  )
  return onSuccess
}

it('signs in with username and password without requesting or retaining an API key', async () => {
  request.mockResolvedValueOnce(undefined)
  const onSuccess = mount(true)
  expect(screen.queryByLabelText('setupCredential')).toBeNull()
  expect(screen.getByRole('button', { name: 'oidcLogin' })).toBeTruthy()
  fireEvent.change(screen.getByLabelText('username'), {
    target: { value: 'alice' },
  })
  fireEvent.change(screen.getByLabelText('password'), {
    target: { value: 'correct-password' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'login' }))
  await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce())
  expect(request).toHaveBeenCalledWith('/api/v1/auth/login', 'POST', {
    account_id: 'default',
    user_id: 'alice',
    password: 'correct-password',
  })
  expect(screen.getByLabelText<HTMLInputElement>('password').value).toBe('')
})

it('requires matching setup passwords and uses the root key only for administrator initialization', async () => {
  request.mockResolvedValueOnce(undefined)
  mount()
  fireEvent.click(screen.getByRole('button', { name: 'setupLink' }))
  fireEvent.change(screen.getByLabelText('username'), {
    target: { value: 'admin' },
  })
  fireEvent.change(screen.getByLabelText('password'), {
    target: { value: 'new-admin-password' },
  })
  fireEvent.change(screen.getByLabelText('confirmPassword'), {
    target: { value: 'different-password' },
  })
  fireEvent.change(screen.getByLabelText('setupCredential'), {
    target: { value: 'root-setup-key' },
  })
  expect(
    screen
      .getByRole('button', { name: 'createAdministrator' })
      .hasAttribute('disabled'),
  ).toBe(true)
  fireEvent.change(screen.getByLabelText('confirmPassword'), {
    target: { value: 'new-admin-password' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'createAdministrator' }))
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith('/api/v1/auth/bootstrap', 'POST', {
      account_id: 'default',
      user_id: 'admin',
      password: 'new-admin-password',
      root_key: 'root-setup-key',
    }),
  )
})
