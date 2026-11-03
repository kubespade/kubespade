import { useState } from 'react'
import { Plus } from 'lucide-react'
import { api } from '../api/client'
import type { Application } from '../types'
import { SortableTable } from '../components/SortableTable'
import type { ColDef } from '../components/SortableTable'
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
import { ResourceInfoPanel } from '../components/ResourceInfoPanel'
import type { InfoTarget } from '../components/ResourceInfoPanel'
import { formatAge } from '../lib/formatAge'
import { EmptyState } from '../components/EmptyState'
import { ErrorReconnectBanner } from '../components/ErrorReconnectBanner'
import { NameFilterInput, matchesNameQuery } from '../components/NameFilterInput'
import { usePolledResource } from '../hooks/usePolledResource'

const APPLY_PLACEHOLDER = `# Paste multi-document YAML (kubectl apply -f)
# Separate resources with ---
`

function shortImage(image: string): string {
  const parts = image.split('/')
  return parts[parts.length - 1]
}

function appKindPath(kind: Application['kind']): string {
  return kind === 'Deployment' ? 'deployments' : 'statefulsets'
}

function appStatus(app: Application): 'running' | 'degraded' | 'pending' | 'stopped' {
  if (app.desiredReplicas === 0) return 'stopped'
  if (app.readyReplicas === app.desiredReplicas) return 'running'
  if (app.readyReplicas > 0) return 'degraded'
  return 'pending'
}

const STATUS_LABEL: Record<string, string> = {
  running:  'Running',
  degraded: 'Degraded',
  pending:  'Pending',
  stopped:  'Stopped',
}

const APP_COLUMNS: ColDef<Application>[] = [
  {
    key: 'name', label: 'Name', mono: true,
    sortValue: a => a.name,
    render: a => a.name,
  },
  {
    key: 'namespace', label: 'Namespace', mono: true,
    sortValue: a => a.namespace,
    render: a => a.namespace,
  },
  {
    key: 'kind', label: 'Kind',
    sortValue: a => a.kind,
    render: a => (
      <span className={`badge ${a.kind === 'Deployment' ? 'app-kind-deploy' : 'app-kind-sts'}`}>
        {a.kind === 'Deployment' ? 'Deploy' : 'STS'}
      </span>
    ),
  },
  {
    key: 'ready', label: 'Ready', mono: true,
    sortValue: a => a.readyReplicas / Math.max(1, a.desiredReplicas),
    render: a => {
      const st = appStatus(a)
      return <span className={`app-ready-${st}`}>{a.readyReplicas}/{a.desiredReplicas}</span>
    },
  },
  {
    key: 'status', label: 'Status',
    sortValue: a => appStatus(a),
    render: a => {
      const st = appStatus(a)
      return <span className={`badge app-status-${st}`}>{STATUS_LABEL[st]}</span>
    },
  },
  {
    key: 'image', label: 'Image', mono: true,
    render: a => a.images.length > 0 ? shortImage(a.images[0]) : '—',
  },
  {
    key: 'age', label: 'Age', mono: true,
    sortValue: a => a.age,
    render: a => formatAge(Date.now(), a.age),
  },
]

export function ApplicationsPage({ profile }: { profile: string }) {
  const [lastFetch, setLastFetch] = useState(0)
  const [applyOpen, setApplyOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<{ kind: string; name: string; ns: string } | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{ kind: string; name: string; ns: string } | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteForm, setDeleteForm] = useState<DeleteFormState>(DEFAULT_DELETE_FORM)
  const [deleteError, setDeleteError] = useState('')
  const [infoTarget, setInfoTarget] = useState<InfoTarget | null>(null)
  const [nameQuery, setNameQuery] = useState('')

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    setDeleteError('')
    try {
      await api.deleteResource(profile, deleteTarget.kind, deleteTarget.name, deleteTarget.ns, deleteFormToOpts(deleteForm))
      setDeleteTarget(null)
      setDeleteForm(DEFAULT_DELETE_FORM)
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setDeleting(false)
    }
  }

  const { data: items, loading, error, reload, refresh } = usePolledResource(
    () => api.listApplications(profile).then(d => { setLastFetch(Date.now()); return d.items }),
    [profile],
    { initial: [] as Application[], errorLabel: 'Failed to load applications' },
  )

  const applyBtn = (
    <button
      className="col-settings-btn"
      onClick={() => setApplyOpen(true)}
      data-tooltip="Apply YAML"
    >
      <Plus size={15} />
    </button>
  )

  const filtered = items.filter(a => matchesNameQuery(a.name, nameQuery))

  return (
    <div className="apps-page">
      {loading && items.length === 0 && <div className="cv-loading">Loading applications…</div>}
      <ErrorReconnectBanner error={error} onReconnect={reload} />

      {!loading && !error && items.length === 0 && (
        <>
          <div className="res-table-toolbar">
            <div className="res-toolbar-left">
              <span className="res-count">0 applications</span>
            </div>
            <div className="res-toolbar-right">{applyBtn}</div>
          </div>
          <div className="res-placeholder">
            <EmptyState
              title="No applications found"
              hint="No Deployments or StatefulSets in this cluster yet. Use Apply YAML to create them."
            />
          </div>
        </>
      )}

      {items.length > 0 && (
        <SortableTable
          columns={APP_COLUMNS}
          rows={filtered}
          rowKey={a => `${a.namespace}/${a.name}`}
          defaultSortKey="name"
          emptyMessage={
            <EmptyState
              compact
              title="No applications found"
              hint={nameQuery.trim() ? 'Nothing matches this name filter.' : 'Nothing matches this view.'}
            />
          }
          settingsKey="applications"
          toolbarLeft={
            <>
              <NameFilterInput value={nameQuery} onChange={setNameQuery} />
              <span className="res-count">{filtered.length} applications</span>
              {lastFetch > 0 && (
                <span className="last-updated">
                  <span className="live-dot" />
                  live
                </span>
              )}
            </>
          }
          toolbarRight={applyBtn}
          onRowClick={a => setInfoTarget({
            type: 'k8s',
            kind: appKindPath(a.kind),
            name: a.name,
            namespace: a.namespace,
          })}
          actions={a => {
            const kind = appKindPath(a.kind)
            return (
              <ActionButtons
                onCopy={() => navigator.clipboard.writeText(a.name)}
                onEdit={() => setEditTarget({ kind, name: a.name, ns: a.namespace })}
                onDelete={() => { setDeleteError(''); setDeleteForm(DEFAULT_DELETE_FORM); setDeleteTarget({ kind, name: a.name, ns: a.namespace }) }}
              />
            )
          }}
        />
      )}

      {infoTarget && (
        <ResourceInfoPanel
          profile={profile}
          target={infoTarget}
          onCopy={() => navigator.clipboard.writeText(infoTarget.name)}
          onEdit={() => {
            setEditTarget({
              kind: infoTarget.kind,
              name: infoTarget.name,
              ns: infoTarget.namespace ?? '',
            })
            setInfoTarget(null)
          }}
          onDelete={() => {
            setDeleteError('')
            setDeleteForm(DEFAULT_DELETE_FORM)
            setDeleteTarget({
              kind: infoTarget.kind,
              name: infoTarget.name,
              ns: infoTarget.namespace ?? '',
            })
            setInfoTarget(null)
          }}
          onClose={() => setInfoTarget(null)}
        />
      )}

      {applyOpen && (
        <YamlPanel
          mode="apply"
          profile={profile}
          title="Apply YAML"
          initialYaml={APPLY_PLACEHOLDER}
          onClose={() => setApplyOpen(false)}
          onCreated={() => {
            setApplyOpen(false)
            refresh()
          }}
        />
      )}

      {editTarget && (
        <YamlPanel
          profile={profile}
          title={`${editTarget.kind}/${editTarget.name}`}
          resourceRef={{ type: 'k8s', kind: editTarget.kind, name: editTarget.name, namespace: editTarget.ns } as ResourceRef}
          onClose={() => setEditTarget(null)}
        />
      )}
      {deleteTarget && (
        <ConfirmDialog
          title={`Delete ${deleteTarget.kind}`}
          message={`Delete "${deleteTarget.name}"? This cannot be undone.`}
          confirmLabel={deleting ? 'Deleting…' : 'Delete'}
          error={deleteError}
          onConfirm={handleDelete}
          onCancel={() => { setDeleteTarget(null); setDeleteError(''); setDeleteForm(DEFAULT_DELETE_FORM) }}
        >
          <DeleteOptionsFields value={deleteForm} onChange={setDeleteForm} />
        </ConfirmDialog>
      )}
    </div>
  )
}
