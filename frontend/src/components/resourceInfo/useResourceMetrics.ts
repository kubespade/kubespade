import { useEffect, useState, type DependencyList } from 'react'
import { api } from '../../api/client'
import type { ContainerMetric, MetricPoint, MetricsHistorySource, NodeMetricsSummary, NodePodSummary } from '../../api/client'
import {
  applyRemoteMetricHistory,
  METRICS_HISTORY_MAX_POINTS,
  METRICS_HISTORY_POLL_MS,
  METRICS_LIVE_POLL_MS,
} from '../../lib/metricsRanges'
import { setCachedCollectorEnabled } from '../../api/clusterMetrics/statusCache'
import { useCollectorStatus } from '../../hooks/useCollectorStatus'
import { fetchWithRetry } from '../../lib/fetchWithRetry'
import type { InfoTarget } from './types'

/**
 * When `active`, runs `poll` immediately then every `intervalMs`; re-subscribes when
 * `deps` change, cleaning up the interval and signalling in-flight fetches via `isCancelled`.
 */
export function usePolledMetric(
  active: boolean,
  intervalMs: number,
  poll: (isCancelled: () => boolean) => void,
  deps: DependencyList,
) {
  useEffect(() => {
    if (!active) return
    let cancelled = false
    const run = () => poll(() => cancelled)
    run()
    const t = setInterval(run, intervalMs)
    return () => { cancelled = true; clearInterval(t) }
  }, deps)
}

export function useResourceMetrics(profile: string, target: InfoTarget) {
  const [metricsMap, setMetricsMap] = useState<Record<string, ContainerMetric> | null>(null)
  const [nodeMetrics, setNodeMetrics] = useState<NodeMetricsSummary | null>(null)
  const [metricsHistory, setMetricsHistory] = useState<MetricPoint[]>([])
  const [nodeMetricsHistory, setNodeMetricsHistory] = useState<MetricPoint[]>([])
  const [nodePods, setNodePods] = useState<NodePodSummary[] | null>(null)
  const {
    collectorEnabled,
    setCollectorEnabled,
    collectorRetentionDays,
  } = useCollectorStatus(profile)
  const [historySource, setHistorySource] = useState<MetricsHistorySource>('none')

  const isPod = target.type === 'k8s' && target.kind.toLowerCase() === 'pods'
  const isNode = target.type === 'k8s' && target.kind.toLowerCase() === 'nodes'

  function resetMetrics() {
    setMetricsMap(null)
    setNodeMetrics(null)
    setMetricsHistory([])
    setNodeMetricsHistory([])
    setNodePods(null)
  }

  function loadNodeExtras(cancelled: () => boolean) {
    if (!(target.type === 'k8s' && target.kind.toLowerCase() === 'nodes')) return
    api.getNodeMetrics(profile, target.name)
      .then(m => { if (!cancelled()) setNodeMetrics(m) })
      .catch(() => { /* metrics-server not available — silently skip */ })
    api.listNodePods(profile, target.name)
      .then(pods => { if (!cancelled()) setNodePods(pods) })
      .catch(() => { if (!cancelled()) setNodePods([]) })
  }

  usePolledMetric(isPod, METRICS_LIVE_POLL_MS, isCancelled => {
    api.getPodMetrics(profile, target.name, target.namespace)
      .then(m => {
        if (isCancelled()) return
        const map: Record<string, ContainerMetric> = {}
        for (const c of m.containers) {
          map[c.name] = c
        }
        setMetricsMap(map)
      })
      .catch(() => {})
  }, [profile, target])

  usePolledMetric(isNode, METRICS_LIVE_POLL_MS, isCancelled => {
    api.getNodeMetrics(profile, target.name)
      .then(m => {
        if (isCancelled()) return
        setNodeMetrics(m)
      })
      .catch(() => {})
  }, [profile, target])

  function applyPodHistory(points: MetricPoint[], source: MetricsHistorySource) {
    setHistorySource(source)
    const cap = source === 'prometheus' || source === 'cluster' ? 20_000 : METRICS_HISTORY_MAX_POINTS
    setMetricsHistory(prev => applyRemoteMetricHistory(points, prev, cap))
    if (source === 'cluster') {
      setCachedCollectorEnabled(profile, true)
      setCollectorEnabled(true)
    }
  }

  function applyNodeHistory(points: MetricPoint[], source: MetricsHistorySource) {
    setHistorySource(source)
    const cap = source === 'prometheus' || source === 'cluster' ? 20_000 : METRICS_HISTORY_MAX_POINTS
    setNodeMetricsHistory(prev => applyRemoteMetricHistory(points, prev, cap))
    if (source === 'cluster') {
      setCachedCollectorEnabled(profile, true)
      setCollectorEnabled(true)
    }
  }

  async function fetchPodHistory(isCancelled?: () => boolean) {
    const result = await fetchWithRetry(
      () => api.getPodMetricsHistory(profile, target.name, target.namespace),
      {
        isCancelled,
        shouldRetry: (r) => r.points.length < 2,
      },
    )
    if (result && !isCancelled?.()) applyPodHistory(result.points, result.source)
  }

  async function fetchNodeHistory(isCancelled?: () => boolean) {
    const result = await fetchWithRetry(
      () => api.getNodeMetricsHistory(profile, target.name),
      {
        isCancelled,
        shouldRetry: (r) => r.points.length < 2,
      },
    )
    if (result && !isCancelled?.()) applyNodeHistory(result.points, result.source)
  }

  usePolledMetric(isPod, METRICS_HISTORY_POLL_MS, isCancelled => {
    void fetchPodHistory(isCancelled)
  }, [profile, target])

  usePolledMetric(isNode, METRICS_HISTORY_POLL_MS, isCancelled => {
    void fetchNodeHistory(isCancelled)
  }, [profile, target])

  return {
    metricsMap,
    nodeMetrics,
    metricsHistory,
    nodeMetricsHistory,
    nodePods,
    collectorEnabled,
    collectorRetentionDays,
    historySource,
    resetMetrics,
    loadNodeExtras,
  }
}
