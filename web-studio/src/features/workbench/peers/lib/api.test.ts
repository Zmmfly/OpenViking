import { createPeer, fetchPeers } from '#/features/workbench/peers/lib/api'
import { OvClientError } from '#/shared/api/ov-client/index'
import { afterEach, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ list: vi.fn(), mkdir: vi.fn() }))
vi.mock('#/features/workbench/resources/lib/api', () => ({
  fetchFsList: m.list,
}))
vi.mock('#/shared/api/ov-client/index', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  postFsMkdir: m.mkdir,
  getOvResult: (value: unknown) => value,
}))
afterEach(() => vi.resetAllMocks())

it('lists existing Peer directories in the current user namespace', async () => {
  m.list.mockResolvedValue({
    entries: [
      {
        name: 'review-agent',
        isDir: true,
        uri: 'viking://user/ant/peers/review-agent/',
      },
      { name: '.abstract.md', isDir: false },
      { name: '__self', isDir: true },
    ],
  })
  expect(await fetchPeers('ant')).toEqual([
    { id: 'review-agent', uri: 'viking://user/ant/peers/review-agent' },
  ])
  expect(m.list.mock.calls[0][0]).toBe('viking://user/ant/peers')
})

it('treats an absent peers directory as empty while preserving authorization errors', async () => {
  m.list.mockRejectedValueOnce(
    new OvClientError({
      code: 'NOT_FOUND',
      statusCode: 404,
      message: 'missing',
    }),
  )
  expect(await fetchPeers('ant')).toEqual([])
  m.list.mockRejectedValueOnce(
    new OvClientError({
      code: 'PERMISSION_DENIED',
      statusCode: 403,
      message: 'denied',
    }),
  )
  await expect(fetchPeers('ant')).rejects.toMatchObject({ statusCode: 403 })
})

it('creates resources and memories in the same Peer namespace and can retry a partial creation', async () => {
  m.mkdir
    .mockRejectedValueOnce(
      new OvClientError({ code: 'ALREADY_EXISTS', message: 'exists' }),
    )
    .mockResolvedValue(undefined)
  expect(await createPeer('ant', ' review-agent ')).toEqual({
    id: 'review-agent',
    uri: 'viking://user/ant/peers/review-agent',
  })
  expect(m.mkdir.mock.calls.map(([request]) => request.body.uri)).toEqual([
    'viking://user/ant/peers/review-agent/resources',
    'viking://user/ant/peers/review-agent/memories',
  ])
})

it.each(['../other', 'a/b', 'a\\b', '__self', '.', '..', 'a@b@c', ''])(
  'rejects unsafe Peer IDs before writing: %s',
  async (id) => {
    await expect(createPeer('ant', id)).rejects.toThrow()
    expect(m.mkdir).not.toHaveBeenCalled()
  },
)
