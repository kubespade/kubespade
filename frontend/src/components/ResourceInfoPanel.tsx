import { useEffect, useState } from 'react'
import { useEscapeKey } from '../hooks/useEscapeKey'
import { createPortal } from 'react-dom'
import { ArrowDownFromLine, Ban, Check, CheckCircle2, ChevronsUpDown, CirclePlay, Copy, ExternalLink, FolderOpen, History, Lock, LockOpen, LogOut, Pause, Pencil, Play, Plug, RotateCcw, ScrollText, Tags, Terminal, Trash2, Undo2, X } from 'lucide-react'
import { api } from '../api/client'
import type { ResourceEvent } from '../api/client'
import { useResourcePermissions } from '../hooks/useResourcePermissions'
import type { PermissionKey } from '../lib/k8sPermissions'
import { useNow } from '../hooks/useNow'
import {
  arr,
  getProperties,
  podTemplateSpec,
  raw,
  rec,
} from '../lib/resourceInfoProps'
import {
  ConfigMapDataSection,
  EventsList,
  NodePodsList,
  PropTable,
  SecretDataSection,
  Section,
} from './resourceInfo/DataSections'
import { NodeMetricsHeader, PodMetricsHeader } from './resourceInfo/MetricsChartSection'
import { ContainersSection } from './resourceInfo/ContainersSection'
import { useResourceMetrics } from './resourceInfo/useResourceMetrics'
import type { InfoTarget, ResourceInfoPanelProps } from './resourceInfo/types'

export type { InfoTarget }

export function ResourceInfoPanel({
  profile, target, onEdit, onClose, onDelete, onCopy, onLogs, onExec, onFiles, onRestart, onScale,
  onSuspend, onResume, onPause, onTrigger, onUndo, onHistory, onApprove, onDeny, onPortForward,
  activePortForward, onStopPortForward, onCordon, onUncordon, onDrain, onTaints, onEvict,
  onOpenInPods, aboveActionLog = false,
}: ResourceInfoPanelProps) {
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null)
  const [copied, setCopied] = useState(false)
  const [events, setEvents] = useState<ResourceEvent[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const now = useNow()

  const {
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
  } = useResourceMetrics(profile, target)

  function handleCopy() {
    onCopy?.()
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(''); setDetail(null); setEvents(null)
    resetMetrics()

    const detailP = target.type === 'k8s'
      ? api.getResourceDetail(profile, target.kind, target.name, target.namespace)
      : api.getCRDResourceDetail(profile, target.group, target.version, target.plural, target.name, target.namespace)

    const eventsP = target.type === 'k8s'
      ? api.getResourceEvents(profile, target.kind, target.name, target.namespace)
      : api.getCRDResourceEvents(profile, target.group, target.version, target.plural, target.name, target.namespace, target.kind)

    Promise.all([detailP, eventsP])
      .then(([d, ev]) => { if (!cancelled) { setDetail(d); setEvents(ev); setLoading(false) } })
      .catch(e => { if (!cancelled) { setError(e instanceof Error ? e.message : 'Failed to load'); setLoading(false) } })

    loadNodeExtras(() => cancelled)

    return () => { cancelled = true }
  }, [profile, target])

  useEscapeKey(onClose)

  function getSuggestedPorts(): number[] {
    if (!detail) return []
    const spec = rec(detail.spec)
    if (target.type === 'k8s' && target.kind === 'pods') {
      const result: number[] = []
      for (const c of arr(spec.containers)) {
        for (const port of arr(rec(c).ports)) {
          const p = Number(raw(rec(port).containerPort))
          if (p > 0 && !result.includes(p)) result.push(p)
        }
      }
      return result
    }
    if (target.type === 'k8s' && target.kind === 'services') {
      // Service ports (backend maps them to container targetPorts).
      return arr(spec.ports)
        .map(p => Number(raw(rec(p).port)))
        .filter(p => p > 0)
    }
    return []
  }

  const displayKind = target.kind
  const displayName = target.name
  const k8sKind = target.type === 'k8s' ? target.kind : ''
  const permissions = useResourcePermissions(profile, k8sKind, target.namespace, target.type === 'k8s')

  function canPerm(key: PermissionKey): boolean {
    if (permissions === undefined) return true
    if (permissions === null) return false
    if (key in permissions) return permissions[key] === true
    return true
  }

  function ipBtn(key: PermissionKey | null, label: string, onClick: () => void, icon: React.ReactNode, className = 'ip-btn') {
    const denied = key !== null && !canPerm(key)
    return (
      <button
        type="button"
        className={`${className}${denied ? ' ip-btn-disabled' : ''}`}
        disabled={denied}
        onClick={() => { if (!denied) onClick() }}
        data-tooltip={denied ? 'Permission denied' : label}
      >
        {icon}
      </button>
    )
  }

  const props = detail
    ? getProperties(target.type === 'k8s' ? target.kind : '', detail, now)
    : []

  return createPortal(
    <>
      <div className={`ip-backdrop overlay-backdrop${aboveActionLog ? ' stack-above-nal' : ''}`} onMouseDown={onClose} />
      <div className={`ip-panel overlay-sheet${aboveActionLog ? ' stack-above-nal' : ''}`} onMouseDown={e => e.stopPropagation()}>

        <div className="ip-header">
          <div className="ip-header-left">
            <span className="ip-kind">{displayKind}</span>
            <span className="ip-name">{displayName}</span>
          </div>
          <div className="ip-header-actions">
            {onCopy && (
              <button className="ip-btn" onClick={handleCopy} data-tooltip={copied ? 'Copied!' : 'Copy name'}>
                {copied ? <Check size={12} /> : <Copy size={12} />}
              </button>
            )}
            {onLogs && ipBtn('logs', 'Logs', onLogs, <ScrollText size={12} />)}
            {onExec && ipBtn('exec', 'Terminal', () => onExec(), <Terminal size={12} />)}
            {onFiles && ipBtn('exec', 'Files', () => onFiles(), <FolderOpen size={12} />)}
            {activePortForward && onStopPortForward ? (
              <button className="ip-btn ip-btn-active" onClick={onStopPortForward} data-tooltip={`Stop :${activePortForward.localPort}`}><Plug size={12} /></button>
            ) : onPortForward ? (
              ipBtn('portForward', 'Port Forward', () => onPortForward(getSuggestedPorts()), <Plug size={12} />)
            ) : null}
            {onRestart && ipBtn('restart', 'Restart', onRestart, <RotateCcw size={12} />)}
            {onScale && ipBtn('scale', 'Scale', onScale, <ChevronsUpDown size={12} />)}
            {onTrigger && ipBtn('trigger', 'Trigger now', onTrigger, <CirclePlay size={12} />)}
            {onPause && ipBtn('suspend', 'Pause rollout', onPause, <Pause size={12} />)}
            {onSuspend && ipBtn('suspend', 'Suspend', onSuspend, <Pause size={12} />)}
            {onResume && ipBtn('suspend', 'Resume', onResume, <Play size={12} />, 'ip-btn ip-btn-warn')}
            {onUndo && ipBtn('undo', 'Undo rollout', onUndo, <Undo2 size={12} />)}
            {onHistory && (
              <button className="ip-btn" onClick={onHistory} data-tooltip="Rollout history"><History size={12} /></button>
            )}
            {onApprove && ipBtn('approve', 'Approve CSR', onApprove, <CheckCircle2 size={12} />)}
            {onDeny && ipBtn('deny', 'Deny CSR', onDeny, <Ban size={12} />, 'ip-btn ip-btn-danger')}
            {onCordon && ipBtn('cordon', 'Cordon', onCordon, <Lock size={12} />)}
            {onUncordon && ipBtn('uncordon', 'Uncordon', onUncordon, <LockOpen size={12} />, 'ip-btn ip-btn-warn')}
            {onDrain && ipBtn('drain', 'Drain', onDrain, <ArrowDownFromLine size={12} />, 'ip-btn ip-btn-danger')}
            {onTaints && ipBtn('taint', 'Edit taints', onTaints, <Tags size={12} />)}
            {onEvict && ipBtn('evict', 'Evict', onEvict, <LogOut size={12} />)}
            {onOpenInPods && (
              <button className="ip-btn" onClick={onOpenInPods} data-tooltip="Open in Pods">
                <ExternalLink size={12} />
              </button>
            )}
            {ipBtn('edit', 'Edit YAML', onEdit, <Pencil size={12} />)}
            {onDelete && ipBtn('delete', 'Delete', onDelete, <Trash2 size={12} />, 'ip-btn ip-btn-danger')}
            <button className="ip-btn ip-btn-close" onClick={onClose} data-tooltip="Close"><X size={12} /></button>
          </div>
        </div>

        <div className="ip-body">
          {loading && <div className="ip-loading">Loading…</div>}
          {error   && <div className="ip-error">{error}</div>}

          {target.type === 'k8s' && target.kind === 'pods' && detail && metricsMap && Object.keys(metricsMap).length > 0 && (
            <PodMetricsHeader
              spec={rec(detail.spec)}
              metricsMap={metricsMap}
              history={metricsHistory}
              longHistory={historySource === 'prometheus' || collectorEnabled}
              retentionDays={historySource === 'prometheus' ? 30 : collectorRetentionDays}
              historySource={historySource}
              resourceName={target.name}
            />
          )}

          {target.type === 'k8s' && target.kind === 'nodes' && detail && nodeMetrics && (nodeMetrics.cpuMilli > 0 || nodeMetrics.memBytes > 0) && (
            <NodeMetricsHeader
              status={rec(detail.status)}
              metrics={nodeMetrics}
              history={nodeMetricsHistory}
              longHistory={historySource === 'prometheus' || collectorEnabled}
              retentionDays={historySource === 'prometheus' ? 30 : collectorRetentionDays}
              historySource={historySource}
              resourceName={target.name}
            />
          )}

          {detail && !loading && (
            <>
              <Section title="Properties">
                <PropTable props={props} />
              </Section>

              {target.type === 'k8s' && target.kind === 'configmaps' && (
                <Section title="Data" count={
                  Object.keys(rec(detail.data)).length + Object.keys(rec(detail.binaryData)).length
                }>
                  <ConfigMapDataSection data={rec(detail.data)} binaryData={rec(detail.binaryData)} />
                </Section>
              )}

              {target.type === 'k8s' && target.kind === 'secrets' && (
                <Section title="Data" count={Object.keys(rec(detail.data)).length}>
                  <SecretDataSection data={rec(detail.data)} />
                </Section>
              )}

              {target.type === 'k8s' && (() => {
                const podSpec = podTemplateSpec(target.kind, rec(detail.spec))
                if (!podSpec) return null
                const n = arr(podSpec.containers).length + arr(podSpec.initContainers).length + arr(podSpec.ephemeralContainers).length
                if (n === 0) return null
                return (
                  <Section title="Containers" count={n}>
                    <ContainersSection
                      spec={podSpec}
                      status={target.kind === 'pods' ? rec(detail.status) : {}}
                      profile={profile}
                      namespace={target.namespace}
                      onExec={target.kind === 'pods' ? onExec : undefined}
                    />
                  </Section>
                )
              })()}

              {target.type === 'k8s' && target.kind === 'nodes' && (
                <Section title="Pods" count={nodePods?.length}>
                  <NodePodsList pods={nodePods} />
                </Section>
              )}

              {events !== null && (
                <Section title="Events" count={events.length}>
                  <EventsList events={events} now={now} />
                </Section>
              )}
            </>
          )}
        </div>
      </div>
    </>,
    document.body
  )
}
