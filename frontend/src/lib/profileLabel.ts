import type { Profile } from '../types'

/** Human-facing label for a profile: display name, else cluster name, else id. */
export const PROFILE_DISPLAY_NAME_MAX = 80

export function profileLabel(p: Profile): string {
  return p.displayName || p.clusterName || p.name
}

/** Region / location for Manage cards (explicit region, or parsed from an EKS ARN in clusterName). */
export function profileLocation(p: Profile): string | null {
  if (p.region) return p.region
  const arn = p.clusterName || ''
  const m = /^arn:aws:eks:([^:]+):/.exec(arn)
  return m?.[1] || null
}
