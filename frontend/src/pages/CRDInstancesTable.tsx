import { useEffect, useRef, useState } from 'react'
import { Settings } from 'lucide-react'
import type { ResourceList } from '../types'
import { api } from '../api/client'
import { withAccessToken } from '../api/token'
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
import { useNow } from '../hooks/useNow'
import { NamespaceCombo } from '../components/NamespaceCombo'
import { NameFilterInput, matchesNameQuery } from '../components/NameFilterInput'
import { EmptyState } from '../components/EmptyState'
import { ErrorReconnectBanner } from '../components/ErrorReconnectBanner'
import { useAutoReconnect } from '../hooks/useAutoReconnect'
import { friendlyWatchError, isPermissionDeniedError } from '../lib/apiError'

// ── CRD Instances Table ───────────────────────────────────────────────────────

export function CRDInstancesTable({ profile, resourceId, namespaces, selectedNs, onNsChange }: {
  profile: string
  resourceId: string
  namespaces: string[]
  selectedNs: string[] | null
  onNsChange: (v: string[]) => void
}) {
  const [data, setData] = useState<ResourceList | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [secondsAgo, setSecondsAgo] = useState(0)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const esRef = useRef<EventSource | null>(null)
  const now = useNow()
  const [editTarget, setEditTarget] = useState<{ name: string; ns?: string } | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{ name: string; ns?: string } | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteForm, setDeleteForm] = useState<DeleteFormState>(DEFAULT_DELETE_FORM)
  const [deleteError, setDeleteError] = useState('')
  const [infoTarget, setInfoTarget] = useState<InfoTarget | null>(null)
  const [hiddenCols, setHiddenCols] = useState<Set<string>>(new Set())
  const [colSettingsOpen, setColSettingsOpen] = useState(false)
  const [nameQuery, setNameQuery] = useState('')
  const colSettingsRef = useRef<HTMLDivElement>(null)
  /** Apply priority>0 default-hide once per CRD type (not on every SSE refresh). */
  const defaultsAppliedFor = useRef<string>('')

  const parts = resourceId.split('::')
  const group   = parts[1] ?? ''
  const version = parts[2] ?? ''
  const plural  = parts[3] ?? ''
  const scope   = parts[4] ?? ''
  const isNamespaced = scope === 'Namespaced'

  function toggleColCRD(key: string) {
    setHiddenCols(prev => {
      const s = new Set(prev)
      s.has(key) ? s.delete(key) : s.add(key)
      return s
    })
  }

  useEffect(() => {
    setHiddenCols(new Set())
    setColSettingsOpen(false)
    defaultsAppliedFor.current = ''
  }, [resourceId])

  useEffect(() => {
    if (!data?.columns?.length) return
    if (defaultsAppliedFor.current === resourceId) return
    defaultsAppliedFor.current = resourceId
    const hide = new Set<string>()
    for (const col of data.columns) {
      if ((col.priority ?? 0) > 0) hide.add(col.key)
    }
    if (hide.size > 0) setHiddenCols(hide)
  }, [data?.columns, resourceId])

  useEffect(() => {
    if (!colSettingsOpen) return
    function handleOutside(e: MouseEvent) {
      if (colSettingsRef.current && !colSettingsRef.current.contains(e.target as Node)) {
        setColSettingsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [colSettingsOpen])

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    setDeleteError('')
    try {
      await api.deleteCRDResource(profile, group, version, plural, deleteTarget.name, deleteTarget.ns, deleteFormToOpts(deleteForm))
      setDeleteTarget(null)
      setDeleteForm(DEFAULT_DELETE_FORM)
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setDeleting(false)
    }
  }

  const connNs = !isNamespaced ? ''
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
    const url = `/api/profiles/${profile}/k8s/watch-crd/${encodeURIComponent(group)}/${version}/${plural}${qs}`
    const es = new EventSource(withAccessToken(url))
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
  }, [profile, resourceId, connNs])

  useEffect(() => {
    if (!lastUpdated) return
    setSecondsAgo(0)
    const t = setInterval(() => setSecondsAgo(s => s + 1), 1000)
    return () => clearInterval(t)
  }, [lastUpdated])

  function applyNsFilter(items: ResourceList['items']): ResourceList['items'] {
    if (!selectedNs || selectedNs.length <= 1) return items
    const nsSet = new Set(selectedNs)
    return items.filter(item => nsSet.has(item.namespace ?? ''))
  }

  function applyFilters(items: ResourceList['items']): ResourceList['items'] {
    return applyNsFilter(items).filter(item => matchesNameQuery(item.name, nameQuery))
  }

  useEffect(() => {
    setNameQuery('')
  }, [resourceId])

  const fieldColumns = data?.columns?.length
    ? data.columns
    : data
      ? [...new Set(data.items.flatMap(r => Object.keys(r.fields)))].slice(0, 8).map(k => ({
          key: k,
          label: k,
          priority: 0,
        }))
      : []

  type CRDRow = ResourceList['items'][number]
  const crdColumns: ColDef<CRDRow>[] = [
    { key: 'name', label: 'Name', mono: true, render: row => row.name },
    ...(isNamespaced && !hiddenCols.has('namespace')
      ? [{ key: 'namespace', label: 'Namespace', mono: true, render: (row: CRDRow) => row.namespace }]
      : []),
    ...fieldColumns.filter(c => !hiddenCols.has(c.key)).map<ColDef<CRDRow>>(c => ({
      key: c.key, label: c.label, mono: true, render: (row: CRDRow) => row.fields[c.key] ?? '',
    })),
    ...(!hiddenCols.has('age')
      ? [{
          key: 'age', label: 'Age', mono: true,
          render: (row: CRDRow) => <span className="ov-age">{formatAge(now, row.age)}</span>,
        }]
      : []),
  ]

  return (
    <div>
      <div className="res-table-toolbar">
        <div className="res-toolbar-left">
          {isNamespaced && (
            <NamespaceCombo namespaces={namespaces} value={selectedNs} onChange={onNsChange} />
          )}
          <NameFilterInput value={nameQuery} onChange={setNameQuery} />
          <span className="res-count">{data ? `${applyFilters(data.items).length} items` : ''}</span>
        </div>
        <div className="res-toolbar-right">
          {connNs !== null && lastUpdated && !error && (
            <span className="last-updated">
              <span className="live-dot" />
              {secondsAgo < 5 ? 'live' : `${secondsAgo}s ago`}
            </span>
          )}
          <div className="col-settings-wrap" ref={colSettingsRef}>
            <button
              className={`col-settings-btn${colSettingsOpen ? ' col-settings-btn-active' : ''}`}
              onClick={() => setColSettingsOpen(o => !o)}
              data-tooltip="Column settings"
            >
              <Settings size={15} />
            </button>
            {colSettingsOpen && (
              <div className="col-settings-popup">
                <div className="col-settings-title">Columns</div>
                {[
                  ...(isNamespaced ? [{ key: 'namespace', label: 'Namespace' }] : []),
                  ...fieldColumns.map(c => ({ key: c.key, label: c.label })),
                  { key: 'age', label: 'Age' },
                ].map(col => (
                  <label key={col.key} className="col-settings-row">
                    <input
                      type="checkbox"
                      checked={!hiddenCols.has(col.key)}
                      onChange={() => toggleColCRD(col.key)}
                    />
                    <span>{col.label}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {connNs === null && (
        <div className="res-placeholder">
          <EmptyState
            title="Select a namespace"
            hint="Choose a namespace above to load CRD instances."
          />
        </div>
      )}
      {connNs !== null && (
        <ErrorReconnectBanner
          error={error ? friendlyWatchError(error, parts[5] ?? plural) : error}
          label={isPermissionDeniedError(error) ? 'Retry' : 'Reconnect'}
          onReconnect={() => {
            clearAutoReconnect()
            setError('')
            connect(connNs, true)
          }}
        />
      )}
      {connNs !== null && loading && !data && <div className="cv-loading">Loading…</div>}
      {connNs !== null && !loading && !data && isPermissionDeniedError(error) && (
        <div className="res-placeholder">
          <EmptyState
            compact
            title={`Can’t list ${parts[5] ?? plural}`}
            hint="Insufficient permissions for this CRD. The empty view is not “nothing here” — your credentials can’t read these instances."
          />
        </div>
      )}

      {editTarget && (
        <YamlPanel
          profile={profile}
          title={`${parts[5] ?? plural}/${editTarget.name}`}
          resourceRef={{ type: 'crd', group, version, plural, name: editTarget.name, namespace: editTarget.ns } as ResourceRef}
          onClose={() => setEditTarget(null)}
        />
      )}
      {deleteTarget && (
        <ConfirmDialog
          title={`Delete ${parts[5] ?? plural}`}
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
            if (infoTarget.type === 'crd') setEditTarget({ name: infoTarget.name, ns: infoTarget.namespace })
            setInfoTarget(null)
          }}
          onDelete={() => { setDeleteError(''); setDeleteForm(DEFAULT_DELETE_FORM); setDeleteTarget({ name: infoTarget.name, ns: infoTarget.namespace ?? undefined }); setInfoTarget(null) }}
          onClose={() => setInfoTarget(null)}
        />
      )}

      {connNs !== null && data && (
        <SortableTable
          columns={crdColumns}
          rows={applyFilters(data.items)}
          rowKey={row => `${row.namespace ?? ''}/${row.name}`}
          lockedColumns={new Set(['name'])}
          emptyMessage={
            isPermissionDeniedError(error) ? (
              <EmptyState
                compact
                title={`Can’t list ${parts[5] ?? plural}`}
                hint="Insufficient permissions for this CRD. The empty table is not “nothing here” — your credentials can’t read these instances."
              />
            ) : (
              <EmptyState
                compact
                title="No resources found"
                hint={
                  selectedNs && selectedNs.length > 1
                    ? 'Nothing matches the selected namespaces. Try All namespaces or another filter.'
                    : 'No instances of this CRD in the current view.'
                }
              />
            )
          }
          onRowClick={row => setInfoTarget({
            type: 'crd', group, version, plural,
            kind: parts[5] ?? plural,
            name: row.name,
            namespace: row.namespace ?? undefined,
          })}
          actions={row => (
            <ActionButtons
              onCopy={() => navigator.clipboard.writeText(row.name)}
              onEdit={() => setEditTarget({ name: row.name, ns: row.namespace ?? undefined })}
              onDelete={() => { setDeleteError(''); setDeleteForm(DEFAULT_DELETE_FORM); setDeleteTarget({ name: row.name, ns: row.namespace ?? undefined }) }}
            />
          )}
        />
      )}
    </div>
  )
}
