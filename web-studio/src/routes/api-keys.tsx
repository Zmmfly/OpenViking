import { ApiKeysPage } from '#/features/account/api-keys-page'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api-keys')({ component: ApiKeysPage })
