import { api } from '../api/client'
import {
  buildPermissionChecks,
  combinePermissionResults,
  isClusterScopedKind,
  type ResourcePermissions,
} from './k8sPermissions'

/** Cache key: profile + namespace + kind. Empty namespace = cluster-wide / multi-ns checks. */
export function permissionCacheKey(profile: string, kind: string, namespace?: string): string {
  return `${profile}\0${namespace ?? ''}\0${kind}`
}

const cache = new Map<string, ResourcePermissions>()
const inflight = new Map<string, Promise<ResourcePermissions>>()
const listeners = new Set<(key: string) => void>()

export function getCachedPermissions(
  profile: string,
  kind: string,
  namespace?: string,
): ResourcePermissions | undefined {
  return cache.get(permissionCacheKey(profile, kind, namespace))
}

export function subscribePermissionCache(listener: (key: string) => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function notify(key: string) {
  for (const listener of listeners) listener(key)
}

/** Drop cached permissions for one profile, or everything. */
export function clearPermissionCache(profile?: string) {
  if (!profile) {
    cache.clear()
    inflight.clear()
    return
  }
  const prefix = `${profile}\0`
  for (const key of [...cache.keys()]) {
    if (key.startsWith(prefix)) cache.delete(key)
  }
  for (const key of [...inflight.keys()]) {
    if (key.startsWith(prefix)) inflight.delete(key)
  }
}

/**
 * Fetch (or reuse) permissions for one kind. Dedupes in-flight requests;
 * subsequent callers share the same promise and warm the cache.
 */
export async function loadResourcePermissions(
  profile: string,
  kind: string,
  namespace?: string,
  opts?: { force?: boolean },
): Promise<ResourcePermissions> {
  const key = permissionCacheKey(profile, kind, namespace)
  if (!opts?.force) {
    const hit = cache.get(key)
    if (hit) return hit
    const pending = inflight.get(key)
    if (pending) return pending
  }

  const promise = (async () => {
    try {
      const checks = buildPermissionChecks(kind, namespace)
      const raw = await api.checkAccess(profile, checks)
      const perms = combinePermissionResults(raw)
      cache.set(key, perms)
      notify(key)
      return perms
    } catch {
      const empty: ResourcePermissions = {}
      cache.set(key, empty)
      notify(key)
      return empty
    } finally {
      inflight.delete(key)
    }
  })()

  inflight.set(key, promise)
  return promise
}

/** Frequent sidebar kinds — warmed after connect / namespace change. */
export const WARM_PERMISSION_KINDS: readonly string[] = [
  'pods',
  'deployments',
  'statefulsets',
  'daemonsets',
  'services',
  'configmaps',
  'secrets',
  'jobs',
  'cronjobs',
  'persistentvolumeclaims',
  'ingresses',
  'nodes',
  'namespaces',
]

function orderedKinds(priorityKind: string | undefined, kinds: readonly string[]): string[] {
  const list = [...kinds]
  if (!priorityKind) return list
  const i = list.indexOf(priorityKind)
  if (i >= 0) list.splice(i, 1)
  list.unshift(priorityKind)
  return list
}

/**
 * Priority kind first, then the warm list with limited concurrency.
 * Namespaced kinds are skipped until `namespaceReady` (selectedNs resolved).
 */
export function prefetchResourcePermissions(
  profile: string,
  opts: {
    /** Single-ns name, or undefined for multi/all-ns checks. Ignored for cluster-scoped kinds. */
    namespace?: string
    /** False while ClusterView still picks the default namespace. */
    namespaceReady?: boolean
    priorityKind?: string
    kinds?: readonly string[]
    concurrency?: number
  } = {},
): void {
  const namespaceReady = opts.namespaceReady !== false
  const concurrency = Math.max(1, opts.concurrency ?? 2)
  const kinds = orderedKinds(opts.priorityKind, opts.kinds ?? WARM_PERMISSION_KINDS)

  const work: Array<{ kind: string; namespace?: string }> = []
  for (const kind of kinds) {
    if (isClusterScopedKind(kind)) {
      work.push({ kind, namespace: undefined })
      continue
    }
    if (!namespaceReady) continue
    work.push({ kind, namespace: opts.namespace })
  }
  if (work.length === 0) return

  let next = 0
  const workers = Array.from({ length: Math.min(concurrency, work.length) }, async () => {
    while (next < work.length) {
      const item = work[next++]!
      await loadResourcePermissions(profile, item.kind, item.namespace)
    }
  })
  void Promise.all(workers)
}
