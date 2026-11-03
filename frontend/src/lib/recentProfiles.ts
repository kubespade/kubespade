import { prefsGet, prefsSet } from './persistentStore'

const RECENT_KEY = 'recent-profiles'
const RECENT_MAX = 5

/** Ordered profile names, most recent first. */
export function readRecentProfiles(): string[] {
  try {
    const raw = prefsGet(RECENT_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw) as unknown
    if (!Array.isArray(arr)) return []
    return arr.filter((x): x is string => typeof x === 'string')
  } catch {
    return []
  }
}

export function pushRecentProfile(name: string): string[] {
  const next = [name, ...readRecentProfiles().filter(n => n !== name)].slice(0, RECENT_MAX)
  prefsSet(RECENT_KEY, JSON.stringify(next))
  return next
}

export function pruneRecentProfiles(validNames: Set<string>): string[] {
  const next = readRecentProfiles().filter(n => validNames.has(n)).slice(0, RECENT_MAX)
  prefsSet(RECENT_KEY, JSON.stringify(next))
  return next
}
