import { useEffect, useMemo, useState } from 'react'
import { Search, X } from 'lucide-react'
import type { ClusterSearchHit } from '../lib/clusterSearch'
import { setCommandPaletteJump } from '../lib/commandPaletteJump'
import type { Resource } from '../lib/resourceKinds'

interface Props {
  open: boolean
  query: string
  hits: ClusterSearchHit[]
  profileLabel?: string
  onClose: () => void
  onOpenObject: (kind: Resource, name: string, namespace?: string) => void
}

/**
 * Full cluster search results — opened from ⌘K when Enter chooses “all results”.
 */
export function ClusterSearchResults({
  open,
  query,
  hits,
  profileLabel,
  onClose,
  onOpenObject,
}: Props) {
  const [filter, setFilter] = useState('')

  useEffect(() => {
    if (!open) return
    setFilter('')
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return hits
    return hits.filter(h =>
      h.name.toLowerCase().includes(q)
      || h.kindLabel.toLowerCase().includes(q)
      || (h.namespace ?? '').toLowerCase().includes(q)
      || h.kind.toLowerCase().includes(q),
    )
  }, [hits, filter])

  if (!open) return null

  function openHit(hit: ClusterSearchHit) {
    setCommandPaletteJump({
      kind: hit.kind,
      name: hit.name,
      namespace: hit.namespace,
    })
    onOpenObject(hit.kind, hit.name, hit.namespace)
    onClose()
  }

  return (
    <div className="csr-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="csr-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Cluster search results"
        onMouseDown={e => e.stopPropagation()}
      >
        <div className="csr-header">
          <div className="csr-title-block">
            <h2 className="csr-title">
              Results for “{query}”
            </h2>
            <p className="csr-sub">
              {hits.length} match{hits.length === 1 ? '' : 'es'}
              {profileLabel ? ` · ${profileLabel}` : ''}
              {' · all namespaces'}
            </p>
          </div>
          <button type="button" className="csr-close" onClick={onClose} title="Close">
            <X size={16} />
          </button>
        </div>

        <div className="csr-toolbar">
          <Search size={14} className="csr-filter-ico" aria-hidden />
          <input
            className="csr-filter"
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder="Filter this list…"
            aria-label="Filter results"
          />
        </div>

        <div className="csr-table-wrap">
          {visible.length === 0 ? (
            <div className="csr-empty">No rows match this filter.</div>
          ) : (
            <table className="csr-table">
              <thead>
                <tr>
                  <th>Kind</th>
                  <th>Name</th>
                  <th>Namespace</th>
                </tr>
              </thead>
              <tbody>
                {visible.map(hit => (
                  <tr
                    key={`${hit.kind}:${hit.namespace ?? ''}:${hit.name}`}
                    onClick={() => openHit(hit)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        openHit(hit)
                      }
                    }}
                    tabIndex={0}
                    role="button"
                  >
                    <td className="csr-kind">{hit.kindLabel}</td>
                    <td className="csr-name">{hit.name}</td>
                    <td className="csr-ns">{hit.namespace || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
