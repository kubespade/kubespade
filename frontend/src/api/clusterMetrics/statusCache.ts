import { isCollectorEnabledState } from '../../lib/metricsRanges'

/** Per-profile cache so Settings enable/disable and charts stay in sync without waiting on slow status. */
const enabledByProfile = new Map<string, boolean>()
const retentionByProfile = new Map<string, number>()

export function getCachedCollectorEnabled(profile: string): boolean | undefined {
  return enabledByProfile.get(profile)
}

export function getCachedCollectorRetention(profile: string): number | undefined {
  return retentionByProfile.get(profile)
}

export function setCachedCollectorEnabled(profile: string, enabled: boolean) {
  enabledByProfile.set(profile, enabled)
}

export function setCachedCollectorRetention(profile: string, days: number | undefined) {
  if (days && days > 0) retentionByProfile.set(profile, days)
  else retentionByProfile.delete(profile)
}

export function rememberCollectorState(profile: string, state: string | undefined, retentionDays?: number) {
  const on = isCollectorEnabledState(state)
  enabledByProfile.set(profile, on)
  if (retentionDays && retentionDays > 0) retentionByProfile.set(profile, retentionDays)
  return on
}
