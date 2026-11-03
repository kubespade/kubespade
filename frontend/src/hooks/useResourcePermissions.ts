import { useEffect, useState } from 'react'
import {
  clearPermissionCache,
  getCachedPermissions,
  loadResourcePermissions,
  permissionCacheKey,
  subscribePermissionCache,
} from '../lib/permissionCache'
import type { ResourcePermissions } from '../lib/k8sPermissions'

export function useResourcePermissions(
  profile: string,
  kind: string,
  namespace?: string,
  enabled = true,
): ResourcePermissions | null {
  const [perms, setPerms] = useState<ResourcePermissions | null>(() =>
    enabled && kind ? (getCachedPermissions(profile, kind, namespace) ?? null) : null,
  )

  useEffect(() => {
    if (!enabled || !kind) {
      setPerms(null)
      return
    }

    const key = permissionCacheKey(profile, kind, namespace)
    const cached = getCachedPermissions(profile, kind, namespace)
    // Keep cached value visible — avoid clearing action buttons while refetching.
    setPerms(cached ?? null)

    let cancelled = false
    void loadResourcePermissions(profile, kind, namespace).then(next => {
      if (!cancelled) setPerms(next)
    })

    const unsub = subscribePermissionCache(changedKey => {
      if (changedKey !== key || cancelled) return
      const next = getCachedPermissions(profile, kind, namespace)
      if (next) setPerms(next)
    })

    return () => {
      cancelled = true
      unsub()
    }
  }, [profile, kind, namespace, enabled])

  return perms
}

/** Clear warm cache when leaving a cluster view (optional companion for ClusterView). */
export function useClearPermissionCacheOnUnmount(profile: string) {
  useEffect(() => {
    return () => clearPermissionCache(profile)
  }, [profile])
}
