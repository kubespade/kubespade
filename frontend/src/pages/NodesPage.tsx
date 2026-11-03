import { useEffect, useMemo, useState } from 'react'
import type { Resource } from '../lib/resourceKinds'
import type { NodeInfo } from '../types'
import { api } from '../api/client'
import type { NodeMetricsSummary } from '../api/client'
import { SortableTable } from '../components/SortableTable'
import type { ColDef as SortableColDef } from '../components/SortableTable'
import { EmptyState } from '../components/EmptyState'
import { NameFilterInput, matchesNameQuery } from '../components/NameFilterInput'
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
import { NodeTaintsDialog } from '../components/NodeTaintsDialog'
import { NodeActionLog } from '../components/NodeActionLog'
import { ResourceInfoPanel } from '../components/ResourceInfoPanel'
import type { InfoTarget } from '../components/ResourceInfoPanel'
import type { ExecTarget } from '../components/ExecPanel'
import { useWorkbench } from '../lib/workbenchContext'
import { useResourcePermissions } from '../hooks/useResourcePermissions'
import {
  NODE_COLUMNS,
  NODE_COLUMNS_DEFAULT_HIDDEN,
} from '../lib/resourceTableConfig'
import { fmtCPUMilli, fmtMemBytes } from '../lib/metricFormat'

interface Props {
  profile: string
  nodes: NodeInfo[]
  /** Patch nodes list in parent ClusterInfo */
  onNodesChange: (updater: (prev: NodeInfo[]) => NodeInfo[]) => void
  onRefreshClusterInfo: () => void
  onSelectResource?: (resource: Resource) => void
  onNsChange: (ns: string[] | null) => void
}

export function NodesPage({
  profile,
  nodes,
  onNodesChange,
  onRefreshClusterInfo,
  onSelectResource,
  onNsChange,
}: Props) {
  const [nodeEditName, setNodeEditName] = useState<string | null>(null)
  const [nodeDeleteName, setNodeDeleteName] = useState<string | null>(null)
  const [nodeDeleteForm, setNodeDeleteForm] = useState<DeleteFormState>(DEFAULT_DELETE_FORM)
  const [nodeDeleting, setNodeDeleting] = useState(false)
  const [nodeDeleteError, setNodeDeleteError] = useState('')
  const [nodeInfoTarget, setNodeInfoTarget] = useState<InfoTarget | null>(null)
  const workbench = useWorkbench()
  function openNodeExec(target: ExecTarget) { workbench.openExec(profile, target) }
  const [nodeMetrics, setNodeMetrics] = useState<Record<string, NodeMetricsSummary>>({})
  const [nodeNameQuery, setNodeNameQuery] = useState('')
  const [drainTarget, setDrainTarget] = useState<string | null>(null)
  const [drainConfirmTarget, setDrainConfirmTarget] = useState<string | null>(null)
  /** Pod opened from Drain log — Info/Delete stack above the log without closing it. */
  const [drainPodInfo, setDrainPodInfo] = useState<InfoTarget | null>(null)
  const [drainPodEdit, setDrainPodEdit] = useState<{ name: string; ns: string } | null>(null)
  const [drainPodDelete, setDrainPodDelete] = useState<{ name: string; ns: string } | null>(null)
  const [drainPodDeleteForm, setDrainPodDeleteForm] = useState<DeleteFormState>(DEFAULT_DELETE_FORM)
  const [drainPodDeleting, setDrainPodDeleting] = useState(false)
  const [drainPodDeleteError, setDrainPodDeleteError] = useState('')
  const [cordonTarget, setCordonTarget] = useState<string | null>(null)
  const [uncordonTarget, setUncordonTarget] = useState<string | null>(null)
  const [uncordonBusy, setUncordonBusy] = useState(false)
  const [uncordonError, setUncordonError] = useState('')
  const [taintsTarget, setTaintsTarget] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    function fetchMetrics() {
      api.getAllNodeMetrics(profile)
        .then(m => { if (!cancelled) setNodeMetrics(m) })
        .catch(() => {})
    }
    fetchMetrics()
    const t = setInterval(fetchMetrics, 30_000)
    return () => { cancelled = true; clearInterval(t) }
  }, [profile])

  const nodePermissions = useResourcePermissions(profile, 'nodes', undefined, true)

  const nodeColumnsActive = useMemo<SortableColDef<NodeInfo>[]>(() =>
    NODE_COLUMNS.map(col => {
      if (col.key === 'cpuCap') return {
        ...col,
        sortValue: (n: NodeInfo) => nodeMetrics[n.name]?.cpuMilli ?? 0,
        render: (n: NodeInfo) => {
          const m = nodeMetrics[n.name]
          if (!m || !n.cpuAllocMilli) return n.cpuAlloc || n.cpuCap || '—'
          return `${fmtCPUMilli(m.cpuMilli)} / ${fmtCPUMilli(n.cpuAllocMilli)}`
        },
      }
      if (col.key === 'memCap') return {
        ...col,
        sortValue: (n: NodeInfo) => nodeMetrics[n.name]?.memBytes ?? 0,
        render: (n: NodeInfo) => {
          const m = nodeMetrics[n.name]
          if (!m || !n.memAllocBytes) return n.memAlloc || n.memCap || '—'
          return `${fmtMemBytes(m.memBytes)} / ${fmtMemBytes(n.memAllocBytes)}`
        },
      }
      return col
    }),
  [nodeMetrics])

  async function handleCordon(nodeName: string) {
    try {
      await api.cordonNode(profile, nodeName)
      onNodesChange(prev => prev.map(n => n.name === nodeName ? { ...n, unschedulable: true } : n))
    } catch { /* ignore */ }
  }

  async function handleUncordon() {
    if (!uncordonTarget || uncordonBusy) return
    setUncordonBusy(true)
    setUncordonError('')
    try {
      await api.uncordonNode(profile, uncordonTarget)
      const name = uncordonTarget
      onNodesChange(prev => prev.map(n => n.name === name ? { ...n, unschedulable: false } : n))
      setUncordonTarget(null)
    } catch (e) {
      setUncordonError(e instanceof Error ? e.message : 'Uncordon failed')
    } finally {
      setUncordonBusy(false)
    }
  }

  async function handleNodeDelete() {
    if (!nodeDeleteName) return
    setNodeDeleting(true)
    setNodeDeleteError('')
    try {
      await api.deleteResource(profile, 'nodes', nodeDeleteName, undefined, deleteFormToOpts(nodeDeleteForm))
      setNodeDeleteName(null)
      setNodeDeleteForm(DEFAULT_DELETE_FORM)
    } catch (e) {
      setNodeDeleteError(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setNodeDeleting(false)
    }
  }

  async function handleDrainPodDelete() {
    if (!drainPodDelete) return
    setDrainPodDeleting(true)
    setDrainPodDeleteError('')
    try {
      await api.deleteResource(
        profile,
        'pods',
        drainPodDelete.name,
        drainPodDelete.ns,
        deleteFormToOpts(drainPodDeleteForm),
      )
      setDrainPodDelete(null)
      setDrainPodDeleteForm(DEFAULT_DELETE_FORM)
      setDrainPodInfo(null)
    } catch (e) {
      setDrainPodDeleteError(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setDrainPodDeleting(false)
    }
  }

  const filteredNodes = nodes.filter(n => matchesNameQuery(n.name, nodeNameQuery))

  return (
    <>
      <SortableTable
        columns={nodeColumnsActive}
        rows={filteredNodes}
        rowKey={n => n.name}
        defaultSortKey="name"
        emptyMessage={
          <EmptyState
            compact
            title="No nodes found"
            hint={nodeNameQuery.trim() ? 'Nothing matches this name filter.' : 'This cluster has no nodes reported yet.'}
          />
        }
        settingsKey="nodes"
        defaultHidden={NODE_COLUMNS_DEFAULT_HIDDEN}
        lockedColumns={new Set(['name'])}
        toolbarLeft={
          <>
            <NameFilterInput value={nodeNameQuery} onChange={setNodeNameQuery} />
            <span className="res-count">{filteredNodes.length} nodes</span>
          </>
        }
        onRowClick={n => setNodeInfoTarget({ type: 'k8s', kind: 'nodes', name: n.name })}
        actions={n => (
          <ActionButtons
            onCopy={() => navigator.clipboard.writeText(n.name)}
            onCordon={!n.unschedulable ? () => setCordonTarget(n.name) : undefined}
            onUncordon={n.unschedulable ? () => { setUncordonError(''); setUncordonTarget(n.name) } : undefined}
            onDrain={() => setDrainConfirmTarget(n.name)}
            onTaints={() => setTaintsTarget(n.name)}
            onEdit={() => setNodeEditName(n.name)}
            onDelete={() => { setNodeDeleteError(''); setNodeDeleteForm(DEFAULT_DELETE_FORM); setNodeDeleteName(n.name) }}
            onExec={() => openNodeExec({ nodeName: n.name })}
            permissions={nodePermissions}
          />
        )}
      />
      {nodeEditName && (
        <YamlPanel
          profile={profile}
          title={`nodes/${nodeEditName}`}
          resourceRef={{ type: 'k8s', kind: 'nodes', name: nodeEditName } as ResourceRef}
          onClose={() => setNodeEditName(null)}
        />
      )}
      {nodeDeleteName && (
        <ConfirmDialog
          title="Delete Node"
          message={`Delete node "${nodeDeleteName}"? This cannot be undone.`}
          confirmLabel={nodeDeleting ? 'Deleting…' : 'Delete'}
          error={nodeDeleteError}
          onConfirm={handleNodeDelete}
          onCancel={() => { setNodeDeleteName(null); setNodeDeleteError(''); setNodeDeleteForm(DEFAULT_DELETE_FORM) }}
        >
          <DeleteOptionsFields value={nodeDeleteForm} onChange={setNodeDeleteForm} />
        </ConfirmDialog>
      )}
      {nodeInfoTarget && (
        <ResourceInfoPanel
          profile={profile}
          target={nodeInfoTarget}
          onCopy={() => navigator.clipboard.writeText(nodeInfoTarget.name)}
          onEdit={() => { setNodeEditName(nodeInfoTarget.name); setNodeInfoTarget(null) }}
          onDelete={() => { setNodeDeleteError(''); setNodeDeleteForm(DEFAULT_DELETE_FORM); setNodeDeleteName(nodeInfoTarget.name); setNodeInfoTarget(null) }}
          onClose={() => setNodeInfoTarget(null)}
          onExec={() => { openNodeExec({ nodeName: nodeInfoTarget.name }); setNodeInfoTarget(null) }}
          onCordon={!nodes.find(n => n.name === nodeInfoTarget.name)?.unschedulable ? () => setCordonTarget(nodeInfoTarget.name) : undefined}
          onUncordon={nodes.find(n => n.name === nodeInfoTarget.name)?.unschedulable ? () => { setUncordonError(''); setUncordonTarget(nodeInfoTarget.name) } : undefined}
          onDrain={() => { setDrainConfirmTarget(nodeInfoTarget.name); setNodeInfoTarget(null) }}
          onTaints={() => { setTaintsTarget(nodeInfoTarget.name); setNodeInfoTarget(null) }}
        />
      )}
      {cordonTarget && (
        <ConfirmDialog
          title={`Cordon node "${cordonTarget}"?`}
          message="New pods will not be scheduled on this node. Running pods will not be affected."
          confirmLabel="Cordon"
          onConfirm={() => { handleCordon(cordonTarget); setCordonTarget(null) }}
          onCancel={() => setCordonTarget(null)}
        />
      )}
      {uncordonTarget && (
        <ConfirmDialog
          title={`Uncordon node "${uncordonTarget}"?`}
          message="The node will become schedulable again. New pods can be placed on it."
          confirmLabel={uncordonBusy ? 'Uncordoning…' : 'Uncordon'}
          danger={false}
          error={uncordonError}
          onConfirm={handleUncordon}
          onCancel={() => { if (!uncordonBusy) { setUncordonTarget(null); setUncordonError('') } }}
        />
      )}
      {drainConfirmTarget && (
        <ConfirmDialog
          title={`Drain node "${drainConfirmTarget}"?`}
          message="All pods will be evicted from this node. This may cause service disruption."
          confirmLabel="Drain"
          danger
          onConfirm={() => { setDrainTarget(drainConfirmTarget); setDrainConfirmTarget(null) }}
          onCancel={() => setDrainConfirmTarget(null)}
        />
      )}
      {drainTarget && (
        <NodeActionLog
          title={`Drain: ${drainTarget}`}
          url={api.drainNodeUrl(profile, drainTarget)}
          onClose={() => {
            setDrainPodInfo(null)
            setDrainPodEdit(null)
            setDrainPodDelete(null)
            setDrainTarget(null)
            onRefreshClusterInfo()
          }}
          onPodClick={(namespace, name) => {
            setDrainPodDelete(null)
            setDrainPodEdit(null)
            setDrainPodInfo({ type: 'k8s', kind: 'pods', name, namespace })
          }}
        />
      )}
      {drainPodInfo && (
        <ResourceInfoPanel
          profile={profile}
          target={drainPodInfo}
          aboveActionLog
          onCopy={() => navigator.clipboard.writeText(drainPodInfo.name)}
          onEdit={() => {
            setDrainPodEdit({ name: drainPodInfo.name, ns: drainPodInfo.namespace ?? '' })
            setDrainPodInfo(null)
          }}
          onDelete={() => {
            setDrainPodDeleteError('')
            setDrainPodDeleteForm(DEFAULT_DELETE_FORM)
            setDrainPodDelete({ name: drainPodInfo.name, ns: drainPodInfo.namespace ?? '' })
          }}
          onClose={() => setDrainPodInfo(null)}
          onOpenInPods={() => {
            const namespace = drainPodInfo.namespace ?? ''
            setDrainPodInfo(null)
            setDrainPodEdit(null)
            setDrainPodDelete(null)
            setDrainTarget(null)
            onRefreshClusterInfo()
            onSelectResource?.('pods')
            if (namespace) onNsChange([namespace])
          }}
          onLogs={() => {
            workbench.openLogs(profile, {
              podName: drainPodInfo.name,
              namespace: drainPodInfo.namespace ?? '',
            })
          }}
          onExec={container => {
            workbench.openExec(profile, {
              podName: drainPodInfo.name,
              namespace: drainPodInfo.namespace ?? '',
              container,
            })
          }}
          onFiles={container => {
            workbench.openFiles(profile, {
              podName: drainPodInfo.name,
              namespace: drainPodInfo.namespace ?? '',
              container,
            })
          }}
        />
      )}
      {drainPodEdit && (
        <YamlPanel
          profile={profile}
          title={`pods/${drainPodEdit.ns}/${drainPodEdit.name}`}
          resourceRef={{ type: 'k8s', kind: 'pods', name: drainPodEdit.name, namespace: drainPodEdit.ns } as ResourceRef}
          aboveActionLog
          onClose={() => setDrainPodEdit(null)}
        />
      )}
      {drainPodDelete && (
        <ConfirmDialog
          title="Delete Pod"
          message={`Delete pod "${drainPodDelete.name}" in namespace "${drainPodDelete.ns}"?`}
          confirmLabel={drainPodDeleting ? 'Deleting…' : 'Delete'}
          error={drainPodDeleteError}
          aboveActionLog
          onConfirm={handleDrainPodDelete}
          onCancel={() => {
            setDrainPodDelete(null)
            setDrainPodDeleteError('')
            setDrainPodDeleteForm(DEFAULT_DELETE_FORM)
          }}
        >
          <DeleteOptionsFields value={drainPodDeleteForm} onChange={setDrainPodDeleteForm} />
        </ConfirmDialog>
      )}
      {taintsTarget && (
        <NodeTaintsDialog
          profile={profile}
          nodeName={taintsTarget}
          onClose={() => setTaintsTarget(null)}
        />
      )}
    </>
  )
}
