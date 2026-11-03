import { useState } from 'react'
import { ExternalLink, Square } from 'lucide-react'
import { api } from '../api/client'
import { SortableTable } from '../components/SortableTable'
import type { ColDef } from '../components/SortableTable'
import { EmptyState } from '../components/EmptyState'
import { ErrorReconnectBanner } from '../components/ErrorReconnectBanner'
import { NameFilterInput, matchesNameQuery } from '../components/NameFilterInput'
import { usePolledResource } from '../hooks/usePolledResource'
import type { PortForwardSession } from '../types'
import { formatAge } from '../lib/formatAge'

const PF_COLUMNS: ColDef<PortForwardSession>[] = [
  { key: 'pod',        label: 'Pod',         mono: true, render: s => s.podName },
  { key: 'namespace',  label: 'Namespace',   mono: true, render: s => s.namespace },
  { key: 'localPort',  label: 'Local Port',  mono: true, render: s => s.localPort },
  { key: 'remotePort', label: 'Remote Port', mono: true, render: s => s.remotePort },
  {
    key: 'age', label: 'Age', mono: true,
    render: s => <span className="ov-age">{formatAge(Date.now(), s.startedAt)}</span>,
  },
]

export function PortForwardPage({ profile }: { profile: string }) {
  const { data: sessions, loading, error, reload, refresh, setError } = usePolledResource(
    () => api.listPortForwards(profile).then(d => d.sessions),
    [profile],
    { initial: [] as PortForwardSession[], intervalMs: 5_000, errorLabel: 'Failed to load port forwards' },
  )
  const [stopping, setStopping] = useState<Set<string>>(new Set())
  const [nameQuery, setNameQuery] = useState('')

  async function handleStop(id: string) {
    setStopping(prev => new Set(prev).add(id))
    try {
      await api.stopPortForward(profile, id)
      refresh()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to stop port forward')
    } finally {
      setStopping(prev => { const s = new Set(prev); s.delete(id); return s })
    }
  }

  const filtered = sessions.filter(s =>
    matchesNameQuery(s.podName, nameQuery) || matchesNameQuery(s.sourceName, nameQuery),
  )

  return (
    <div className="apps-page">
      <div className="apps-toolbar">
        <NameFilterInput value={nameQuery} onChange={setNameQuery} placeholder="Filter by pod…" />
        <span className="res-count">
          {loading ? '' : `${filtered.length} port forward${filtered.length !== 1 ? 's' : ''}`}
        </span>
        {!loading && !error && (
          <span className="last-updated">
            <span className="live-dot" />
            live
          </span>
        )}
      </div>

      {loading && sessions.length === 0 && <div className="cv-loading">Loading port forwards…</div>}
      <ErrorReconnectBanner error={error} onReconnect={reload} />

      {!loading && !error && sessions.length === 0 && (
        <div className="res-placeholder">
          <EmptyState
            title="No active port forwards"
            hint="Start one from a Pod or Service Actions menu. Sessions started by this app appear here."
          />
        </div>
      )}

      {sessions.length > 0 && (
        <SortableTable
          columns={PF_COLUMNS}
          rows={filtered}
          rowKey={s => s.id}
          emptyMessage={
            <EmptyState
              compact
              title="No active port forwards"
              hint={nameQuery.trim() ? 'Nothing matches this name filter.' : 'Nothing matches this view.'}
            />
          }
          actions={s => (
            <div className="row-actions" style={{ opacity: 1 }}>
              <button
                className="row-action-btn"
                onClick={() => {
                  const scheme = s.scheme === 'https' ? 'https' : 'http'
                  window.open(`${scheme}://localhost:${s.localPort}`, '_blank')
                }}
                title="Open in browser"
              >
                <ExternalLink size={11} />
              </button>
              <button
                className="row-action-btn row-action-delete"
                onClick={() => handleStop(s.id)}
                disabled={stopping.has(s.id)}
                title="Stop"
              >
                <Square size={11} />
              </button>
            </div>
          )}
        />
      )}
    </div>
  )
}
