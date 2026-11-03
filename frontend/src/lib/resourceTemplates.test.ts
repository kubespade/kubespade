import { describe, it, expect } from 'vitest'
import { getResourceTemplate, NON_CREATABLE_KINDS } from './resourceTemplates'

describe('getResourceTemplate', () => {
  it('includes a namespace line for namespaced kinds', () => {
    const yaml = getResourceTemplate('pods', 'my-ns')
    expect(yaml).toContain('namespace: my-ns')
    expect(yaml).toContain('kind: Pod')
    expect(yaml).toContain('apiVersion: v1')
  })

  it('defaults namespace to "default"', () => {
    expect(getResourceTemplate('configmaps')).toContain('namespace: default')
  })

  it('omits namespace line for cluster-scoped kinds', () => {
    const yaml = getResourceTemplate('namespaces')
    expect(yaml).not.toContain('namespace:')
    expect(yaml).toContain('kind: Namespace')
  })

  it('falls back for unknown kinds (singularized kind, generic metadata name)', () => {
    const yaml = getResourceTemplate('widgets', 'ns1')
    expect(yaml).toContain('apiVersion: v1')
    expect(yaml).toContain('kind: widget')
    expect(yaml).toContain('name: my-resource')
    expect(yaml).toContain('namespace: ns1')
  })

  it('renders spec templates for known kinds', () => {
    const yaml = getResourceTemplate('deployments', 'ns1')
    expect(yaml).toContain('kind: Deployment')
    expect(yaml).toContain('replicas: 1')
    expect(yaml).toContain('name: my-deployment')
  })

  it('always ends with a single trailing newline', () => {
    expect(getResourceTemplate('pods').endsWith('\n')).toBe(true)
    expect(getResourceTemplate('pods').endsWith('\n\n')).toBe(false)
  })
})

describe('NON_CREATABLE_KINDS', () => {
  it.each(['events', 'endpoints', 'endpointslices', 'replicasets', 'replicationcontrollers', 'csinodes', 'volumeattachments'])(
    'includes %s',
    (kind) => expect(NON_CREATABLE_KINDS.has(kind)).toBe(true),
  )
  it.each(['pods', 'deployments', 'configmaps'])('excludes %s', (kind) =>
    expect(NON_CREATABLE_KINDS.has(kind)).toBe(false),
  )
})
