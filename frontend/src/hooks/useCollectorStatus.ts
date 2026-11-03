import { useEffect, useState } from 'react'
import { api } from '../api/client'
import {
  getCachedCollectorEnabled,
  getCachedCollectorRetention,
  rememberCollectorState,
} from '../api/clusterMetrics/statusCache'

/**
 * Polls cluster-metrics-collector status for a profile and keeps the
 * Settings/chart enabled+retention cache in sync.
 */
export function useCollectorStatus(profile: string, pollMs = 20_000) {
  const [collectorEnabled, setCollectorEnabled] = useState(
    () => getCachedCollectorEnabled(profile) ?? false,
  )
  const [collectorRetentionDays, setCollectorRetentionDays] = useState<number | null>(
    () => getCachedCollectorRetention(profile) ?? null,
  )

  useEffect(() => {
    let cancelled = false
    const cached = getCachedCollectorEnabled(profile)
    if (cached !== undefined) setCollectorEnabled(cached)
    const cachedRet = getCachedCollectorRetention(profile)
    if (cachedRet !== undefined) setCollectorRetentionDays(cachedRet)

    async function refreshStatus() {
      try {
        const s = await api.getClusterMetricsCollector(profile)
        if (cancelled) return
        setCollectorEnabled(rememberCollectorState(profile, s.state, s.retentionDays))
        setCollectorRetentionDays(s.retentionDays && s.retentionDays > 0 ? s.retentionDays : null)
      } catch {
        /* keep cache on transient errors */
      }
    }

    void refreshStatus()
    if (pollMs <= 0) {
      return () => { cancelled = true }
    }
    const t = setInterval(() => void refreshStatus(), pollMs)
    return () => {
      cancelled = true
      clearInterval(t)
    }
  }, [profile, pollMs])

  return {
    collectorEnabled,
    setCollectorEnabled,
    collectorRetentionDays,
    setCollectorRetentionDays,
  }
}
