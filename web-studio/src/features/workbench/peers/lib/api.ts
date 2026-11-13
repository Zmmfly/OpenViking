import { fetchFsList } from '#/features/workbench/resources/lib/api'
import {
  getOvResult,
  normalizeOvClientError,
  postFsMkdir,
} from '#/shared/api/ov-client/index'
import i18n from '#/i18n/core'

export type Peer = { id: string; uri: string }

export function isPeerId(value: string): boolean {
  return Boolean(
    value &&
    value.length <= 255 &&
    value !== '.' &&
    value !== '..' &&
    value !== '__self' &&
    /^[a-zA-Z0-9_.@-]+$/.test(value) &&
    value.split('@').length <= 2,
  )
}

export function peersRoot(userId: string): string {
  return `viking://user/${userId}/peers`
}

export async function fetchPeers(userId: string): Promise<Peer[]> {
  try {
    const result = await fetchFsList(peersRoot(userId), {
      showAllHidden: true,
      sortBy: 'name',
      sortOrder: 'asc',
    })
    return result.entries
      .filter((entry) => entry.isDir && isPeerId(entry.name))
      .map((entry) => ({ id: entry.name, uri: entry.uri.replace(/\/+$/, '') }))
  } catch (error) {
    const normalized = normalizeOvClientError(error)
    if (normalized.statusCode === 404 || normalized.code === 'NOT_FOUND')
      return []
    throw error
  }
}

export async function createPeer(
  userId: string,
  peerId: string,
): Promise<Peer> {
  const id = peerId.trim()
  if (!isPeerId(id)) throw new Error(i18n.t('account:peerIdHint'))
  const uri = `${peersRoot(userId)}/${id}`
  // Use the existing namespaces so SDKs and message extraction see the same Peer.
  // Retrying a partially completed creation fills in its missing directories.
  for (const section of ['resources', 'memories']) {
    try {
      await getOvResult(postFsMkdir({ body: { uri: `${uri}/${section}` } }))
    } catch (error) {
      if (normalizeOvClientError(error).code !== 'ALREADY_EXISTS') throw error
    }
  }
  return { id, uri }
}
