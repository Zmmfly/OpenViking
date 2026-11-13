import { PeersPage } from '#/features/workbench/peers/page'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/peers')({ component: PeersPage })
