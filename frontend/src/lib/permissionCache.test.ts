import { describe, it, expect } from 'vitest'
import { permissionCacheKey } from './permissionCache'

describe('permissionCacheKey', () => {
  it('joins profile, namespace, kind with NUL separators', () => {
    expect(permissionCacheKey('prof', 'pods', 'ns1')).toBe('prof\0ns1\0pods')
  })
  it('uses empty string when namespace omitted', () => {
    expect(permissionCacheKey('prof', 'nodes')).toBe('prof\0\0nodes')
  })
  it('uses empty string for explicit undefined namespace', () => {
    expect(permissionCacheKey('prof', 'nodes', undefined)).toBe('prof\0\0nodes')
  })
  it('produces distinct keys per namespace', () => {
    expect(permissionCacheKey('p', 'pods', 'a')).not.toBe(permissionCacheKey('p', 'pods', 'b'))
  })
})
