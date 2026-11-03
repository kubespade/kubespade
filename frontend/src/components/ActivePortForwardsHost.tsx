import { useCallback, useEffect, useState } from 'react'
import { ChevronRight, Plug } from 'lucide-react'
import { api } from '../api/client'
import type { PortForwardSession, Profile } from '../types'

interface Props {
  profiles: Profile[]
  preferredProfile?: string | null
  onOpenPortForwards: (profile: string) => void
  onCountsChange?: (counts: Record<string, number>) => void
}

function pickProfile(
  sessions: PortForwardSession[],
  preferred?: string | null,
): string | null {
  if (sessions.length === 0) return null
  if (preferred && sessions.some(s => s.profile === preferred)) return preferred
  return [...sessions].sort((a, b) => b.startedAt - a.startedAt || b.id.localeCompare(a.id))[0]?.profile ?? null
}

/** Sticky banner while any connected profile has active port-forwards. Click → Port Forwarding page. */
export function ActivePortForwardsHost({
  profiles,
  preferredProfile,
  onOpenPortForwards,
  onCountsChange,
}: Props) {
  const [sessions, setSessions] = useState<PortForwardSession[]>([])

  const refresh = useCallback(async () => {
    const connected = profiles.filter(p => p.connected)
    if (connected.length === 0) {
      setSessions([])
      onCountsChange?.({})
      return
    }
    const results = await Promise.all(
      connected.map(async p => {
        try {
          const { sessions: list } = await api.listPortForwards(p.name)
          return list
        } catch {
          return [] as PortForwardSession[]
        }
      }),
    )
    const flat = results.flat()
    setSessions(flat)
    const counts: Record<string, number> = {}
    for (const s of flat) counts[s.profile] = (counts[s.profile] ?? 0) + 1
    onCountsChange?.(counts)
  }, [profiles, onCountsChange])

  useEffect(() => {
    void refresh()
    const t = window.setInterval(() => void refresh(), 5_000)
    return () => window.clearInterval(t)
  }, [refresh])

  const count = sessions.length
  if (count === 0) return null

  const labelProfile = pickProfile(sessions, preferredProfile)
  const profilesWithPf = new Set(sessions.map(s => s.profile))
  const profileHint =
    labelProfile && profilesWithPf.size === 1
      ? ` on ${labelProfile}`
      : labelProfile && profilesWithPf.size > 1
        ? ` · ${labelProfile}`
        : ''

  return (
    <div className="pf-life-stack" role="status">
      <button
        type="button"
        className="pf-life-banner pf-life-banner-btn"
        onClick={() => {
          const profile = pickProfile(sessions, preferredProfile)
          if (profile) onOpenPortForwards(profile)
        }}
      >
        <Plug size={14} />
        <span className="pf-life-banner-text">
          <strong>
            {count === 1 ? '1 port-forward active' : `${count} port-forwards active`}
            {profileHint}
          </strong>
          <span className="pf-life-banner-hint">Click to manage</span>
        </span>
        <ChevronRight size={16} className="pf-life-banner-chevron" />
      </button>
    </div>
  )
}
