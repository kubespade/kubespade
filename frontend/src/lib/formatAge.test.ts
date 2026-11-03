import { describe, it, expect } from 'vitest'
import { formatAge } from './formatAge'

const S = 1000 // ms per second helper base

describe('formatAge', () => {
  it.each<[number, number, string]>([
    // [nowMs, unixSec, expected]
    [30 * S, 0, '30s'],
    [59 * S, 0, '59s'],
    [90 * S, 0, '1m'],
    [3599 * S, 0, '59m'],
    [3600 * S, 0, '1h'],
    [7200 * S, 0, '2h'],
    [86399 * S, 0, '23h'],
    [86400 * S, 0, '1d'],
    [90000 * S, 0, '1d'],
    [0, 0, '0s'],
  ])('formatAge(%j, %j) === %j', (nowMs, unixSec, expected) => {
    expect(formatAge(nowMs, unixSec)).toBe(expected)
  })

  it('clamps future timestamps to 0s', () => {
    expect(formatAge(1000 * S, 5000)).toBe('0s')
  })
})
