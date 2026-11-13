import { AccountsPage } from '#/features/admin/accounts/page'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/admin/accounts')({
  component: AccountsPage,
})
