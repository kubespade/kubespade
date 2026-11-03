import { describe, it, expect } from 'vitest'
import { getProperties } from './index'
import { props, row, type Prop } from './helpers'

function rowText(list: Prop[], label: string): string | undefined {
  const p = list.find(x => x.label === label)
  return p && p.t === 'row' ? p.text : undefined
}

const NOW = Date.UTC(2026, 0, 1)

describe('getProperties — common metadata', () => {
  it('emits Name and Namespace rows for a pod', () => {
    const detail = {
      metadata: { name: 'my-pod', namespace: 'ns1' },
      spec: { containers: [{ name: 'c', image: 'nginx' }] },
      status: { phase: 'Running' },
    }
    const list = getProperties('pods', detail, NOW)
    expect(rowText(list, 'Name')).toBe('my-pod')
    expect(rowText(list, 'Namespace')).toBe('ns1')
  })

  it('renders labels as a labels prop', () => {
    const detail = { metadata: { name: 'x', labels: { app: 'web' } } }
    const list = getProperties('configmaps', detail, NOW)
    const lbl = list.find(p => p.t === 'labels' && p.label === 'Labels')
    expect(lbl).toBeDefined()
  })
})

describe('getProperties — configmaps', () => {
  it('counts data keys', () => {
    const detail = { metadata: { name: 'cm' }, data: { a: '1', b: '2' } }
    const list = getProperties('configmaps', detail, NOW)
    expect(rowText(list, 'Keys')).toBe('2')
  })
  it('shows em-dash for empty configmap and no Immutable row', () => {
    const list = getProperties('configmaps', { metadata: { name: 'cm' } }, NOW)
    expect(rowText(list, 'Keys')).toBe('—')
    expect(list.some(p => p.label === 'Immutable')).toBe(false)
  })
  it('shows Immutable row when set', () => {
    const list = getProperties('configmaps', { metadata: { name: 'cm' }, data: { a: '1' }, immutable: true }, NOW)
    expect(rowText(list, 'Immutable')).toBe('True')
  })
})

describe('getProperties — secrets', () => {
  it('shows type and key count', () => {
    const detail = { metadata: { name: 's' }, type: 'Opaque', data: { 'tls.crt': 'eA==' } }
    const list = getProperties('secrets', detail, NOW)
    expect(rowText(list, 'Type')).toBe('Opaque')
    expect(rowText(list, 'Keys')).toBe('1')
  })
})

describe('props() helper', () => {
  it('drops false/null/undefined entries', () => {
    const out = props(row('a', '1'), false, null, undefined, row('b', '2'))
    expect(out).toHaveLength(2)
    expect(out.map(p => p.label)).toEqual(['a', 'b'])
  })
})
