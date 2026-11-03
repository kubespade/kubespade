import { describe, it, expect } from 'vitest'
import {
  isClusterScopedKind,
  buildPermissionChecks,
  combinePermissionResults,
} from './k8sPermissions'

describe('isClusterScopedKind (permission layer)', () => {
  it('treats nodes as cluster-scoped here', () => {
    expect(isClusterScopedKind('nodes')).toBe(true)
  })
  it('keeps namespaces cluster-scoped', () => {
    expect(isClusterScopedKind('namespaces')).toBe(true)
  })
  it('keeps pods namespaced', () => {
    expect(isClusterScopedKind('pods')).toBe(false)
  })
})

describe('buildPermissionChecks', () => {
  it('returns the four base checks for a plain namespaced kind', () => {
    const checks = buildPermissionChecks('configmaps', 'ns1')
    expect(checks.map(c => c.id)).toEqual(['create', 'delete', 'update', 'patch'])
    for (const c of checks) {
      expect(c.namespace).toBe('ns1')
      expect(c.kind).toBe('configmaps')
    }
  })

  it('drops namespace for cluster-scoped kinds', () => {
    const checks = buildPermissionChecks('namespaces', 'ns1')
    for (const c of checks) expect(c.namespace).toBeUndefined()
  })

  it('adds pod subresource checks', () => {
    const ids = buildPermissionChecks('pods', 'ns1').map(c => c.id)
    expect(ids).toEqual(['create', 'delete', 'update', 'patch', 'logs', 'exec', 'portForward', 'evict'])
  })

  it('maps services portForward to pods portforward subresource', () => {
    const pf = buildPermissionChecks('services', 'ns1').find(c => c.id === 'portForward')
    expect(pf).toMatchObject({ verb: 'create', kind: 'pods', subresource: 'portforward', namespace: 'ns1' })
  })

  it('adds cronjob trigger check on jobs', () => {
    const trigger = buildPermissionChecks('cronjobs', 'ns1').find(c => c.id === 'trigger')
    expect(trigger).toMatchObject({ verb: 'create', kind: 'jobs', namespace: 'ns1' })
  })

  it('adds node lifecycle checks', () => {
    const ids = buildPermissionChecks('nodes').map(c => c.id)
    expect(ids).toEqual(expect.arrayContaining(['cordon', 'uncordon', 'drain', 'taint', 'exec']))
  })

  it('adds csr approval check', () => {
    const approve = buildPermissionChecks('certificatesigningrequests').find(c => c.id === 'approve')
    expect(approve).toMatchObject({ verb: 'update', subresource: 'approval' })
  })
})

describe('combinePermissionResults', () => {
  it('derives edit from update OR patch and propagates to edit-gated verbs', () => {
    const perms = combinePermissionResults({ update: false, patch: true })
    expect(perms.edit).toBe(true)
    expect(perms.restart).toBe(true)
    expect(perms.scale).toBe(true)
    expect(perms.suspend).toBe(true)
    expect(perms.undo).toBe(true)
  })

  it('edit is false when neither update nor patch', () => {
    const perms = combinePermissionResults({ update: false, patch: false })
    expect(perms.edit).toBe(false)
    expect(perms.restart).toBe(false)
  })

  it('trigger falls back to edit when not explicitly provided', () => {
    expect(combinePermissionResults({ patch: true }).trigger).toBe(true)
    expect(combinePermissionResults({ trigger: false, patch: true }).trigger).toBe(false)
  })

  it('deny mirrors approve (same RBAC)', () => {
    const perms = combinePermissionResults({ approve: true })
    expect(perms.approve).toBe(true)
    expect(perms.deny).toBe(true)
  })

  it('taint falls back to cordon when not explicitly provided', () => {
    expect(combinePermissionResults({ cordon: true }).taint).toBe(true)
    expect(combinePermissionResults({ taint: false, cordon: true }).taint).toBe(false)
  })

  it('passes through direct verb results', () => {
    const perms = combinePermissionResults({ create: true, delete: true, logs: true })
    expect(perms.create).toBe(true)
    expect(perms.delete).toBe(true)
    expect(perms.logs).toBe(true)
  })
})
