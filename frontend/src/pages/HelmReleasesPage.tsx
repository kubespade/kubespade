import { useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { History, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { api } from '../api/client'
import { SortableTable } from '../components/SortableTable'
import type { ColDef } from '../components/SortableTable'
import { EmptyState } from '../components/EmptyState'
import { ErrorReconnectBanner } from '../components/ErrorReconnectBanner'
import { NameFilterInput, matchesNameQuery } from '../components/NameFilterInput'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { HelmHistoryDialog } from '../components/HelmHistoryDialog'
import { HelmWriteDialog } from '../components/HelmWriteDialog'
import { usePolledResource } from '../hooks/usePolledResource'
import type { HelmRelease } from '../types'
import { formatAge } from '../lib/formatAge'
import { fixedAnchorCenterTop } from '../lib/uiZoom'

function statusClass(status: string): string {
  switch (status) {
    case 'deployed':    return 'helm-status-deployed'
    case 'failed':      return 'helm-status-failed'
    case 'superseded':  return 'helm-status-superseded'
    case 'uninstalling': return 'helm-status-uninstalling'
    default:            return 'helm-status-pending'
  }
}

const RELEASE_COLUMNS: ColDef<HelmRelease>[] = [
  {
    key: 'name', label: 'Name', mono: true,
    sortValue: r => r.name,
    render: r => r.name,
  },
  {
    key: 'namespace', label: 'Namespace', mono: true,
    sortValue: r => r.namespace,
    render: r => r.namespace,
  },
  {
    key: 'chart', label: 'Chart', mono: true,
    sortValue: r => r.chart,
    render: r => r.chart,
  },
  {
    key: 'chartVersion', label: 'Chart Version', mono: true,
    render: r => r.chartVersion || '—',
  },
  {
    key: 'appVersion', label: 'App Version', mono: true,
    render: r => r.appVersion || '—',
  },
  {
    key: 'status', label: 'Status',
    sortValue: r => r.status,
    render: r => <span className={`badge ${statusClass(r.status)}`}>{r.status}</span>,
  },
  {
    key: 'revision', label: 'Revision', mono: true,
    sortValue: r => r.revision,
    render: r => r.revision,
  },
  {
    key: 'updated', label: 'Updated', mono: true,
    sortValue: r => r.updated,
    render: r => <span className="ov-age">{r.updated ? formatAge(Date.now(), r.updated) : '—'}</span>,
  },
]

export function HelmReleasesPage({ profile }: { profile: string }) {
  const { data: releases, loading, error, reload } = usePolledResource(
    () => api.listHelmReleases(profile).then(d => d.releases),
    [profile],
    { initial: [] as HelmRelease[], errorLabel: 'Failed to load releases' },
  )
  const [nameQuery, setNameQuery] = useState('')
  const [historyTarget, setHistoryTarget] = useState<HelmRelease | null>(null)
  const [upgradeTarget, setUpgradeTarget] = useState<HelmRelease | null>(null)
  const [installOpen, setInstallOpen] = useState(false)
  const [uninstallTarget, setUninstallTarget] = useState<HelmRelease | null>(null)
  const [uninstallError, setUninstallError] = useState('')
  const [uninstalling, setUninstalling] = useState(false)
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null)

  const filtered = releases.filter(r => matchesNameQuery(r.name, nameQuery))

  async function confirmUninstall() {
    if (!uninstallTarget || uninstalling) return
    setUninstalling(true)
    setUninstallError('')
    try {
      await api.uninstallHelmRelease(profile, uninstallTarget.namespace, uninstallTarget.name)
      setUninstallTarget(null)
      reload()
    } catch (e) {
      setUninstallError(e instanceof Error ? e.message : 'Uninstall failed')
    } finally {
      setUninstalling(false)
    }
  }

  function tipBtn(
    label: string,
    onClick: () => void,
    icon: ReactNode,
    extraClass = '',
  ) {
    return (
      <button
        type="button"
        className={`row-action-btn${extraClass}`}
        aria-label={label}
        onClick={e => { e.stopPropagation(); onClick() }}
        onMouseEnter={e => {
          const { x, y } = fixedAnchorCenterTop(e.currentTarget)
          setTip({ text: label, x, y })
        }}
        onMouseLeave={() => setTip(null)}
      >
        {icon}
      </button>
    )
  }

  return (
    <div className="apps-page">
      <div className="apps-toolbar">
        <NameFilterInput value={nameQuery} onChange={setNameQuery} />
        <span className="res-count">
          {loading ? '' : `${filtered.length} release${filtered.length !== 1 ? 's' : ''}`}
        </span>
        {!loading && !error && (
          <span className="last-updated"><span className="live-dot" />live</span>
        )}
        <button
          type="button"
          className="page-header-btn"
          style={{ marginLeft: 'auto' }}
          onClick={() => setInstallOpen(true)}
        >
          <Plus size={14} style={{ marginRight: 4 }} />
          Install
        </button>
      </div>

      {loading && releases.length === 0 && <div className="cv-loading">Loading releases…</div>}
      <ErrorReconnectBanner error={error} onReconnect={reload} />

      {!loading && !error && releases.length === 0 && (
        <div className="res-placeholder">
          <EmptyState
            title="No Helm releases found"
            hint="Install a chart, or wait for releases already in this cluster to show up."
            action={{ label: 'Install chart', onClick: () => setInstallOpen(true) }}
          />
        </div>
      )}

      {releases.length > 0 && (
        <SortableTable
          columns={RELEASE_COLUMNS}
          rows={filtered}
          rowKey={r => `${r.namespace}/${r.name}/${r.revision}`}
          defaultSortKey="name"
          emptyMessage={
            <EmptyState
              compact
              title="No Helm releases found"
              hint={nameQuery.trim() ? 'Nothing matches this name filter.' : 'Nothing matches this view.'}
            />
          }
          actions={r => (
            <div className="row-actions">
              {tipBtn('Upgrade', () => setUpgradeTarget(r), <RefreshCw size={11} />)}
              {tipBtn('History / rollback', () => setHistoryTarget(r), <History size={11} />)}
              {tipBtn('Uninstall', () => { setUninstallError(''); setUninstallTarget(r) }, <Trash2 size={11} />, ' row-action-delete')}
            </div>
          )}
        />
      )}

      {tip && createPortal(
        <span className="row-action-tip" style={{ left: tip.x, top: tip.y }}>{tip.text}</span>,
        document.body,
      )}

      {installOpen && (
        <HelmWriteDialog
          profile={profile}
          mode="install"
          onClose={() => setInstallOpen(false)}
          onDone={reload}
        />
      )}

      {upgradeTarget && (
        <HelmWriteDialog
          profile={profile}
          mode="upgrade"
          release={upgradeTarget}
          onClose={() => setUpgradeTarget(null)}
          onDone={reload}
        />
      )}

      {historyTarget && (
        <HelmHistoryDialog
          profile={profile}
          name={historyTarget.name}
          namespace={historyTarget.namespace}
          onClose={() => setHistoryTarget(null)}
          onRolledBack={reload}
        />
      )}

      {uninstallTarget && (
        <ConfirmDialog
          title={`Uninstall ${uninstallTarget.namespace}/${uninstallTarget.name}?`}
          message="This removes the Helm release and its resources from the cluster (same as helm uninstall)."
          confirmLabel={uninstalling ? 'Uninstalling…' : 'Uninstall'}
          danger
          error={uninstallError || undefined}
          onCancel={() => { if (!uninstalling) setUninstallTarget(null) }}
          onConfirm={() => { void confirmUninstall() }}
        />
      )}
    </div>
  )
}
