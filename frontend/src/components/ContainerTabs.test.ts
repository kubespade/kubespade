import { describe, expect, it } from 'vitest'
import { buildContainerTabs } from './ContainerTabs'

describe('buildContainerTabs', () => {
  it('returns empty for null list', () => {
    expect(buildContainerTabs(null)).toEqual([])
  })

  it('lists init containers before app containers with runnable flags', () => {
    expect(buildContainerTabs({
      init: ['init-a'],
      containers: ['app', 'sidecar'],
      current: 'app',
      running: ['app', 'init-a'],
    })).toEqual([
      { name: 'init-a', init: true, runnable: true },
      { name: 'app', init: false, runnable: true },
      { name: 'sidecar', init: false, runnable: false },
    ])
  })
})
