import { useMemo, useRef, useState, useEffect, useCallback, type PointerEvent as ReactPointerEvent, type MouseEvent as ReactMouseEvent } from 'react'
import { RefreshCw, Shield, MousePointerClick, GripVertical, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react'
import { api } from '../api/client'
import type { NetworkMap, NetworkMapEdge, NetworkMapNode } from '../types'
import { EmptyState } from '../components/EmptyState'
import { ErrorReconnectBanner } from '../components/ErrorReconnectBanner'
import { NamespaceCombo } from '../components/NamespaceCombo'
import { usePolledResource } from '../hooks/usePolledResource'
import { cssEscape } from '../lib/cssEscape'
import {
  autoLayout,
  edgePath,
  filterMap,
  isSyn,
  nameLines,
  nodeFingerprint,
  NODE_H,
  NODE_MIN_W,
  nodeWidth,
  normalizeMap,
  PAD,
  type Pos,
} from '../lib/policyMapLayout'

type LayoutNode = NetworkMapNode & Pos & { w: number; h: number }

const ZOOM_MIN = 0.4
const ZOOM_MAX = 2.5
const ZOOM_STEP = 0.1

function clampZoom(z: number): number {
  const snapped = Math.round(z / ZOOM_STEP) * ZOOM_STEP
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(snapped * 100) / 100))
}

function kindShort(kind: string): string {
  switch (kind) {
    case 'Deployment': return 'Deploy'
    case 'StatefulSet': return 'STS'
    case 'DaemonSet': return 'DS'
    case 'Namespace': return 'NS'
    case 'CIDR': return 'CIDR'
    default: return kind
  }
}

export function PolicyMapPage({
  profile,
  namespaces,
  selectedNs,
  onNsChange,
}: {
  profile: string
  namespaces: string[]
  selectedNs: string[] | null
  onNsChange: (ns: string[]) => void
}) {
  const apiNs = selectedNs && selectedNs.length === 1 ? selectedNs[0] : undefined
  const empty: NetworkMap = { nodes: [], edges: [], policies: 0, workloads: 0 }
  const { data: raw, loading, error, reload } = usePolledResource(
    () => api.listNetworkMap(profile, apiNs),
    [profile, apiNs ?? ''],
    { initial: empty, errorLabel: 'Failed to load policy map' },
  )
  const data = useMemo(() => filterMap(normalizeMap(raw), selectedNs), [raw, selectedNs])
  const fp = useMemo(() => nodeFingerprint(data.nodes), [data.nodes])

  const wrapRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const [hoverEdge, setHoverEdge] = useState<NetworkMapEdge | null>(null)
  const [hoverNodeId, setHoverNodeId] = useState<string | null>(null)
  const [selected, setSelected] = useState<NetworkMapNode | null>(null)
  const [positions, setPositions] = useState<Map<string, Pos>>(() => new Map())
  const sizesRef = useRef<Map<string, { w: number; h: number }>>(new Map())
  const positionsRef = useRef(positions)
  positionsRef.current = positions
  const [contentSize, setContentSize] = useState({ w: 640, h: 420 })
  // Live extent during drag (ref only — setState would re-render and reset transforms).
  const contentSizeRef = useRef(contentSize)
  const dragRef = useRef<{
    id: string
    ox: number
    oy: number
    startX: number
    startY: number
    moved: boolean
    pointerId: number
    maxX: number
    maxY: number
  } | null>(null)
  const [dragging, setDragging] = useState(false)
  const [zoom, setZoom] = useState(1)
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom
  const rafRef = useRef(0)

  const applyContentSize = useCallback((w: number, h: number, commit: boolean) => {
    const next = {
      w: Math.max(320, Math.ceil(w)),
      h: Math.max(240, Math.ceil(h)),
    }
    if (next.w === contentSizeRef.current.w && next.h === contentSizeRef.current.h) {
      if (commit) setContentSize(s => (s.w === next.w && s.h === next.h ? s : next))
      return
    }
    contentSizeRef.current = next
    const svg = svgRef.current
    if (svg) {
      svg.setAttribute('width', String(next.w))
      svg.setAttribute('height', String(next.h))
      svg.style.width = `${next.w}px`
      svg.style.height = `${next.h}px`
    }
    if (commit) setContentSize(next)
  }, [])

  /** Expand the map to fill the visible canvas (never shrink). Safe: does not follow scrollbars. */
  const fillVisibleCanvas = useCallback(() => {
    const el = wrapRef.current
    if (!el) return
    applyContentSize(
      Math.max(contentSizeRef.current.w, el.clientWidth),
      Math.max(contentSizeRef.current.h, el.clientHeight),
      true,
    )
  }, [applyContentSize])

  useEffect(() => {
    const { positions: next, sizes, contentW, contentH } = autoLayout(data.nodes)
    sizesRef.current = sizes
    setPositions(next)
    positionsRef.current = next
    applyContentSize(contentW, contentH, true)
    setSelected(prev => (prev && next.has(prev.id) ? prev : null))
    const t = requestAnimationFrame(() => fillVisibleCanvas())
    return () => cancelAnimationFrame(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fp])

  useEffect(() => () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
  }, [])

  const laid: LayoutNode[] = useMemo(() => (
    data.nodes.map(n => {
      const p = positions.get(n.id) ?? { x: PAD + NODE_MIN_W / 2, y: PAD + NODE_H / 2 }
      const sz = sizesRef.current.get(n.id) ?? { w: nodeWidth(n.name), h: NODE_H }
      return { ...n, ...p, ...sz }
    })
  ), [data.nodes, positions])

  const byId = useMemo(() => {
    const m = new Map<string, LayoutNode>()
    for (const n of laid) m.set(n.id, n)
    return m
  }, [laid])

  const svgW = Math.max(contentSize.w, contentSizeRef.current.w, 320)
  const svgH = Math.max(contentSize.h, contentSizeRef.current.h, 240)

  const related = useMemo(() => {
    if (!selected) return new Set<string>()
    const s = new Set<string>([selected.id])
    for (const e of data.edges) {
      if (e.from === selected.id || e.to === selected.id) {
        s.add(e.from)
        s.add(e.to)
      }
    }
    return s
  }, [selected, data.edges])

  const hoverNode = hoverNodeId ? data.nodes.find(n => n.id === hoverNodeId) ?? null : null

  const clientToSvg = useCallback((clientX: number, clientY: number): Pos => {
    const canvas = wrapRef.current
    if (!canvas) return { x: clientX, y: clientY }
    const crect = canvas.getBoundingClientRect()
    const z = zoomRef.current || 1
    // Scrollport pixels → SVG space (CSS scale on the SVG).
    return {
      x: (clientX - crect.left + canvas.scrollLeft) / z,
      y: (clientY - crect.top + canvas.scrollTop) / z,
    }
  }, [])

  const scrollCanvasToShow = useCallback((x: number, y: number, nw: number, nh: number) => {
    const canvas = wrapRef.current
    if (!canvas) return
    const z = zoomRef.current || 1
    const pad = 40 * z
    const left = (x - nw / 2) * z - pad
    const right = (x + nw / 2) * z + pad
    const top = (y - nh / 2) * z - pad
    const bottom = (y + nh / 2) * z + pad
    if (left < canvas.scrollLeft) canvas.scrollLeft = Math.max(0, left)
    else if (right > canvas.scrollLeft + canvas.clientWidth) {
      canvas.scrollLeft = right - canvas.clientWidth
    }
    if (top < canvas.scrollTop) canvas.scrollTop = Math.max(0, top)
    else if (bottom > canvas.scrollTop + canvas.clientHeight) {
      canvas.scrollTop = bottom - canvas.clientHeight
    }
  }, [])

  const setZoomAround = useCallback((nextZoom: number, anchorClientX?: number, anchorClientY?: number) => {
    const canvas = wrapRef.current
    const z0 = zoomRef.current || 1
    const z1 = clampZoom(nextZoom)
    if (z1 === z0) return

    if (canvas) {
      const crect = canvas.getBoundingClientRect()
      const ax = anchorClientX ?? (crect.left + canvas.clientWidth / 2)
      const ay = anchorClientY ?? (crect.top + canvas.clientHeight / 2)
      const svgX = (ax - crect.left + canvas.scrollLeft) / z0
      const svgY = (ay - crect.top + canvas.scrollTop) / z0
      zoomRef.current = z1
      setZoom(z1)
      requestAnimationFrame(() => {
        const el = wrapRef.current
        if (!el) return
        const r = el.getBoundingClientRect()
        el.scrollLeft = svgX * z1 - (ax - r.left)
        el.scrollTop = svgY * z1 - (ay - r.top)
      })
      return
    }
    zoomRef.current = z1
    setZoom(z1)
  }, [])

  const zoomBy = useCallback((delta: number) => {
    setZoomAround(zoomRef.current + delta)
  }, [setZoomAround])

  const fitZoom = useCallback(() => {
    const canvas = wrapRef.current
    if (!canvas) {
      setZoomAround(1)
      return
    }
    const pad = 24
    const cw = Math.max(1, canvas.clientWidth - pad)
    const ch = Math.max(1, canvas.clientHeight - pad)
    const sw = Math.max(1, contentSizeRef.current.w)
    const sh = Math.max(1, contentSizeRef.current.h)
    const next = clampZoom(Math.min(cw / sw, ch / sh, 1))
    zoomRef.current = next
    setZoom(next)
    requestAnimationFrame(() => {
      const el = wrapRef.current
      if (!el) return
      el.scrollLeft = 0
      el.scrollTop = 0
    })
  }, [setZoomAround])

  // Non-passive wheel so ⌘/Ctrl+scroll zooms the map instead of the page.
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      e.preventDefault()
      e.stopPropagation()
      const factor = e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP
      setZoomAround(zoomRef.current + factor, e.clientX, e.clientY)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [setZoomAround, data.nodes.length])

  const paintDragFrame = useCallback((id: string, x: number, y: number) => {
    const svg = svgRef.current
    if (!svg) return
    const esc = cssEscape(id)
    const sz = sizesRef.current.get(id) ?? { w: NODE_MIN_W, h: NODE_H }
    scrollCanvasToShow(x, y, sz.w, sz.h)

    const g = svg.querySelector(`[data-node-id="${esc}"]`) as SVGGElement | null
    if (g) g.setAttribute('transform', `translate(${x - sz.w / 2}, ${y - sz.h / 2})`)

    const pos = positionsRef.current
    svg.querySelectorAll(`[data-edge-from="${esc}"], [data-edge-to="${esc}"]`).forEach(el => {
      const path = el as SVGPathElement
      const fromId = path.dataset.edgeFrom
      const toId = path.dataset.edgeTo
      if (!fromId || !toId) return
      const a = fromId === id ? { x, y } : pos.get(fromId)
      const b = toId === id ? { x, y } : pos.get(toId)
      if (!a || !b) return
      path.setAttribute('d', edgePath(a, b))
    })
  }, [scrollCanvasToShow])

  const endDrag = useCallback(() => {
    const d = dragRef.current
    if (!d) return
    dragRef.current = null
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = 0
    }
    setDragging(false)

    const cur = positionsRef.current.get(d.id)
    if (!cur) return

    setPositions(prev => {
      const next = new Map(prev)
      next.set(d.id, cur)
      positionsRef.current = next
      return next
    })

    if (!d.moved) {
      const n = data.nodes.find(x => x.id === d.id)
      if (n) setSelected(prev => (prev?.id === n.id ? null : n))
    }
  }, [data.nodes])

  const onNodePointerDown = useCallback((e: ReactPointerEvent<SVGGElement>, id: string) => {
    e.stopPropagation()
    e.preventDefault()
    const node = positionsRef.current.get(id)
    if (!node) return
    const local = clientToSvg(e.clientX, e.clientY)
    const sz = sizesRef.current.get(id) ?? { w: NODE_MIN_W, h: NODE_H }
    const canvas = wrapRef.current
    if (canvas) {
      applyContentSize(
        Math.max(contentSizeRef.current.w, canvas.clientWidth),
        Math.max(contentSizeRef.current.h, canvas.clientHeight),
        false,
      )
    }
    const boundW = contentSizeRef.current.w
    const boundH = contentSizeRef.current.h
    const inset = 8
    dragRef.current = {
      id,
      ox: local.x - node.x,
      oy: local.y - node.y,
      startX: node.x,
      startY: node.y,
      moved: false,
      pointerId: e.pointerId,
      maxX: Math.max(sz.w / 2 + inset, boundW - sz.w / 2 - inset),
      maxY: Math.max(sz.h / 2 + inset, boundH - sz.h / 2 - inset),
    }
    setDragging(true)
    e.currentTarget.setPointerCapture(e.pointerId)
  }, [applyContentSize, clientToSvg])

  const onNodePointerMove = useCallback((e: ReactPointerEvent<SVGGElement>) => {
    const d = dragRef.current
    if (!d || e.pointerId !== d.pointerId) return
    e.preventDefault()
    const local = clientToSvg(e.clientX, e.clientY)
    const sz = sizesRef.current.get(d.id) ?? { w: NODE_MIN_W, h: NODE_H }
    const minX = sz.w / 2 + 8
    const minY = sz.h / 2 + 8
    const x = Math.min(d.maxX, Math.max(minX, local.x - d.ox))
    const y = Math.min(d.maxY, Math.max(minY, local.y - d.oy))
    if (!d.moved && Math.hypot(x - d.startX, y - d.startY) > 3) d.moved = true

    const next = new Map(positionsRef.current)
    next.set(d.id, { x, y })
    positionsRef.current = next

    if (rafRef.current) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0
      const live = dragRef.current
      if (!live) return
      const p = positionsRef.current.get(live.id)
      if (p) paintDragFrame(live.id, p.x, p.y)
    })
  }, [clientToSvg, paintDragFrame])

  const onNodePointerUp = useCallback((e: ReactPointerEvent<SVGGElement>) => {
    const d = dragRef.current
    if (!d || e.pointerId !== d.pointerId) return
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* ok */ }
    endDrag()
  }, [endDrag])

  const resetLayout = useCallback(() => {
    const { positions: next, sizes, contentW, contentH } = autoLayout(data.nodes)
    sizesRef.current = sizes
    setPositions(next)
    positionsRef.current = next
    applyContentSize(contentW, contentH, true)
    requestAnimationFrame(() => fillVisibleCanvas())
  }, [applyContentSize, data.nodes, fillVisibleCanvas])

  const onBgClick = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
    const t = e.target
    if (!(t instanceof Element)) return
    if (t === wrapRef.current || t.classList.contains('policy-map-svg')) {
      setSelected(null)
    }
  }, [])

  if (loading && data.nodes.length === 0 && !error) {
    return <div className="cv-loading">Building policy map…</div>
  }

  const selectedEdges = selected
    ? data.edges.filter(e => e.from === selected.id || e.to === selected.id)
    : []

  const openCount = data.nodes.filter(n => n.openIngress || n.openEgress).length

  return (
    <div className="policy-map-page">
      {error && <ErrorReconnectBanner error={error} onReconnect={reload} />}

      <div className="policy-map-toolbar">
        <div className="policy-map-toolbar-left">
          <NamespaceCombo namespaces={namespaces} value={selectedNs} onChange={onNsChange} />
          <span className="policy-map-meta">
            {data.workloads} workloads · {data.policies} policies · {data.edges.length} edges
            {openCount > 0 ? ` · ${openCount} open to anywhere` : ''}
          </span>
        </div>
        <div className="policy-map-toolbar-right">
          <button
            type="button"
            className="policy-map-text-btn"
            onClick={() => zoomBy(-ZOOM_STEP)}
            disabled={zoom <= ZOOM_MIN}
            title="Zoom out"
            aria-label="Zoom out"
          >
            <ZoomOut size={13} />
          </button>
          <button
            type="button"
            className="policy-map-text-btn policy-map-zoom-pct"
            onClick={() => setZoomAround(1)}
            title="Reset zoom to 100%"
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            type="button"
            className="policy-map-text-btn"
            onClick={() => zoomBy(ZOOM_STEP)}
            disabled={zoom >= ZOOM_MAX}
            title="Zoom in"
            aria-label="Zoom in"
          >
            <ZoomIn size={13} />
          </button>
          <button type="button" className="policy-map-text-btn" onClick={fitZoom} title="Fit map in view">
            <Maximize2 size={12} />
            Fit
          </button>
          <button type="button" className="policy-map-text-btn" onClick={resetLayout} title="Reset node positions">
            Reset layout
          </button>
          <button type="button" className="icon-btn icon-btn-quiet" onClick={reload} title="Refresh">
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      <div className="policy-map-legend" aria-label="Edge legend">
        <span className="policy-map-legend-item">
          <svg width="28" height="10" aria-hidden>
            <line x1="0" y1="5" x2="28" y2="5" className="policy-map-legend-line ingress" />
          </svg>
          <span><strong>Ingress</strong> — allowed <em>to</em> the workload</span>
        </span>
        <span className="policy-map-legend-item">
          <svg width="28" height="10" aria-hidden>
            <line x1="0" y1="5" x2="28" y2="5" className="policy-map-legend-line egress" />
          </svg>
          <span><strong>Egress</strong> — allowed <em>from</em> the workload</span>
        </span>
        <span className="policy-map-legend-item">
          <span className="policy-map-badge-sample">in:any</span>
          <span className="policy-map-badge-sample eg">eg:any</span>
          <span>allow anywhere (no peer / 0.0.0.0/0) — not drawn as arrows</span>
        </span>
        <span className="policy-map-legend-item policy-map-legend-hint">
          <GripVertical size={12} />
          Drag to untangle · click to pin · ⌘/Ctrl+scroll to zoom
        </span>
        <span className="policy-map-legend-item policy-map-legend-hint">
          <Shield size={12} />
          Intent from NetworkPolicy — not live flows
        </span>
      </div>

      {data.note && <div className="policy-map-note">{data.note}</div>}

      {data.nodes.length === 0 ? (
        <div className="res-placeholder">
          <EmptyState
            title="Nothing to map"
            hint="No Deployments, StatefulSets, or DaemonSets in this scope. Create workloads or widen the namespace filter."
          />
        </div>
      ) : (
        <div className="policy-map-body">
          <div
            className={`policy-map-canvas${dragging ? ' dragging' : ''}`}
            ref={wrapRef}
            onClick={onBgClick}
          >
            <div
              className="policy-map-zoom-space"
              style={{ width: svgW * zoom, height: svgH * zoom }}
            >
              <svg
                ref={svgRef}
                width={svgW}
                height={svgH}
                className="policy-map-svg"
                style={{
                  width: svgW,
                  height: svgH,
                  transform: `scale(${zoom})`,
                  transformOrigin: '0 0',
                }}
                overflow="visible"
              >
              <defs>
                <marker id="pm-arrow-in" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" className="policy-map-arrowhead ingress" />
                </marker>
                <marker id="pm-arrow-eg" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" className="policy-map-arrowhead egress" />
                </marker>
              </defs>

              {data.edges.map(e => {
                const a = byId.get(e.from)
                const b = byId.get(e.to)
                if (!a || !b) return null
                const dim = related.size > 0 && !related.has(e.from) && !related.has(e.to)
                const hot = hoverEdge?.id === e.id
                  || (selected != null && (e.from === selected.id || e.to === selected.id))
                return (
                  <path
                    key={e.id}
                    data-edge-from={e.from}
                    data-edge-to={e.to}
                    d={edgePath(a, b)}
                    className={`policy-map-edge ${e.dir} ${dim ? 'dim' : ''} ${hot ? 'hot' : ''}`}
                    markerEnd={e.dir === 'egress' ? 'url(#pm-arrow-eg)' : 'url(#pm-arrow-in)'}
                    onMouseEnter={() => { if (!dragRef.current) setHoverEdge(e) }}
                    onMouseLeave={() => setHoverEdge(null)}
                  >
                    <title>{`${e.dir} · ${e.ports || 'all ports'} · ${e.policyNamespace}/${e.policy}`}</title>
                  </path>
                )
              })}

              {laid.map(n => {
                const dim = related.size > 0 && !related.has(n.id)
                const active = selected?.id === n.id
                const syn = isSyn(n.kind)
                const lines = nameLines(n.name, n.w)
                const badgeY = n.h - 12
                return (
                  <g
                    key={n.id}
                    data-node-id={n.id}
                    className={`policy-map-node ${syn ? 'syn' : 'wl'} ${dim ? 'dim' : ''} ${active ? 'active' : ''}`}
                    transform={`translate(${n.x - n.w / 2}, ${n.y - n.h / 2})`}
                    onMouseEnter={() => { if (!dragRef.current) setHoverNodeId(n.id) }}
                    onMouseLeave={() => { if (!dragRef.current) setHoverNodeId(null) }}
                    onClick={ev => ev.stopPropagation()}
                    onPointerDown={ev => onNodePointerDown(ev, n.id)}
                    onPointerMove={onNodePointerMove}
                    onPointerUp={onNodePointerUp}
                    onPointerCancel={onNodePointerUp}
                  >
                    <title>{n.namespace ? `${n.kind} · ${n.namespace}/${n.name}` : `${n.kind} · ${n.name}`}</title>
                    <rect width={n.w} height={n.h} rx={8} ry={8} />
                    <text className="policy-map-node-kind" x={10} y={14}>{kindShort(n.kind)}</text>
                    <text className="policy-map-node-name" x={10} y={30}>{lines[0]}</text>
                    {lines[1] && (
                      <text className="policy-map-node-name" x={10} y={44}>{lines[1]}</text>
                    )}
                    {(n.openIngress || n.openEgress) && (
                      <text className="policy-map-node-badges" x={10} y={badgeY}>
                        {n.openIngress ? 'in:any' : ''}
                        {n.openIngress && n.openEgress ? '  ' : ''}
                        {n.openEgress ? 'eg:any' : ''}
                      </text>
                    )}
                  </g>
                )
              })}
            </svg>
            </div>

            {hoverNode && !dragging && (
              <div className="policy-map-tooltip policy-map-tooltip-node">
                <div className="policy-map-tooltip-name mono">{hoverNode.name}</div>
                <div className="muted">
                  {hoverNode.kind}
                  {hoverNode.namespace ? ` · ${hoverNode.namespace}` : ''}
                  {hoverNode.openIngress ? ' · open ingress' : ''}
                  {hoverNode.openEgress ? ' · open egress' : ''}
                </div>
              </div>
            )}

            {hoverEdge && !dragging && (
              <div className="policy-map-tooltip">
                <strong>{hoverEdge.dir}</strong>
                {' · '}
                {hoverEdge.ports || 'all ports'}
                <br />
                <span className="mono">{hoverEdge.policyNamespace}/{hoverEdge.policy}</span>
              </div>
            )}
          </div>

          <aside className="policy-map-side">
            <div className="policy-map-side-head">
              <MousePointerClick size={14} />
              <div>
                <div className="policy-map-side-head-title">Allowed peers</div>
                <div className="policy-map-side-head-sub">
                  Who this node may talk to / receive from (policy allow rules)
                </div>
              </div>
            </div>

            {selected ? (
              <>
                <div className="policy-map-side-title" title={selected.name}>{selected.name}</div>
                <div className="policy-map-side-row"><span>Kind</span><span>{selected.kind}</span></div>
                {selected.namespace && (
                  <div className="policy-map-side-row">
                    <span>Namespace</span>
                    <span className="mono">{selected.namespace}</span>
                  </div>
                )}
                {(selected.openIngress || selected.openEgress) && (
                  <div className="policy-map-side-row">
                    <span>Anywhere</span>
                    <span>
                      {selected.openIngress ? 'ingress' : ''}
                      {selected.openIngress && selected.openEgress ? ' + ' : ''}
                      {selected.openEgress ? 'egress' : ''}
                    </span>
                  </div>
                )}
                <div className="policy-map-side-section">
                  Connections ({selectedEdges.length})
                </div>
                <ul className="policy-map-side-list">
                  {selectedEdges.map(e => {
                    const other = e.from === selected.id ? e.to : e.from
                    const otherNode = byId.get(other)
                    const arrow = e.from === selected.id ? '→' : '←'
                    return (
                      <li key={e.id}>
                        <button
                          type="button"
                          className="policy-map-side-link"
                          onClick={() => {
                            const n = data.nodes.find(x => x.id === other)
                            if (n) setSelected(n)
                          }}
                        >
                          <span className="mono">{arrow} {otherNode?.name ?? other}</span>
                          <span className="muted">{e.dir} · {e.ports || 'all'} · {e.policy}</span>
                        </button>
                      </li>
                    )
                  })}
                  {selectedEdges.length === 0 && !selected.openIngress && !selected.openEgress && (
                    <li className="muted">No allow edges for this node</li>
                  )}
                  {selectedEdges.length === 0 && (selected.openIngress || selected.openEgress) && (
                    <li className="muted">Only open-to-anywhere rules (see badges)</li>
                  )}
                </ul>
              </>
            ) : (
              <div className="policy-map-side-empty">
                <p>Click a workload or peer box on the map to pin its connections.</p>
                <p className="muted">
                  Click again, another box, or empty canvas to clear. The list shows inbound (←) and outbound (→) allow rules from NetworkPolicies.
                </p>
              </div>
            )}
          </aside>
        </div>
      )}
    </div>
  )
}
