import { useCallback, useEffect, useRef, useState } from 'react'
import type { Resource } from '../lib/resourceKinds'
import type { ClusterInfo } from '../types'
import { api, type MetricsHistorySource } from '../api/client'
import { withAccessToken } from '../api/token'
import type { ExecTarget } from '../components/ExecPanel'
import type { LogsTarget } from '../components/PodLogsView'
import type { FilesTarget } from '../components/PodFilesPanel'
import { ApplicationsPage } from './ApplicationsPage'
import { PolicyMapPage } from './PolicyMapPage'
import { PageErrorBoundary } from '../components/PageErrorBoundary'
import { isInvalidMfaMessage } from '../lib/mfaPrompt'
import { isMfaReconnectError, isTransientNetworkError } from '../lib/apiError'
import { PortForwardPage } from './PortForwardPage'
import { HelmReleasesPage } from './HelmReleasesPage'
import { HelmChartsPage } from './HelmChartsPage'
import { OverviewTab } from './overview/OverviewTab'
import type { HistoryPoint } from './overview/types'
import { ResourceTable } from './ResourceTable'
import { CRDInstancesTable } from './CRDInstancesTable'
import { NodesPage } from './NodesPage'
import {
  appendHistorySample,
  applyRemoteOverviewHistory,
  METRICS_HISTORY_MAX_POINTS,
  OVERVIEW_HISTORY_CAP,
} from '../lib/metricsRanges'
import { setCachedCollectorEnabled } from '../api/clusterMetrics/statusCache'
import { useCollectorStatus } from '../hooks/useCollectorStatus'
import { fetchWithRetry } from '../lib/fetchWithRetry'
import {
  RESOURCE_LABELS,
  K8S_RESOURCE_KINDS,
} from '../lib/resourceTableConfig'
import { prefetchResourcePermissions } from '../lib/permissionCache'
import { ErrorReconnectBanner } from '../components/ErrorReconnectBanner'
import { useClearPermissionCacheOnUnmount } from '../hooks/useResourcePermissions'
import { useWorkbench } from '../lib/workbenchContext'


interface Props {
  profile: string
  /** Sidebar/label name — preferred over API info.name for the breadcrumb. */
  displayName?: string
  resource: Resource
  selectedNs: string[] | null
  onNsChange: (ns: string[] | null) => void
  onSelectResource?: (resource: Resource) => void
  /** Refresh profile list after the session is dropped (unreachable cluster). */
  onProfilesChanged?: () => void
}

function priorityPermissionKind(resource: Resource): string | undefined {
  if (K8S_RESOURCE_KINDS.has(resource)) return resource
  if (resource === 'applications') return 'deployments'
  if (resource === 'network-map') return 'networkpolicies'
  if (resource === 'nodes') return 'nodes'
  return undefined
}

export function ClusterView({ profile, displayName, resource, selectedNs, onNsChange, onSelectResource, onProfilesChanged }: Props) {
  useClearPermissionCacheOnUnmount(profile)
  const [info, setInfo] = useState<ClusterInfo | null>(null)
  const [history, setHistory] = useState<HistoryPoint[]>([])
  const [historySource, setHistorySource] = useState<MetricsHistorySource>('none')
  const {
    collectorEnabled,
    setCollectorEnabled,
    collectorRetentionDays,
  } = useCollectorStatus(profile, 0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [secondsAgo, setSecondsAgo] = useState(0)
  const esRef = useRef<EventSource | null>(null)
  const autoReconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reconnectAttemptsRef = useRef(0)
  const historySourceRef = useRef<MetricsHistorySource>('none')
  historySourceRef.current = historySource
  const bootstrapHistoryRef = useRef<(() => void) | null>(null)
  const historyBootstrappedRef = useRef(false)
  const pendingHistoryBootstrapRef = useRef(false)
  const MAX_AUTO_RECONNECT = 5
  const workbench = useWorkbench()
  const openWorkbenchExec = useCallback((target: ExecTarget) => {
    workbench.openExec(profile, target)
  }, [workbench, profile])
  const openWorkbenchLogs = useCallback((target: LogsTarget) => {
    workbench.openLogs(profile, target)
  }, [workbench, profile])
  const openWorkbenchFiles = useCallback((target: FilesTarget) => {
    workbench.openFiles(profile, target)
  }, [workbench, profile])

  function refreshClusterInfo() {
    void api.getClusterInfo(profile).then(data => {
      setInfo(data)
      setLastUpdated(new Date())
    }).catch(() => {})
  }

  function clearAutoReconnect() {
    if (autoReconnectRef.current) {
      clearTimeout(autoReconnectRef.current)
      autoReconnectRef.current = null
    }
  }

  function markSessionLost(message: string) {
    clearAutoReconnect()
    reconnectAttemptsRef.current = 0
    setLoading(false)
    setError(message)
    void api.disconnectProfile(profile)
      .then(() => onProfilesChanged?.())
      .catch(() => onProfilesChanged?.())
  }

  function scheduleAutoReconnect() {
    if (autoReconnectRef.current) return
    if (reconnectAttemptsRef.current >= MAX_AUTO_RECONNECT) {
      markSessionLost('Could not reach cluster — stopped retrying. Use Reconnect when it is back.')
      return
    }
    reconnectAttemptsRef.current += 1
    autoReconnectRef.current = setTimeout(() => {
      autoReconnectRef.current = null
      setError('')
      connect()
    }, 2500)
  }

  function connect(mfa = '') {
    clearAutoReconnect()
    esRef.current?.close()
    esRef.current = null
    setError('')

    const url = withAccessToken(`/api/profiles/${profile}/k8s/watch${mfa ? `?mfaToken=${encodeURIComponent(mfa)}` : ''}`)
    const es = new EventSource(url)
    esRef.current = es
    let intentionalClose = false

    es.onmessage = (e) => {
      const msg = JSON.parse(e.data) as { type: string; phase?: string; data?: ClusterInfo; message?: string }
      if (msg.type === 'info' && msg.data) {
        const data = msg.data
        const phase = msg.phase
        setInfo(prev => {
          // Never let a late light snapshot wipe metrics/events from a full one.
          if (phase === 'light' && prev?.metrics) return prev
          // Keep nodes if a version+ns-only light arrives out of order.
          if (phase === 'light' && prev && data.nodes.length === 0 && prev.nodes.length > 0) {
            return {
              ...data,
              nodes: prev.nodes,
              nodeCount: prev.nodeCount,
              readyNodes: prev.readyNodes,
            }
          }
          return data
        })
        setLastUpdated(new Date())
        setLoading(false)
        setError('')
        reconnectAttemptsRef.current = 0
        clearAutoReconnect()
        const metrics = data.metrics
        const src = historySourceRef.current
        if (metrics?.hasMetrics && !historyBootstrappedRef.current) {
          if (bootstrapHistoryRef.current) {
            historyBootstrappedRef.current = true
            bootstrapHistoryRef.current()
          } else {
            pendingHistoryBootstrapRef.current = true
          }
        }
        if (metrics?.hasMetrics && src !== 'prometheus' && src !== 'cluster') {
          setHistory(prev => appendHistorySample(prev, {
            t: Date.now(),
            cpu: metrics.cpu.usage,
            mem: metrics.memory.usage,
          }, METRICS_HISTORY_MAX_POINTS))
        }
      } else if (msg.type === 'needsMFA') {
        intentionalClose = true
        es.close()
        esRef.current = null
        setLoading(false)
        void reconnectWithMfa()
      } else if (msg.type === 'error') {
        intentionalClose = true
        es.close()
        esRef.current = null
        const message = msg.message ?? 'Unknown error'
        setLoading(false)
        if (isMfaReconnectError(message) || isInvalidMfaMessage(message)) {
          setError(message)
          return
        }
        setError(message)
        if (isTransientNetworkError(message)) {
          scheduleAutoReconnect()
        }
      }
    }

    es.onerror = () => {
      if (!intentionalClose) {
        if (reconnectAttemptsRef.current >= MAX_AUTO_RECONNECT) {
          markSessionLost('Could not reach cluster — stopped retrying. Use Reconnect when it is back.')
          return
        }
        setError('Connection lost — retrying…')
        scheduleAutoReconnect()
      }
    }
  }

  /** Soft reconnect without MFA (network blip). */
  function reconnectWatch() {
    clearAutoReconnect()
    reconnectAttemptsRef.current = 0
    setError('')
    setLoading(true)
    connect()
  }

  /** Prompt for MFA (re-prompt on wrong OTP) then refresh session + watch. */
  async function reconnectWithMfa(initialMessage = 'Enter MFA code to continue:') {
    clearAutoReconnect()
    const { promptMfa } = await import('../lib/mfaPrompt')
    let message = initialMessage
    for (;;) {
      const code = await promptMfa(message)
      if (!code) {
        setError('MFA required to reconnect')
        setLoading(false)
        return
      }
      setLoading(true)
      setError('')
      try {
        await api.getClusterInfo(profile, code)
        connect()
        return
      } catch (e) {
        setLoading(false)
        const msg = e instanceof Error ? e.message : 'MFA reconnect failed'
        if (isInvalidMfaMessage(msg)) {
          message = 'Invalid MFA code — try again:'
          continue
        }
        setError(msg)
        return
      }
    }
  }

  function handleReconnectClick() {
    if (isMfaReconnectError(error) || isInvalidMfaMessage(error)) {
      void reconnectWithMfa()
      return
    }
    reconnectWatch()
  }

  useEffect(() => {
    historyBootstrappedRef.current = false
    pendingHistoryBootstrapRef.current = false
    setLoading(true)
    setInfo(null)
    setHistory([])
    setHistorySource('none')
    setError('')
    connect()
    return () => {
      clearAutoReconnect()
      esRef.current?.close()
      esRef.current = null
    }
  }, [profile])

  // Warm RBAC for the current screen first, then common kinds in the background.
  useEffect(() => {
    const namespaceReady = selectedNs !== null
    const permNs = selectedNs && selectedNs.length === 1 ? selectedNs[0] : undefined
    prefetchResourcePermissions(profile, {
      namespace: permNs,
      namespaceReady,
      priorityKind: priorityPermissionKind(resource),
    })
  }, [profile, selectedNs, resource])

  useEffect(() => {
    let cancelled = false
    const GIB = 1024 ** 3

    function applyServerOverview(pts: { ts: number; cpuMilli: number; memBytes: number }[], source: MetricsHistorySource) {
      if (pts.length < 2) return
      const serverHistory = pts.map(p => ({
        t: (p.ts > 1e12 ? p.ts : p.ts * 1000),
        cpu: p.cpuMilli / 1000,
        mem: p.memBytes / GIB,
      }))
      const longSeries = source === 'prometheus' || source === 'cluster'
      const cap = longSeries ? OVERVIEW_HISTORY_CAP : METRICS_HISTORY_MAX_POINTS
      setHistory(prev => applyRemoteOverviewHistory(serverHistory, prev, cap))
    }

    async function fetchServerHistory(): Promise<void> {
      const result = await fetchWithRetry(
        () => api.getClusterMetricsHistory(profile),
        {
          isCancelled: () => cancelled,
          shouldRetry: (r) => r.points.length < 2,
        },
      )
      if (cancelled || !result) return
      setHistorySource(result.source)
      if (result.source === 'cluster') {
        setCachedCollectorEnabled(profile, true)
        setCollectorEnabled(true)
      }
      applyServerOverview(result.points, result.source)
    }

    bootstrapHistoryRef.current = () => {
      void fetchServerHistory()
    }
    if (pendingHistoryBootstrapRef.current && !historyBootstrappedRef.current) {
      pendingHistoryBootstrapRef.current = false
      historyBootstrappedRef.current = true
      void fetchServerHistory()
    }

    void fetchServerHistory()
    const t = setInterval(() => void fetchServerHistory(), 30_000)
    return () => {
      cancelled = true
      clearInterval(t)
      bootstrapHistoryRef.current = null
    }
  }, [profile, setCollectorEnabled])

  // Refresh server history when opening Overview (Prom / collector / local).
  useEffect(() => {
    if (resource !== 'overview') return
    let cancelled = false
    const GIB = 1024 ** 3
    void (async () => {
      try {
        const { points: pts, source } = await api.getClusterMetricsHistory(profile)
        if (cancelled) return
        setHistorySource(source)
        if (pts.length < 2) return
        const serverHistory = pts.map(p => ({
          t: (p.ts > 1e12 ? p.ts : p.ts * 1000),
          cpu: p.cpuMilli / 1000,
          mem: p.memBytes / GIB,
        }))
        const longSeries = source === 'prometheus' || source === 'cluster'
        const cap = longSeries ? OVERVIEW_HISTORY_CAP : METRICS_HISTORY_MAX_POINTS
        setHistory(prev => applyRemoteOverviewHistory(serverHistory, prev, cap))
      } catch { /* ignore */ }
    })()
    return () => { cancelled = true }
  }, [profile, resource])

  useEffect(() => {
    if (!lastUpdated) return
    setSecondsAgo(0)
    const t = setInterval(() => setSecondsAgo(s => s + 1), 1000)
    return () => clearInterval(t)
  }, [lastUpdated])

  const resourceTitle = resource.startsWith('crd::')
    ? (resource.split('::')[5] ?? resource)
    : (RESOURCE_LABELS[resource] ?? resource)

  return (
    <div className="cluster-view">
      <div className="cv-header">
        <div className="cv-header-left">
          <span className="cv-cluster-name">{displayName || info?.name || profile}</span>
          <span className="cv-resource-title">/ {resourceTitle}</span>
        </div>
        <div className="cv-header-right">
          {info && !error && (
            <span className="last-updated">
              <span className="live-dot" />
              {secondsAgo < 5 ? 'live' : `${secondsAgo}s ago`}
            </span>
          )}
          {info && (
            <div className="cv-meta">
              <span className="cv-badge">K8s {info.version}</span>
              <span className="cv-badge">{info.nodeCount} nodes</span>
              <span className="cv-badge">{info.namespaces.length} ns</span>
            </div>
          )}
        </div>
      </div>

      <div className="cv-body">
        {/* Overview/Nodes need watch ClusterInfo; resource tables load via their own watch. */}
        {loading && (resource === 'overview' || resource === 'nodes') && (
          <div className="cv-loading">Connecting to cluster…</div>
        )}
        {error && (
          <ErrorReconnectBanner error={error} onReconnect={() => handleReconnectClick()} />
        )}

        {info && resource === 'overview' && (
          <OverviewTab
            info={info}
            history={history}
            historySource={historySource}
            longHistory={historySource === 'prometheus' || collectorEnabled}
            retentionDays={historySource === 'prometheus' ? 30 : collectorRetentionDays}
          />
        )}

        {resource === 'applications' && (
          <ApplicationsPage key={profile} profile={profile} />
        )}

        {resource === 'network-map' && (
          <PageErrorBoundary label="Policy Map">
            <PolicyMapPage
              key={profile}
              profile={profile}
              namespaces={info?.namespaces ?? []}
              selectedNs={selectedNs}
              onNsChange={ns => onNsChange(ns)}
            />
          </PageErrorBoundary>
        )}

        {resource === 'portforwards' && (
          <PortForwardPage key={profile} profile={profile} />
        )}

        {resource === 'helm-releases' && (
          <HelmReleasesPage key={`${profile}/helm-releases`} profile={profile} />
        )}

        {resource === 'helm-charts' && (
          <HelmChartsPage key={`${profile}/helm-charts`} profile={profile} />
        )}

        {info && resource === 'nodes' && (
          <NodesPage
            profile={profile}
            nodes={info.nodes}
            onNodesChange={updater => setInfo(prev => prev ? { ...prev, nodes: updater(prev.nodes) } : prev)}
            onRefreshClusterInfo={refreshClusterInfo}
            onSelectResource={onSelectResource}
            onNsChange={onNsChange}
          />
        )}

        {K8S_RESOURCE_KINDS.has(resource) && (
          <ResourceTable
            key={`${profile}/${resource}`}
            profile={profile}
            resource={resource}
            namespaces={info?.namespaces ?? []}
            selectedNs={selectedNs}
            onNsChange={onNsChange}
            onOpenExec={openWorkbenchExec}
            onOpenLogs={openWorkbenchLogs}
            onOpenFiles={openWorkbenchFiles}
          />
        )}

        {resource.startsWith('crd::') && (
          <CRDInstancesTable
            key={resource}
            profile={profile}
            resourceId={resource}
            namespaces={info?.namespaces ?? []}
            selectedNs={selectedNs}
            onNsChange={onNsChange}
          />
        )}
      </div>
    </div>
  )
}
