// @vitest-environment jsdom
import { ApiKeysPage } from './api-keys-page'
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
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}))
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})
const existing = {
  key_id: 'key-one',
  label: 'Laptop',
  prefix: 'abcd1234',
  created_at: '2026-11-12T10:00:00Z',
}

it('creates a labeled key, reveals the secret once and requires confirmation before rotation and deletion', async () => {
  request.mockImplementation((_path: string, method = 'GET') =>
    Promise.resolve(
      method === 'GET'
        ? [existing]
        : method === 'DELETE'
          ? { deleted: true }
          : { ...existing, api_key: 'new-secret-shown-once' },
    ),
  )
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <ApiKeysPage />
    </QueryClientProvider>,
  )
  await screen.findByText('Laptop')
  expect(screen.queryByText('new-secret-shown-once')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'addKey' }))
  fireEvent.change(screen.getByLabelText('label'), {
    target: { value: 'CI builder' },
  })
  fireEvent.click(screen.getAllByRole('button', { name: 'addKey' }).at(-1)!)
  await screen.findByText('new-secret-shown-once')
  expect(request).toHaveBeenCalledWith('/api/v1/me/api-keys', 'POST', {
    label: 'CI builder',
  })
  fireEvent.click(screen.getByRole('button', { name: 'done' }))
  await waitFor(() =>
    expect(screen.queryByText('new-secret-shown-once')).toBeNull(),
  )
  fireEvent.click(screen.getByRole('button', { name: 'rotate' }))
  expect(request).not.toHaveBeenCalledWith(
    '/api/v1/me/api-keys/key-one/rotate',
    'POST',
  )
  fireEvent.click(screen.getAllByRole('button', { name: 'rotate' }).at(-1)!)
  await screen.findByText('new-secret-shown-once')
  expect(request).toHaveBeenCalledWith(
    '/api/v1/me/api-keys/key-one/rotate',
    'POST',
  )
  fireEvent.click(screen.getByRole('button', { name: 'done' }))
  fireEvent.click(screen.getByRole('button', { name: 'delete' }))
  expect(request).not.toHaveBeenCalledWith(
    '/api/v1/me/api-keys/key-one',
    'DELETE',
  )
  fireEvent.click(screen.getAllByRole('button', { name: 'delete' }).at(-1)!)
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith(
      '/api/v1/me/api-keys/key-one',
      'DELETE',
    ),
  )
})
