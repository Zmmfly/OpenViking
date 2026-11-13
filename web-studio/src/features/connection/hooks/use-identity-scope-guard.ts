import { useCallback, useEffect, useRef } from 'react'

/** Ignore completed UI actions after leaving their service/user scope. */
export function useIdentityScopeGuard(scope: string) {
  const owner = useRef({ scope, active: true })
  owner.current.scope = scope
  useEffect(() => {
    owner.current.active = true
    return () => {
      owner.current.active = false
    }
  }, [])
  return useCallback(
    (expected: string) =>
      owner.current.active && owner.current.scope === expected,
    [],
  )
}
