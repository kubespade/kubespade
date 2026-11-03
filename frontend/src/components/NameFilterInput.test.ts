import { describe, it, expect } from 'vitest'
import { matchesNameQuery } from './NameFilterInput'

describe('matchesNameQuery', () => {
  it('matches everything for an empty/whitespace query', () => {
    expect(matchesNameQuery('anything', '')).toBe(true)
    expect(matchesNameQuery('anything', '   ')).toBe(true)
    expect(matchesNameQuery(undefined, '')).toBe(true)
  })

  it('is case-insensitive substring match', () => {
    expect(matchesNameQuery('MyPod-123', 'pod')).toBe(true)
    expect(matchesNameQuery('MyPod-123', 'POD')).toBe(true)
    expect(matchesNameQuery('MyPod-123', '123')).toBe(true)
  })

  it('trims the query', () => {
    expect(matchesNameQuery('nginx', '  ngi  ')).toBe(true)
  })

  it('returns false when no match', () => {
    expect(matchesNameQuery('nginx', 'redis')).toBe(false)
  })

  it('handles null/undefined names against a real query', () => {
    expect(matchesNameQuery(null, 'x')).toBe(false)
    expect(matchesNameQuery(undefined, 'x')).toBe(false)
  })
})
