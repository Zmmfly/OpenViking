// @vitest-environment jsdom
import { OidcSettings } from './oidc-settings'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
afterEach(cleanup)

it('builds SSO settings without overwriting server credentials, models or unrelated options', () => {
  const onChange = vi.fn()
  const original = {
    server: { root_api_key: 'server-secret', port: 1933, auth_mode: 'api_key' },
    vlm: { model: 'existing-model' },
  }
  render(
    <OidcSettings
      content={JSON.stringify(original)}
      disabled={false}
      readOnly={false}
      onChange={onChange}
    />,
  )
  fireEvent.click(screen.getByLabelText('oidcEnabled'))
  fireEvent.change(screen.getByLabelText('issuer'), {
    target: { value: 'https://idp.example/realm' },
  })
  fireEvent.change(screen.getByLabelText('clientId'), {
    target: { value: 'studio' },
  })
  fireEvent.change(screen.getByLabelText('clientSecret'), {
    target: { value: 'client-secret' },
  })
  fireEvent.change(screen.getByLabelText('userClaim'), {
    target: { value: 'preferred_username' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'oidcApply' }))
  const applied = JSON.parse(onChange.mock.calls[0][0])
  expect(applied.server).toMatchObject(original.server)
  expect(applied.vlm).toEqual(original.vlm)
  expect(applied.server.oidc).toMatchObject({
    issuer: 'https://idp.example/realm',
    client_id: 'studio',
    client_secret: 'client-secret',
    identity: {
      account_id: { source: 'fixed', value: 'default' },
      user_id: { source: 'claim', claim: 'preferred_username' },
    },
  })
  expect(screen.getByText(/\/api\/v1\/auth\/oidc\/callback/)).toBeTruthy()
})

it('leaves OIDC environment references in the file editor', () => {
  render(
    <OidcSettings
      content={
        '{"server":{"oidc":{"issuer":"${ISSUER}","client_id":"studio"}}}'
      }
      disabled={false}
      readOnly
      onChange={vi.fn()}
    />,
  )
  expect(screen.getByText('oidcReadOnly')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'oidcApply' })).toBeNull()
})

it('preserves environment references outside OIDC without disabling its form', () => {
  const onChange = vi.fn()
  render(
    <OidcSettings
      content={
        '{"server":{"root_api_key":"${ROOT_KEY}"},"embedding":{"api_key":"${MODEL_KEY}"}}'
      }
      disabled={false}
      readOnly
      onChange={onChange}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: 'oidcApply' }))
  expect(JSON.parse(onChange.mock.calls[0][0])).toMatchObject({
    server: { root_api_key: '${ROOT_KEY}' },
    embedding: { api_key: '${MODEL_KEY}' },
  })
})
