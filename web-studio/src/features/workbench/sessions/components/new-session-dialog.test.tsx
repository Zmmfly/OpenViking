// @vitest-environment jsdom
import { NewSessionDialog } from '#/features/workbench/sessions/components/new-session-dialog'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  create: vi.fn(),
  navigate: vi.fn(),
  title: vi.fn(),
}))
vi.mock('#/features/connection/hooks/use-app-connection', () => ({
  useAppConnection: () => ({ identityScopeKey: 'ant' }),
}))
vi.mock('#/features/workbench/peers/lib/use-peers', () => ({
  usePeers: () => ({
    data: [{ id: 'review-agent' }, { id: 'research-agent' }],
  }),
}))
vi.mock('#/features/workbench/sessions/lib/api', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  createSession: m.create,
}))
vi.mock('#/features/workbench/sessions/lib/use-session-titles', () => ({
  useSessionTitles: () => ({ setTitle: m.title }),
}))
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => m.navigate }))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

it.each(['', 'review-agent'])(
  'persists the selected session memory target (%s)',
  async (peerId) => {
    m.create.mockResolvedValue({
      session_id: 'new-session',
      peer_id: peerId || undefined,
    })
    const closed = vi.fn()
    render(
      <QueryClientProvider client={new QueryClient()}>
        <NewSessionDialog open onOpenChange={closed} />
      </QueryClientProvider>,
    )
    fireEvent.change(screen.getByLabelText('sessionMemoryScope'), {
      target: { value: peerId },
    })
    fireEvent.click(screen.getByRole('button', { name: 'createSession' }))
    await waitFor(() =>
      expect(m.create).toHaveBeenCalledWith(
        ...(peerId ? [undefined, peerId] : [undefined]),
      ),
    )
    await waitFor(() =>
      expect(m.navigate).toHaveBeenCalledWith({
        to: '/sessions',
        search: { s: 'new-session' },
      }),
    )
    expect(closed).toHaveBeenCalledWith(false)
  },
)

it('preselects the Peer when opened from its management row and retains errors', async () => {
  m.create.mockRejectedValue(new Error('could not create session'))
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { mutations: { retry: false } } })
      }
    >
      <NewSessionDialog open peerId="research-agent" onOpenChange={vi.fn()} />
    </QueryClientProvider>,
  )
  expect(
    screen.getByLabelText<HTMLSelectElement>('sessionMemoryScope').value,
  ).toBe('research-agent')
  fireEvent.click(screen.getByRole('button', { name: 'createSession' }))
  expect(await screen.findByRole('alert')).toHaveProperty(
    'textContent',
    'could not create session',
  )
  expect(m.navigate).not.toHaveBeenCalled()
})
