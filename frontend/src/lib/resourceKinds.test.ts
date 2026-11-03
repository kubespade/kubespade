import { describe, it, expect } from 'vitest'
import { isClusterScopedKind, CLUSTER_SCOPED_KINDS } from './resourceKinds'

describe('isClusterScopedKind', () => {
  it.each(['namespaces', 'clusterroles', 'clusterrolebindings', 'persistentvolumes', 'storageclasses'])(
    'treats %s as cluster-scoped',
    (kind) => {
      expect(isClusterScopedKind(kind)).toBe(true)
    },
  )

  it.each(['pods', 'deployments', 'configmaps', 'services'])(
    'treats %s as namespaced',
    (kind) => {
      expect(isClusterScopedKind(kind)).toBe(false)
    },
  )

  it('deliberately excludes nodes (handled by dedicated Nodes view)', () => {
    expect(isClusterScopedKind('nodes')).toBe(false)
    expect(CLUSTER_SCOPED_KINDS.has('nodes')).toBe(false)
  })

  it('returns false for unknown kinds', () => {
    expect(isClusterScopedKind('nonexistent')).toBe(false)
  })
})
