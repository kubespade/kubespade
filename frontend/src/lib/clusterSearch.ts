import { api } from '../api/client'
import type { Resource } from './resourceKinds'
import { K8S_RESOURCE_KINDS, RESOURCE_LABELS } from './resourceTableConfig'
import { matchesNameQuery } from '../components/NameFilterInput'

export interface ClusterSearchHit {
  kind: Resource
  kindLabel: string
  name: string
  namespace?: string
}

/** Skip noisy / non-name-centric lists for cluster-wide search. */
const SEARCH_SKIP = new Set([
  'events',
  'endpoints',
  'endpointslices',
  'leases',
  'csistoragecapacities',
])

export const CLUSTER_SEARCH_KINDS: Resource[] = [...K8S_RESOURCE_KINDS]
  .filter(k => !SEARCH_SKIP.has(k))
  .sort() as Resource[]

export function scoreSearchName(name: string, query: string): number {
  const n = name.toLowerCase()
  const q = query.toLowerCase()
  if (n === q) return 0
  if (n.startsWith(q)) return 1
  if (n.includes(q)) return 2
  return 9
}

export function sortSearchHits(hits: ClusterSearchHit[], query: string): ClusterSearchHit[] {
  return [...hits].sort((a, b) => {
    const sa = scoreSearchName(a.name, query)
    const sb = scoreSearchName(b.name, query)
    if (sa !== sb) return sa - sb
    return a.name.localeCompare(b.name) || a.kind.localeCompare(b.kind)
  })
}

/**
 * Fan-out list across common Kubernetes kinds and keep name matches.
 * Always cluster-wide (all namespaces) — sidebar ns filter does not apply.
 */
export async function searchClusterByName(
  profile: string,
  query: string,
  signal?: { cancelled: boolean },
): Promise<ClusterSearchHit[]> {
  const q = query.trim()
  if (q.length < 2) return []

  const groups = await Promise.all(
    CLUSTER_SEARCH_KINDS.map(async kind => {
      if (signal?.cancelled) return [] as ClusterSearchHit[]
      try {
        const list = await api.listResources(profile, kind, '')
        if (signal?.cancelled) return []
        return (list.items ?? [])
          .filter(item => matchesNameQuery(item.name, q))
          .map((item): ClusterSearchHit => ({
            kind,
            kindLabel: RESOURCE_LABELS[kind] ?? kind,
            name: item.name,
            namespace: item.namespace,
          }))
      } catch {
        return []
      }
    }),
  )

  if (signal?.cancelled) return []
  return sortSearchHits(groups.flat(), q)
}
