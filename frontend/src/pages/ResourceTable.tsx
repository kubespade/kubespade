import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Plus, ScrollText, Terminal } from 'lucide-react'
import type { PortForwardSession, ResourceList } from '../types'
import { api } from '../api/client'
import type { PodMetricsSummary } from '../api/client'
import { withAccessToken } from '../api/token'
import { SortableTable } from '../components/SortableTable'
import type { ColDef as SortableColDef } from '../components/SortableTable'
import { YamlPanel } from '../components/YamlPanel'
import type { ResourceRef } from '../components/YamlPanel'
import { ConfirmDialog } from '../components/ConfirmDialog'
import {
  DEFAULT_DELETE_FORM,
  DeleteOptionsFields,
  deleteFormToOpts,
  type DeleteFormState,
} from '../components/DeleteOptionsFields'
import { ActionButtons } from '../components/ActionButtons'
import { ScaleDialog } from '../components/ScaleDialog'
import { PortForwardDialog } from '../components/PortForwardDialog'
import { RolloutHistoryDialog } from '../components/RolloutHistoryDialog'
import { ResourceInfoPanel } from '../components/ResourceInfoPanel'
import type { InfoTarget } from '../components/ResourceInfoPanel'
import type { ExecTarget } from '../components/ExecPanel'
import type { LogsTarget } from '../components/PodLogsView'
import type { FilesTarget } from '../components/PodFilesPanel'
import { getResourceTemplate } from '../lib/resourceTemplates'
import { formatAge } from '../lib/formatAge'
import { fixedAnchorCenterTop } from '../lib/uiZoom'
import { useNow } from '../hooks/useNow'
import { useResourcePermissions } from '../hooks/useResourcePermissions'
import { useAutoReconnect } from '../hooks/useAutoReconnect'
import { EmptyState } from '../components/EmptyState'
import { ErrorReconnectBanner } from '../components/ErrorReconnectBanner'
import {
  RESOURCE_LABELS,
  CLUSTER_SCOPED_KINDS,
  K8S_RESOURCE_KINDS,
  COLUMNS,
  DEFAULT_HIDDEN,
  resolveCreateNamespace,
  canCreateResource,
} from '../lib/resourceTableConfig'
import { NamespaceCombo } from '../components/NamespaceCombo'
import { NameFilterInput, matchesNameQuery } from '../components/NameFilterInput'
import { takeCommandPaletteJump, subscribeCommandPaletteJump } from '../lib/commandPaletteJump'
import {
  getResourceActionButtonsProps,
  getResourceInfoPanelActionProps,
  isLogFollowableColor,
  logsTargetForPod,
  type ResourceActionCallbacks,
  type ResourceActionSetters,
} from '../lib/resourceActions'

// ── Resource table ────────────────────────────────────────────────────────────

// Dot format from backend: "!initName:color:restarts,name:color:restarts,..."
// ! prefix = init container; color: g=green y=yellow r=red s=gray
type DotInfo = { name: string; color: string; restarts: number; isInit: boolean }

function ContainerDots({ value, onLogs, onExec }: {
  value: string
  onLogs?: (container: string, active: boolean) => void
  onExec?: (container: string) => void
}) {
  const [tip, setTip] = useState<{ dot: DotInfo; x: number; y: number } | null>(null)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  if (!value) return <span>—</span>

  const dots = value.split(',').filter(Boolean).map(item => {
    const parts = item.split(':')
    const isInit = parts[0].startsWith('!')
    const name = isInit ? parts[0].slice(1) : parts[0]
    const color = parts[1] ?? 'y'
    const restarts = Number(parts[2] ?? 0)
    return { name, color, restarts, isInit } as DotInfo
  })

  const colorCls: Record<string, string> = {
    g: 'cdot-green', y: 'cdot-yellow', r: 'cdot-red', s: 'cdot-gray',
  }

  function show(e: React.MouseEvent, dot: DotInfo) {
    if (hideTimer.current) clearTimeout(hideTimer.current)
    const { x, y } = fixedAnchorCenterTop(e.currentTarget as HTMLElement)
    setTip({ dot, x, y })
  }

  function scheduleHide() {
    hideTimer.current = setTimeout(() => setTip(null), 150)
  }

  function cancelHide() {
    if (hideTimer.current) clearTimeout(hideTimer.current)
  }

  return (
    <div className="cdot-row">
      {dots.map((d, i) => (
        <span
          key={i}
          className={`cdot ${colorCls[d.color] ?? 'cdot-gray'}`}
          onMouseEnter={e => show(e, d)}
          onMouseLeave={scheduleHide}
        />
      ))}
      {tip && createPortal(
        <span
          className="cdot-label"
          style={{ left: tip.x, top: tip.y - 8 }}
          onMouseEnter={cancelHide}
          onMouseLeave={() => setTip(null)}
        >
          <span className="cdot-label-name">
            {tip.dot.isInit && <em>init</em>}{tip.dot.name}{tip.dot.restarts > 0 ? ` ×${tip.dot.restarts}` : ''}
          </span>
          {(onLogs || onExec) && (
            <span className="cdot-label-actions">
              {onLogs && (
                <button
                  className="cdot-action-btn"
                  onClick={e => { e.stopPropagation(); onLogs(tip.dot.name, isLogFollowableColor(tip.dot.color)) }}
                  title="Logs"
                >
                  <ScrollText size={14} />
                </button>
              )}
              {onExec && tip.dot.color === 'g' && (
                <button
                  className="cdot-action-btn"
                  onClick={e => { e.stopPropagation(); onExec(tip.dot.name) }}
                  title="Terminal"
                >
                  <Terminal size={14} />
                </button>
              )}
            </span>
          )}
        </span>,
        document.body
      )}
    </div>
  )
}

function statusBadgeClass(kind: string, status: string): string {
  const s = status.toLowerCase()
  if (kind === 'pods') {
    if (s === 'running')                  return 'res-status-running'
    if (s === 'succeeded')                return 'res-status-succeeded'
    if (s === 'terminating')              return 'res-status-terminating'
    if (s === 'notready')                 return 'res-status-notready'
    if (s === 'pending')                  return 'res-status-pending'
    if (s === 'failed')                   return 'res-status-failed'
    if (s === 'evicted')                  return 'res-status-evicted'
    if (s === 'crashloopbackoff')         return 'res-status-failed'
    if (s === 'oomkilled')                return 'res-status-failed'
    if (s === 'errimagepull')             return 'res-status-failed'
    if (s === 'imagepullbackoff')         return 'res-status-warn'
    if (s === 'containercreating')        return 'res-status-pending'
    if (s.startsWith('init:'))            return 'res-status-pending'
    if (s === 'error')                    return 'res-status-failed'
  }
  if (kind === 'persistentvolumes' || kind === 'persistentvolumeclaims') {
    if (s === 'bound') return 'res-status-running'
    if (s === 'lost' || s === 'failed') return 'res-status-failed'
    // Available / Released / Pending / anything else — stand out vs Bound
    return 'res-status-warn'
  }
  if (kind === 'namespaces') {
    if (s === 'active')      return 'res-status-running'
    if (s === 'terminating') return 'res-status-terminating'
  }
  if (kind === 'events') {
    if (s === 'warning') return 'res-status-warn'
    if (s === 'normal')  return 'res-status-default'
  }
  if (kind === 'certificatesigningrequests') {
    if (s === 'approved') return 'res-status-running'
    if (s === 'denied')   return 'res-status-failed'
    if (s === 'failed')   return 'res-status-failed'
    if (s === 'pending')  return 'res-status-pending'
  }
  if (kind === 'volumeattachments') {
    if (s === 'true')  return 'res-status-running'
    if (s === 'false') return 'res-status-pending'
  }
  if (kind === 'jobs') {
    if (s === 'complete')   return 'res-status-succeeded'
    if (s === 'failed')     return 'res-status-failed'
    if (s === 'suspended')  return 'res-status-warn'
    if (s === 'active')     return 'res-status-running'
  }
  if (kind === 'deployments') {
    if (s === 'ready')        return 'res-status-running'
    if (s === 'rolling')      return 'res-status-rolling'
    if (s === 'progressing')  return 'res-status-pending'
    if (s === 'degraded')     return 'res-status-warn'
    if (s === 'unavailable')  return 'res-status-failed'
    if (s === 'failed')       return 'res-status-failed'
    if (s === 'scaled down')  return 'res-status-default'
  }
  return 'res-status-default'
}
export function ResourceTable({ profile, resource, namespaces, selectedNs, onNsChange, openPod, onOpenPodHandled, onOpenExec, onOpenLogs, onOpenFiles }: {
  profile: string
  resource: string
  namespaces: string[]
  selectedNs: string[] | null
  onNsChange: (v: string[]) => void
  openPod?: { name: string; namespace: string } | null
  onOpenPodHandled?: () => void
  onOpenExec?: (target: ExecTarget) => void
  onOpenLogs?: (target: LogsTarget) => void
  onOpenFiles?: (target: FilesTarget) => void
}) {
  const [data, setData] = useState<ResourceList | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [secondsAgo, setSecondsAgo] = useState(0)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [editTarget, setEditTarget] = useState<{ name: string; ns?: string } | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<{ name: string; ns?: string } | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteForm, setDeleteForm] = useState<DeleteFormState>(DEFAULT_DELETE_FORM)
  const [deleteError, setDeleteError] = useState('')
  const [infoTarget, setInfoTarget] = useState<InfoTarget | null>(null)

  useEffect(() => {
    if (resource !== 'pods' || !openPod) return
    setInfoTarget({
      type: 'k8s',
      kind: 'pods',
      name: openPod.name,
      namespace: openPod.namespace,
    })
    onOpenPodHandled?.()
  }, [resource, openPod, onOpenPodHandled])

  function openExec(target: ExecTarget) {
    onOpenExec?.(target)
  }

  function openLogs(target: LogsTarget) {
    onOpenLogs?.(target)
  }

  function openFiles(target: FilesTarget) {
    onOpenFiles?.(target)
  }

  const [podMetrics, setPodMetrics] = useState<Record<string, PodMetricsSummary>>({})
  const [nameQuery, setNameQuery] = useState('')
  const onNsChangeRef = useRef(onNsChange)
  onNsChangeRef.current = onNsChange

  useEffect(() => {
    function applyJump() {
      const jump = takeCommandPaletteJump(resource)
      if (!jump) return false
      // Search is cluster-wide — switch the table namespace to the hit's ns
      // so the row is visible (don't leave a stale sidebar ns filter).
      if (jump.namespace) {
        onNsChangeRef.current([jump.namespace])
      } else if (!CLUSTER_SCOPED_KINDS.has(resource)) {
        // Namespaced kind but no ns on the hit — show all namespaces.
        onNsChangeRef.current([])
      }
      setNameQuery(jump.name)
      setInfoTarget({
        type: 'k8s',
        kind: resource,
        name: jump.name,
        namespace: jump.namespace,
      })
      return true
    }
    // Clear the name filter when switching kinds, unless a search jump just landed.
    // Do not depend on onNsChange — a new inline callback after ns switch would
    // re-run this effect and wipe the query (seen on Linux / after kind change).
    if (!applyJump()) setNameQuery('')
    return subscribeCommandPaletteJump(() => { applyJump() })
  }, [resource, profile])

  const [restartTarget, setRestartTarget] = useState<{ name: string; ns?: string } | null>(null)
  const [evictTarget, setEvictTarget] = useState<{ name: string; ns?: string } | null>(null)
  const [suspendTarget, setSuspendTarget] = useState<{ name: string; ns?: string; resume: boolean } | null>(null)
  const [triggerTarget, setTriggerTarget] = useState<{ name: string; ns?: string } | null>(null)
  const [pauseTarget, setPauseTarget] = useState<{ name: string; ns?: string; resume: boolean } | null>(null)
  const [undoTarget, setUndoTarget] = useState<{ name: string; ns?: string } | null>(null)
  const [historyTarget, setHistoryTarget] = useState<{ name: string; ns?: string } | null>(null)
  const [csrTarget, setCsrTarget] = useState<{ name: string; deny: boolean } | null>(null)
  const [scaleTarget, setScaleTarget] = useState<{ name: string; ns?: string; current: number } | null>(null)
  const [scaleLoading, setScaleLoading] = useState(false)
  const [scaleError, setScaleError] = useState('')
  const [pfTarget, setPfTarget] = useState<{ kind: 'pod' | 'service'; name: string; ns: string; suggestedPorts: number[] } | null>(null)
  const [pfLoading, setPfLoading] = useState(false)
  const [pfError, setPfError] = useState('')
  const [pfSessions, setPfSessions] = useState<PortForwardSession[]>([])

  useEffect(() => {
    if (resource !== 'pods' && resource !== 'services') return
    let cancelled = false
    function fetchSessions() {
      api.listPortForwards(profile).then(d => { if (!cancelled) setPfSessions(d.sessions) }).catch(() => {})
    }
    fetchSessions()
    const t = setInterval(fetchSessions, 5_000)
    return () => { cancelled = true; clearInterval(t) }
  }, [profile, resource])

  function getCurrentReplicas(row: { fields: Record<string, string> }): number {
    const ready = row.fields['ready']
    if (ready) return parseInt(ready.split('/').pop() ?? '0') || 0
    return parseInt(row.fields['desired'] ?? '0') || 0
  }

  async function handleRestart(name: string, ns?: string) {
    await api.restartWorkload(profile, resource, name, ns).catch(() => {})
  }

  async function handleEvict(name: string, ns?: string) {
    await api.evictPod(profile, name, ns).catch(() => {})
  }

  async function handleSuspend(name: string, ns: string | undefined, resume: boolean) {
    if (resume) await api.resumeCronJob(profile, name, ns).catch(() => {})
    else await api.suspendCronJob(profile, name, ns).catch(() => {})
  }

  async function handleTrigger(name: string, ns?: string) {
    await api.triggerCronJob(profile, name, ns).catch(() => {})
  }

  async function handlePause(name: string, ns: string | undefined, resume: boolean) {
    if (resume) await api.resumeDeployment(profile, name, ns).catch(() => {})
    else await api.pauseDeployment(profile, name, ns).catch(() => {})
  }

  async function handleUndo(name: string, ns?: string) {
    await api.undoDeployment(profile, name, ns).catch(() => {})
  }

  async function handleCSR(name: string, deny: boolean) {
    if (deny) await api.denyCSR(profile, name).catch(() => {})
    else await api.approveCSR(profile, name).catch(() => {})
  }

  async function handleScale(replicas: number) {
    if (!scaleTarget) return
    setScaleLoading(true)
    setScaleError('')
    try {
      await api.scaleWorkload(profile, resource, scaleTarget.name, replicas, scaleTarget.ns)
      setScaleTarget(null)
    } catch (e) {
      setScaleError(e instanceof Error ? e.message : 'Scale failed')
    } finally {
      setScaleLoading(false)
    }
  }

  async function handlePortForward(localPort: number, remotePort: number, openInBrowser: boolean, schemeChoice: 'http' | 'https' | 'auto' = 'auto') {
    if (!pfTarget) return
    setPfLoading(true)
    setPfError('')
    try {
      const session = pfTarget.kind === 'service'
        ? await api.startServicePortForward(profile, pfTarget.ns, pfTarget.name, localPort, remotePort)
        : await api.startPortForward(profile, pfTarget.ns, pfTarget.name, localPort, remotePort)
      setPfTarget(null)
      api.listPortForwards(profile).then(d => setPfSessions(d.sessions)).catch(() => {})
      if (openInBrowser) {
        const scheme = schemeChoice === 'auto'
          ? (session.scheme === 'https' ? 'https' : 'http')
          : schemeChoice
        window.open(`${scheme}://localhost:${session.localPort}`, '_blank')
      }
    } catch (e) {
      setPfError(e instanceof Error ? e.message : 'Port forward failed')
    } finally {
      setPfLoading(false)
    }
  }

  async function handleStopPortForward(sessionId: string) {
    try {
      await api.stopPortForward(profile, sessionId)
      api.listPortForwards(profile).then(d => setPfSessions(d.sessions)).catch(() => {})
    } catch { /* ignore */ }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    setDeleteError('')
    try {
      await api.deleteResource(profile, resource, deleteTarget.name, deleteTarget.ns, deleteFormToOpts(deleteForm))
      setDeleteTarget(null)
      setDeleteForm(DEFAULT_DELETE_FORM)
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setDeleting(false)
    }
  }
  const esRef = useRef<EventSource | null>(null)
  const now = useNow()

  type ResourceRow = ResourceList['items'][number]

  function fieldValue(row: ResourceRow, key: string): string {
    return key === 'namespace' ? (row.namespace ?? '') : (row.fields[key] ?? '')
  }

  function isBadgeColumn(key: string): boolean {
    return key === 'status' ||
      (resource === 'events' && key === 'type') ||
      (resource === 'certificatesigningrequests' && key === 'condition') ||
      (resource === 'volumeattachments' && key === 'attached') ||
      (resource === 'ingresses' && key === 'tls')
  }

  const tableColumns = useMemo<SortableColDef<ResourceRow>[]>(() => {
    const defs = COLUMNS[resource] ?? []
    const fieldCols: SortableColDef<ResourceRow>[] = defs.map(def => {
      const key = def.key
      const col: SortableColDef<ResourceRow> = {
        key,
        label: def.label,
        mono: def.mono,
        sortValue: row => fieldValue(row, key),
        render: row => {
          const val = fieldValue(row, key)
          if (resource === 'cronjobs' && key === 'lastRun') {
            const ts = Number(val)
            if (!ts) return '—'
            return formatAge(now, ts)
          }
          if (resource === 'pods' && (key === 'cpu' || key === 'memory')) {
            const m = podMetrics[`${row.namespace ?? ''}/${row.name}`]
            if (!m) return '—'
            if (key === 'cpu') return (m.cpuMilli / 1000).toFixed(3)
            const MB = 1024 * 1024
            const GB = 1024 * MB
            return m.memBytes >= 1000 * MB
              ? `${(m.memBytes / GB).toFixed(2)}Gi`
              : `${(m.memBytes / MB).toFixed(1)}Mi`
          }
          if (resource === 'pods' && key === 'containers') {
            return (
              <ContainerDots
                value={val}
                onLogs={container => openLogs(logsTargetForPod(row.name, row.namespace ?? undefined, val, container))}
                onExec={container => openExec({ podName: row.name, namespace: row.namespace ?? undefined, container })}
              />
            )
          }
          if (resource === 'horizontalpodautoscalers' && key === 'metrics') {
            if (!val || val === '—') return '—'
            const parts = val.split('\n').filter(Boolean)
            return (
              <div className="hpa-metrics" title={parts.join(' · ')}>
                {parts.map((p, i) => (
                  <span key={i} className="hpa-metric-chip">{p}</span>
                ))}
              </div>
            )
          }
          if (isBadgeColumn(key)) {
            return <span className={`badge ${statusBadgeClass(resource, val)}`}>{val}</span>
          }
          return val
        },
      }
      if (resource === 'cronjobs' && key === 'lastRun') {
        col.cellStyle = row => {
          const ts = Number(fieldValue(row, key))
          return !ts ? { color: 'var(--text3)' } : undefined
        }
      }
      if (resource === 'pods' && (key === 'cpu' || key === 'memory')) {
        col.cellStyle = row => {
          const m = podMetrics[`${row.namespace ?? ''}/${row.name}`]
          return !m ? { color: 'var(--text3)' } : undefined
        }
      }
      if (resource === 'horizontalpodautoscalers' && key === 'metrics') {
        col.cellStyle = row => {
          const val = fieldValue(row, key)
          return !val || val === '—' ? { color: 'var(--text3)' } : undefined
        }
      }
      return col
    })
    return [
      {
        key: 'name',
        label: 'Name',
        mono: true,
        sortValue: row => row.name,
        render: row => row.name,
      },
      ...fieldCols,
      {
        key: 'age',
        label: 'Age',
        mono: true,
        cellClassName: 'ov-age',
        sortValue: row => row.age,
        render: row => formatAge(now, row.age),
      },
    ]
  }, [resource, now, podMetrics])

  // ── EventSource ───────────────────────────────────────────────────────────────
  const isClusterScoped = CLUSTER_SCOPED_KINDS.has(resource)
  const createNs = resolveCreateNamespace(selectedNs, isClusterScoped)
  const showCreate = canCreateResource(resource, selectedNs, isClusterScoped)

  // Derived: what namespace to pass to the SSE endpoint
  const connNs = isClusterScoped ? ''
    : selectedNs === null ? null
    : selectedNs.length === 1 ? selectedNs[0]
    : ''

  const connectRef = useRef<(ns: string, keepData?: boolean) => void>(() => {})
  const { clear: clearAutoReconnect, schedule: scheduleAutoReconnect, onFailure: onWatchFailure, resetAttempts } =
    useAutoReconnect(() => {
      if (connNs === null) return
      connectRef.current(connNs, true)
    }, {
      onExhausted: () => {
        setError('Could not reach cluster — stopped retrying.')
        setLoading(false)
      },
    })

  function connect(ns: string, keepData = false) {
    clearAutoReconnect()
    esRef.current?.close()
    esRef.current = null
    if (!keepData) {
      setLoading(true)
      setData(null)
    }
    setError('')
    const qs = ns ? `?namespace=${encodeURIComponent(ns)}` : ''
    const es = new EventSource(withAccessToken(`/api/profiles/${profile}/k8s/watch-resources/${resource}${qs}`))
    esRef.current = es
    es.onmessage = (e) => {
      const msg = JSON.parse(e.data) as { type: string; data?: ResourceList; message?: string }
      if (msg.type === 'list' && msg.data) {
        setData(msg.data)
        setLoading(false)
        setLastUpdated(new Date())
        setError('')
        resetAttempts()
        clearAutoReconnect()
      } else if (msg.type === 'error') {
        const message = msg.message ?? 'Error'
        setError(message)
        setLoading(false)
        es.close()
        onWatchFailure(message)
      }
    }
    es.onerror = () => {
      setError('Connection lost — retrying…')
      scheduleAutoReconnect()
    }
  }
  connectRef.current = connect

  const permNs = isClusterScoped ? undefined : (connNs || undefined)
  const permissions = useResourcePermissions(
    profile,
    resource,
    permNs,
    K8S_RESOURCE_KINDS.has(resource) && connNs !== null,
  )

  // Client-side filter when 2+ specific namespaces are selected
  function applyNsFilter(items: ResourceList['items']): ResourceList['items'] {
    if (!selectedNs || selectedNs.length <= 1) return items
    const nsSet = new Set(selectedNs)
    return items.filter(item => nsSet.has(item.namespace ?? ''))
  }

  function applyFilters(items: ResourceList['items']): ResourceList['items'] {
    return applyNsFilter(items).filter(item => matchesNameQuery(item.name, nameQuery))
  }

  useEffect(() => {
    esRef.current?.close()
    esRef.current = null
    clearAutoReconnect()
    if (connNs === null) return
    connect(connNs)
    return () => {
      clearAutoReconnect()
      esRef.current?.close()
      esRef.current = null
    }
  }, [profile, resource, connNs])

  useEffect(() => {
    if (resource !== 'pods' || connNs === null) { setPodMetrics({}); return }
    let cancelled = false
    function fetchMetrics() {
      api.getAllPodMetrics(profile, connNs || undefined)
        .then(items => { if (!cancelled) setPodMetrics(items) })
        .catch(() => {})
    }
    fetchMetrics()
    const t = setInterval(fetchMetrics, 30_000)
    return () => { cancelled = true; clearInterval(t) }
  }, [profile, resource, connNs])

  useEffect(() => {
    if (!lastUpdated) return
    setSecondsAgo(0)
    const t = setInterval(() => setSecondsAgo(s => s + 1), 1000)
    return () => clearInterval(t)
  }, [lastUpdated])

  const toolbarLeft = (
    <>
      {!isClusterScoped && (
        <NamespaceCombo
          namespaces={namespaces}
          value={selectedNs}
          onChange={onNsChange}
        />
      )}
      <NameFilterInput value={nameQuery} onChange={setNameQuery} />
      <span className="res-count">
        {data ? `${applyFilters(data.items).length} items` : ''}
      </span>
    </>
  )

  const resourceActionSetters: ResourceActionSetters = {
    setPfError,
    setPfTarget,
    setRestartTarget,
    setEvictTarget,
    setScaleTarget,
    setScaleError,
    setTriggerTarget,
    setSuspendTarget,
    setPauseTarget,
    setUndoTarget,
    setHistoryTarget,
    setCsrTarget,
  }

  const resourceActionCallbacks: ResourceActionCallbacks = {
    openLogs,
    openExec,
    openFiles,
    handleStopPortForward,
  }

  const infoPanelListItem = infoTarget
    ? data?.items.find(r => r.name === infoTarget.name)
    : undefined
  const infoPanelNsItem = infoTarget
    ? data?.items.find(r =>
        r.name === infoTarget.name && (r.namespace ?? '') === (infoTarget.namespace ?? ''))
    : undefined
  const infoPanelActions = infoTarget
    ? getResourceInfoPanelActionProps({
        resource,
        item: {
          name: infoTarget.name,
          namespace: infoTarget.namespace,
          fields: infoPanelListItem?.fields,
        },
        containersField: infoPanelNsItem?.fields?.containers,
        scaleCurrent: infoPanelListItem ? getCurrentReplicas(infoPanelListItem) : 1,
        pfSessions,
        getCurrentReplicas,
        setters: resourceActionSetters,
        callbacks: resourceActionCallbacks,
        closeInfoPanel: () => setInfoTarget(null),
      })
    : null

  const toolbarRight = (
    <>
      {showCreate && connNs !== null && (
        <button
          className={`col-settings-btn${permissions && !permissions.create ? ' res-create-btn-disabled' : ''}`}
          onClick={() => setCreateOpen(true)}
          disabled={permissions !== null && permissions.create === false}
          data-tooltip={permissions && permissions.create === false ? 'Permission denied' : 'Create'}
        >
          <Plus size={15} />
        </button>
      )}
      {selectedNs !== null && lastUpdated && !error && (
        <span className="last-updated">
          <span className="live-dot" />
          {secondsAgo < 5 ? 'live' : `${secondsAgo}s ago`}
        </span>
      )}
    </>
  )

  return (
    <div>
      {connNs === null && (
        <>
          <div className="res-table-toolbar">
            <div className="res-toolbar-left">{toolbarLeft}</div>
            <div className="res-toolbar-right">{toolbarRight}</div>
          </div>
          <div className="res-placeholder">
          <EmptyState
            title="Select a namespace"
            hint="Choose a namespace above to load resources of this kind."
          />
          </div>
        </>
      )}
      {connNs !== null && (
        <ErrorReconnectBanner
          error={error}
          onReconnect={() => {
            clearAutoReconnect()
            setError('')
            connect(connNs, true)
          }}
        />
      )}
      {connNs !== null && loading && !data && <div className="cv-loading">Loading…</div>}

      {createOpen && (
        <YamlPanel
          mode="create"
          profile={profile}
          title={`Create ${RESOURCE_LABELS[resource] ?? resource}`}
          resourceRef={{ type: 'k8s', kind: resource, name: 'new' }}
          initialYaml={getResourceTemplate(resource, createNs || 'default')}
          defaultNamespace={createNs || undefined}
          onClose={() => setCreateOpen(false)}
          onCreated={() => setCreateOpen(false)}
        />
      )}
      {editTarget && (
        <YamlPanel
          profile={profile}
          title={`${resource}/${editTarget.name}`}
          resourceRef={{ type: 'k8s', kind: resource, name: editTarget.name, namespace: editTarget.ns } as ResourceRef}
          onClose={() => setEditTarget(null)}
        />
      )}
      {deleteTarget && (
        <ConfirmDialog
          title={`Delete ${resource}`}
          message={`Delete "${deleteTarget.name}"? This cannot be undone.`}
          confirmLabel={deleting ? 'Deleting…' : 'Delete'}
          error={deleteError}
          onConfirm={handleDelete}
          onCancel={() => { setDeleteTarget(null); setDeleteError(''); setDeleteForm(DEFAULT_DELETE_FORM) }}
        >
          <DeleteOptionsFields value={deleteForm} onChange={setDeleteForm} />
        </ConfirmDialog>
      )}

      {infoTarget && (
        <ResourceInfoPanel
          profile={profile}
          target={infoTarget}
          onCopy={() => navigator.clipboard.writeText(infoTarget.name)}
          onEdit={() => {
            if (infoTarget.type === 'k8s') {
              setEditTarget({ name: infoTarget.name, ns: infoTarget.namespace })
            }
            setInfoTarget(null)
          }}
          onDelete={() => { setDeleteError(''); setDeleteForm(DEFAULT_DELETE_FORM); setDeleteTarget({ name: infoTarget.name, ns: infoTarget.namespace ?? undefined }); setInfoTarget(null) }}
          onClose={() => setInfoTarget(null)}
          {...infoPanelActions!}
        />
      )}

      {restartTarget && (
        <ConfirmDialog
          title={`Restart ${resource.replace(/s$/, '')} "${restartTarget.name}"?`}
          message="A rolling restart will be triggered. All pods will be replaced one by one."
          confirmLabel="Restart"
          danger={false}
          onConfirm={() => { handleRestart(restartTarget.name, restartTarget.ns); setRestartTarget(null) }}
          onCancel={() => setRestartTarget(null)}
        />
      )}
      {evictTarget && (
        <ConfirmDialog
          title={`Evict pod "${evictTarget.name}"?`}
          message="The pod will be gracefully evicted. If it belongs to a controller, a replacement will be scheduled. PodDisruptionBudgets will be respected."
          confirmLabel="Evict"
          danger={true}
          onConfirm={() => { handleEvict(evictTarget.name, evictTarget.ns); setEvictTarget(null) }}
          onCancel={() => setEvictTarget(null)}
        />
      )}

      {suspendTarget && (
        <ConfirmDialog
          title={suspendTarget.resume
            ? `Resume CronJob "${suspendTarget.name}"?`
            : `Suspend CronJob "${suspendTarget.name}"?`}
          message={suspendTarget.resume
            ? 'The CronJob will start creating Jobs again according to its schedule.'
            : 'The CronJob will stop creating new Jobs until resumed. Already running Jobs are not affected.'}
          confirmLabel={suspendTarget.resume ? 'Resume' : 'Suspend'}
          danger={!suspendTarget.resume}
          onConfirm={() => {
            handleSuspend(suspendTarget.name, suspendTarget.ns, suspendTarget.resume)
            setSuspendTarget(null)
          }}
          onCancel={() => setSuspendTarget(null)}
        />
      )}

      {triggerTarget && (
        <ConfirmDialog
          title={`Trigger CronJob "${triggerTarget.name}"?`}
          message="A one-off Job will be created from this CronJob template (same as kubectl create job --from=cronjob/…)."
          confirmLabel="Trigger"
          danger={false}
          onConfirm={() => {
            handleTrigger(triggerTarget.name, triggerTarget.ns)
            setTriggerTarget(null)
          }}
          onCancel={() => setTriggerTarget(null)}
        />
      )}

      {pauseTarget && (
        <ConfirmDialog
          title={pauseTarget.resume
            ? `Resume rollout "${pauseTarget.name}"?`
            : `Pause rollout "${pauseTarget.name}"?`}
          message={pauseTarget.resume
            ? 'The Deployment will continue rolling out any pending changes.'
            : 'The Deployment rollout will be paused. Spec changes will not create a new rollout until resumed.'}
          confirmLabel={pauseTarget.resume ? 'Resume' : 'Pause'}
          danger={false}
          onConfirm={() => {
            handlePause(pauseTarget.name, pauseTarget.ns, pauseTarget.resume)
            setPauseTarget(null)
          }}
          onCancel={() => setPauseTarget(null)}
        />
      )}

      {undoTarget && (
        <ConfirmDialog
          title={`Undo rollout "${undoTarget.name}"?`}
          message="Roll back to the previous revision (same as kubectl rollout undo)."
          confirmLabel="Undo"
          danger={true}
          onConfirm={() => {
            handleUndo(undoTarget.name, undoTarget.ns)
            setUndoTarget(null)
          }}
          onCancel={() => setUndoTarget(null)}
        />
      )}

      {historyTarget && (
        <RolloutHistoryDialog
          profile={profile}
          name={historyTarget.name}
          namespace={historyTarget.ns}
          onClose={() => setHistoryTarget(null)}
          onRolledBack={() => {}}
        />
      )}

      {csrTarget && (
        <ConfirmDialog
          title={csrTarget.deny
            ? `Deny CSR "${csrTarget.name}"?`
            : `Approve CSR "${csrTarget.name}"?`}
          message={csrTarget.deny
            ? 'The certificate request will be denied and will not be signed. This cannot be undone.'
            : 'The certificate request will be approved. The signer may then issue a certificate. This cannot be undone.'}
          confirmLabel={csrTarget.deny ? 'Deny' : 'Approve'}
          danger={csrTarget.deny}
          onConfirm={() => {
            handleCSR(csrTarget.name, csrTarget.deny)
            setCsrTarget(null)
          }}
          onCancel={() => setCsrTarget(null)}
        />
      )}

      {scaleTarget && (
        <ScaleDialog
          resourceName={scaleTarget.name}
          current={scaleTarget.current}
          onConfirm={handleScale}
          onCancel={() => { setScaleTarget(null); setScaleError('') }}
          error={scaleError}
          loading={scaleLoading}
        />
      )}

      {pfTarget && (
        <PortForwardDialog
          podName={pfTarget.name}
          namespace={pfTarget.ns}
          suggestedPorts={pfTarget.suggestedPorts}
          onConfirm={handlePortForward}
          onCancel={() => { setPfTarget(null); setPfError('') }}
          error={pfError}
          loading={pfLoading}
        />
      )}

      {connNs !== null && (
        <SortableTable
          columns={tableColumns}
          rows={data ? applyFilters(data.items) : []}
          rowKey={row => `${row.namespace ?? ''}/${row.name}`}
          defaultSortKey="name"
          settingsKey={resource}
          defaultHidden={new Set(DEFAULT_HIDDEN[resource] ?? [])}
          lockedColumns={new Set(['name'])}
          toolbarLeft={toolbarLeft}
          toolbarRight={toolbarRight}
          emptyMessage={
            <EmptyState
              compact
              title={`No ${RESOURCE_LABELS[resource] ?? resource} found`}
              hint={
                selectedNs && selectedNs.length > 1
                  ? 'Nothing matches the selected namespaces. Try All namespaces or another filter.'
                  : 'This view has no items right now. Create one with + if your account allows it.'
              }
            />
          }
          onRowClick={row => setInfoTarget({ type: 'k8s', kind: resource, name: row.name, namespace: row.namespace ?? undefined })}
          actions={row => (
            <ActionButtons
              {...getResourceActionButtonsProps({
                resource,
                item: { name: row.name, namespace: row.namespace ?? undefined, fields: row.fields },
                pfSessions,
                getCurrentReplicas,
                setters: resourceActionSetters,
                callbacks: resourceActionCallbacks,
                onCopy: () => navigator.clipboard.writeText(row.name),
                onEdit: () => setEditTarget({ name: row.name, ns: row.namespace ?? undefined }),
                onDelete: () => {
                  setDeleteError('')
                  setDeleteForm(DEFAULT_DELETE_FORM)
                  setDeleteTarget({ name: row.name, ns: row.namespace ?? undefined })
                },
                permissions,
              })}
            />
          )}
        />
      )}
    </div>
  )
}
