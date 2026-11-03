import { useState } from 'react'
import { api } from '../api/client'
import { SortableTable } from '../components/SortableTable'
import type { ColDef } from '../components/SortableTable'
import { EmptyState } from '../components/EmptyState'
import { ErrorReconnectBanner } from '../components/ErrorReconnectBanner'
import { NameFilterInput, matchesNameQuery } from '../components/NameFilterInput'
import { usePolledResource } from '../hooks/usePolledResource'
import type { HelmChart } from '../types'

const CHART_COLUMNS: ColDef<HelmChart>[] = [
  {
    key: 'name', label: 'Chart', mono: true,
    sortValue: c => c.name,
    render: c => c.name,
  },
  {
    key: 'versions', label: 'Versions', mono: true,
    render: c => c.versions.join(', '),
  },
  {
    key: 'releases', label: 'Releases', mono: true,
    sortValue: c => c.releases,
    render: c => c.releases,
  },
  {
    key: 'namespaces', label: 'Namespaces', mono: true,
    render: c => c.namespaces.join(', '),
  },
]

export function HelmChartsPage({ profile }: { profile: string }) {
  const { data: charts, loading, error, reload } = usePolledResource(
    () => api.listHelmCharts(profile).then(d => d.charts),
    [profile],
    { initial: [] as HelmChart[], errorLabel: 'Failed to load charts' },
  )
  const [nameQuery, setNameQuery] = useState('')

  const filtered = charts.filter(c => matchesNameQuery(c.name, nameQuery))

  return (
    <div className="apps-page">
      <div className="apps-toolbar">
        <NameFilterInput value={nameQuery} onChange={setNameQuery} />
        <span className="res-count">
          {loading ? '' : `${filtered.length} chart${filtered.length !== 1 ? 's' : ''}`}
        </span>
        {!loading && !error && (
          <span className="last-updated"><span className="live-dot" />live</span>
        )}
      </div>

      {loading && charts.length === 0 && <div className="cv-loading">Loading charts…</div>}
      <ErrorReconnectBanner error={error} onReconnect={reload} />

      {!loading && !error && charts.length === 0 && (
        <div className="res-placeholder">
          <EmptyState
            title="No Helm charts found"
            hint="Charts appear here once releases in the cluster reference them."
          />
        </div>
      )}

      {charts.length > 0 && (
        <SortableTable
          columns={CHART_COLUMNS}
          rows={filtered}
          rowKey={c => c.name}
          defaultSortKey="name"
          emptyMessage={
            <EmptyState
              compact
              title="No Helm charts found"
              hint={nameQuery.trim() ? 'Nothing matches this name filter.' : 'Nothing matches this view.'}
            />
          }
        />
      )}
    </div>
  )
}
