import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Search, X } from 'lucide-react'
import { SIDEBAR_CATEGORIES, SIDEBAR_TOP_ITEMS } from '../lib/sidebarNav'
import type { Resource } from '../lib/resourceKinds'
import {
  searchClusterByName,
  type ClusterSearchHit,
} from '../lib/clusterSearch'
import { setCommandPaletteJump } from '../lib/commandPaletteJump'
import { matchesNameQuery } from './NameFilterInput'

type KindHit = {
  type: 'kind'
  id: string
  kind: Resource
  label: string
}

type ObjectHit = {
  type: 'object'
  id: string
  kind: Resource
  label: string
  name: string
  namespace?: string
}

type AllHit = {
  type: 'all'
  id: string
  query: string
  count: number
}

type Hit = AllHit | ObjectHit | KindHit

interface Props {
  open: boolean
  onClose: () => void
  profile: string | null
  connected: boolean
  onOpenKind: (kind: Resource) => void
  /** Open a specific object — App should switch kind + namespace. */
  onOpenObject: (kind: Resource, name: string, namespace?: string) => void
  onShowAllResults: (query: string, hits: ClusterSearchHit[]) => void
}

function allNavKinds(): { kind: Resource; label: string }[] {
  const out: { kind: Resource; label: string }[] = []
  const seen = new Set<string>()
  for (const item of [...SIDEBAR_TOP_ITEMS, ...SIDEBAR_CATEGORIES.flatMap(c => c.items)]) {
    if (seen.has(item.id)) continue
    seen.add(item.id)
    out.push({ kind: item.id, label: item.label })
  }
  return out
}

/**
 * ⌘K: cluster-wide name search + kind jump.
 * Enter on “All results” (default when matches exist) opens the full results window.
 */
export function CommandPaletteShell({
  open,
  onClose,
  profile,
  connected,
  onOpenKind,
  onOpenObject,
  onShowAllResults,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')
  const [objectHits, setObjectHits] = useState<ObjectHit[]>([])
  const [allClusterHits, setAllClusterHits] = useState<ClusterSearchHit[]>([])
  const [loadingObjects, setLoadingObjects] = useState(false)
  const [activeIdx, setActiveIdx] = useState(0)
  const reqSeq = useRef(0)
  const cancelRef = useRef({ cancelled: false })

  const navKinds = useMemo(() => allNavKinds(), [])

  const kindHits = useMemo((): KindHit[] => {
    const q = query.trim()
    const matched = navKinds
      .filter(k => !q || matchesNameQuery(k.label, q) || matchesNameQuery(k.kind, q))
      .map(k => ({
        type: 'kind' as const,
        id: `kind:${k.kind}`,
        kind: k.kind,
        label: k.label,
      }))
    if (!q) return matched.slice(0, 12)
    // Kinds are secondary once the user is searching names.
    return matched.slice(0, 8)
  }, [navKinds, query])

  const hits: Hit[] = useMemo(() => {
    const q = query.trim()
    if (!q) return kindHits
    const rows: Hit[] = []
    if (connected && q.length >= 2 && (allClusterHits.length > 0 || loadingObjects)) {
      rows.push({
        type: 'all',
        id: `all:${q}`,
        query: q,
        count: allClusterHits.length,
      })
    }
    rows.push(...objectHits.slice(0, 25))
    rows.push(...kindHits)
    return rows.slice(0, 40)
  }, [query, kindHits, objectHits, allClusterHits, connected, loadingObjects])

  useEffect(() => {
    setActiveIdx(0)
  }, [hits])

  useEffect(() => {
    if (!open) return
    setQuery('')
    setObjectHits([])
    setAllClusterHits([])
    setActiveIdx(0)
    const t = window.setTimeout(() => inputRef.current?.focus(), 0)
    return () => window.clearTimeout(t)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  useEffect(() => {
    cancelRef.current.cancelled = true
    if (!open || !profile || !connected) {
      setObjectHits([])
      setAllClusterHits([])
      setLoadingObjects(false)
      return
    }
    const q = query.trim()
    if (q.length < 2) {
      setObjectHits([])
      setAllClusterHits([])
      setLoadingObjects(false)
      return
    }

    const seq = ++reqSeq.current
    const signal = { cancelled: false }
    cancelRef.current = signal
    setLoadingObjects(true)

    const timer = window.setTimeout(() => {
      void searchClusterByName(profile, q, signal).then(found => {
        if (signal.cancelled || seq !== reqSeq.current) return
        setAllClusterHits(found)
        setObjectHits(found.map(h => ({
          type: 'object' as const,
          id: `obj:${h.kind}:${h.namespace ?? ''}:${h.name}`,
          kind: h.kind,
          label: h.kindLabel,
          name: h.name,
          namespace: h.namespace,
        })))
        setLoadingObjects(false)
      })
    }, 220)

    return () => {
      signal.cancelled = true
      window.clearTimeout(timer)
    }
  }, [open, profile, connected, query])

  const selectHit = useCallback((hit: Hit) => {
    if (hit.type === 'all') {
      onShowAllResults(hit.query, allClusterHits)
      onClose()
      return
    }
    if (hit.type === 'kind') {
      onOpenKind(hit.kind)
      onClose()
      return
    }
    setCommandPaletteJump({
      kind: hit.kind,
      name: hit.name,
      namespace: hit.namespace,
    })
    onOpenObject(hit.kind, hit.name, hit.namespace)
    onClose()
  }, [onOpenKind, onOpenObject, onClose, onShowAllResults, allClusterHits])

  const onInputKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx(i => Math.min(i + 1, Math.max(hits.length - 1, 0)))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx(i => Math.max(i - 1, 0))
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      const hit = hits[activeIdx]
      if (hit) selectHit(hit)
      else if (allClusterHits.length > 0 && query.trim().length >= 2) {
        onShowAllResults(query.trim(), allClusterHits)
        onClose()
      }
    }
  }

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-cmdk-idx="${activeIdx}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [activeIdx])

  if (!open) return null

  const q = query.trim()
  const showConnectHint = !connected || !profile
  const empty = hits.length === 0 && !loadingObjects

  return (
    <div className="cmdk-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="cmdk-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onMouseDown={e => e.stopPropagation()}
      >
        <div className="cmdk-input-row">
          <Search size={15} className="cmdk-input-icon" aria-hidden />
          <input
            ref={inputRef}
            className="cmdk-input"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder={
              connected
                ? 'Search the cluster by name…'
                : 'Jump to a resource kind…'
            }
            aria-label="Search"
            aria-autocomplete="list"
            aria-controls="cmdk-results"
          />
          <button type="button" className="cmdk-close" onClick={onClose} title="Close">
            <X size={14} />
          </button>
        </div>

        <div className="cmdk-results" id="cmdk-results" role="listbox" ref={listRef}>
          {showConnectHint && (
            <div className="cmdk-hint">
              Connect a cluster to search objects by name across all namespaces.
            </div>
          )}
          {connected && q.length > 0 && q.length < 2 && (
            <div className="cmdk-hint">Type at least 2 characters to search the cluster.</div>
          )}
          {loadingObjects && <div className="cmdk-hint">Searching cluster…</div>}
          {empty && q.length >= 2 && !loadingObjects && (
            <div className="cmdk-empty">No matches for “{q}”.</div>
          )}
          {empty && !q && !showConnectHint && (
            <div className="cmdk-hint">Type a name (e.g. calico), or pick a kind.</div>
          )}

          {hits.map((hit, idx) => (
            <button
              key={hit.id}
              type="button"
              role="option"
              aria-selected={idx === activeIdx}
              data-cmdk-idx={idx}
              className={`cmdk-row${hit.type === 'all' ? ' cmdk-row-all' : ''}${idx === activeIdx ? ' active' : ''}`}
              onMouseEnter={() => setActiveIdx(idx)}
              onClick={() => selectHit(hit)}
            >
              {hit.type === 'all' ? (
                <>
                  <span className="cmdk-row-kind">Cluster</span>
                  <span className="cmdk-row-title">
                    {loadingObjects && hit.count === 0
                      ? `Search “${hit.query}”…`
                      : `All results for “${hit.query}” (${hit.count})`}
                  </span>
                </>
              ) : hit.type === 'kind' ? (
                <>
                  <span className="cmdk-row-kind">Kind</span>
                  <span className="cmdk-row-title">{hit.label}</span>
                </>
              ) : (
                <>
                  <span className="cmdk-row-kind">{hit.label}</span>
                  <span className="cmdk-row-title">{hit.name}</span>
                  {hit.namespace && (
                    <span className="cmdk-row-ns">{hit.namespace}</span>
                  )}
                </>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
