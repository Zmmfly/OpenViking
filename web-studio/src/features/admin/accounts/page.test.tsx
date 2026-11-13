// @vitest-environment jsdom
import { AccountsPage } from '#/features/admin/accounts/page'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  cleanup,
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  browser: true,
  role: 'root',
  list: vi.fn(),
  create: vi.fn(),
  switchAccount: vi.fn(),
  navigate: vi.fn(),
  credential: vi.fn(),
}))
vi.mock('#/features/connection/hooks/use-app-connection', () => ({
  useAppConnection: () => ({
    connection: {
      baseUrl: 'http://ov.test',
      accountId: 'default',
      userId: 'ant',
      apiKey: '',
      adminApiKey: m.browser ? '' : 'root-key',
      browserSession: m.browser,
    },
    identityScopeKey: 'default-ant',
    connectionRole: m.role,
    serverMode: 'api_key',
    isConnectionRoleLoading: false,
    switchManagementAccount: m.switchAccount,
    setGeneratedCredential: m.credential,
  }),
}))
vi.mock('#/features/connection/hooks/use-studio-service', () => ({
  useStudioService: () => ({ ready: true, provider: 'opensource' }),
}))
vi.mock('#/shared/api/admin', () => ({
  fetchAdminAccounts: m.list,
  createAdminAccount: m.create,
}))
vi.mock('#/features/admin/users/components/delete-account-button', () => ({
  DeleteAccountButton: () => null,
}))
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => m.navigate }))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
beforeEach(() => {
  vi.clearAllMocks()
  m.role = 'root'
  m.browser = true
  m.list.mockResolvedValue([
    { accountId: 'default', userCount: 1 },
    { accountId: 'research', userCount: 2 },
  ])
  m.create.mockResolvedValue({
    accountId: 'new-workspace',
    userId: 'owner',
    apiKey: '',
  })
  m.switchAccount.mockResolvedValue(undefined)
})
afterEach(cleanup)
function mount() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false },
          },
        })
      }
    >
      <AccountsPage />
    </QueryClientProvider>,
  )
}

it('lists workspaces for a browser platform administrator and opens the selected user management scope', async () => {
  mount()
  const row = within((await screen.findByText('research')).closest('tr')!)
  fireEvent.click(row.getByRole('button', { name: 'manageMembers' }))
  await waitFor(() => expect(m.switchAccount).toHaveBeenCalledWith('research'))
  expect(m.navigate).toHaveBeenCalledWith({ to: '/admin/users' })
  expect(m.list).toHaveBeenCalledWith(
    expect.objectContaining({ apiKey: '', browserSession: true }),
  )
})

it('creates a password-enabled workspace without changing the signed-in identity or exposing a key', async () => {
  mount()
  await screen.findByText('research')
  fireEvent.click(screen.getByRole('button', { name: 'createWorkspace' }))
  const dialog = within(screen.getByRole('dialog'))
  fireEvent.change(dialog.getByLabelText('workspaceId'), {
    target: { value: ' new-workspace ' },
  })
  fireEvent.change(dialog.getByLabelText('initialAdministrator'), {
    target: { value: 'owner' },
  })
  const password = dialog.getByLabelText<HTMLInputElement>('password')
  expect(password.required).toBe(true)
  fireEvent.change(password, { target: { value: 'new-workspace-password' } })
  fireEvent.change(dialog.getByLabelText('confirmPassword'), {
    target: { value: 'different-password' },
  })
  expect(
    dialog
      .getByRole('button', { name: 'createWorkspace' })
      .hasAttribute('disabled'),
  ).toBe(true)
  fireEvent.change(dialog.getByLabelText('confirmPassword'), {
    target: { value: 'new-workspace-password' },
  })
  fireEvent.click(dialog.getByRole('button', { name: 'createWorkspace' }))
  await waitFor(() =>
    expect(m.create).toHaveBeenCalledWith(
      expect.objectContaining({ browserSession: true }),
      {
        accountId: 'new-workspace',
        adminUserId: 'owner',
        password: 'new-workspace-password',
      },
    ),
  )
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(m.switchAccount).not.toHaveBeenCalled()
  expect(m.credential).not.toHaveBeenCalled()
})

it('does not publish credentials when creation finishes after leaving its scope', async () => {
  m.browser = false
  let finish!: (value: unknown) => void
  m.create.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const view = mount()
  await screen.findByText('research')
  fireEvent.click(screen.getByRole('button', { name: 'createWorkspace' }))
  const dialog = within(screen.getByRole('dialog'))
  fireEvent.change(dialog.getByLabelText('workspaceId'), {
    target: { value: 'new-workspace' },
  })
  fireEvent.change(dialog.getByLabelText('initialAdministrator'), {
    target: { value: 'owner' },
  })
  fireEvent.click(dialog.getByRole('button', { name: 'createWorkspace' }))
  await waitFor(() => expect(m.create).toHaveBeenCalledOnce())
  view.unmount()
  await act(async () => {
    finish({ apiKey: 'test-private-key' })
    await Promise.resolve()
  })
  expect(m.credential).not.toHaveBeenCalled()
})

it.each(['admin', 'user'])(
  'does not list or create workspaces for %s',
  (role) => {
    m.role = role
    mount()
    expect(screen.getByText('workspacesRootRequired')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'createWorkspace' })).toBeNull()
    expect(m.list).not.toHaveBeenCalled()
  },
)
