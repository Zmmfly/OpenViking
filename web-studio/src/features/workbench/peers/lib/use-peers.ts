import { useAppConnection } from '#/features/connection/hooks/use-app-connection'
import { useStudioService } from '#/features/connection/hooks/use-studio-service'
import { fetchPeers } from '#/features/workbench/peers/lib/api'
import { useQuery } from '@tanstack/react-query'

export function usePeers(enabled = true) {
  const { connection, identityScopeKey } = useAppConnection()
  const service = useStudioService()
  return useQuery({
    queryKey: ['peers', identityScopeKey],
    queryFn: () => fetchPeers(connection.userId),
    enabled: enabled && service.ready && service.provider === 'opensource',
    retry: false,
  })
}
