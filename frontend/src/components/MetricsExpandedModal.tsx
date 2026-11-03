import { useEffect, useRef, useState } from 'react'
import { useEscapeKey } from '../hooks/useEscapeKey'
import { createPortal } from 'react-dom'
import { Maximize2, X } from 'lucide-react'
import { useNow } from '../hooks/useNow'
import { fmtMetricsAxisTick, fmtMetricsClock, interpolateAtTime, metricsAxisTickCount } from '../lib/metricsRanges'

export interface ExpandedSeriesPoint {
  tMs: number
  value: number
}

export interface MetricsRangeBtn {
  label: string
  seconds: number
}

function safeNum(n: number, fallback = 0): number {
  return Number.isFinite(n) ? n : fallback
}

export function MetricsExpandedModal({
  title,
  subtitle,
  color,
  points,
  rangeSec,
  ranges,
  rangeIdx,
  onRangeChange,
  onClose,
  fmtValue,
  yDomain,
}: {
  title: string
  subtitle?: string
  color: string
  points: ExpandedSeriesPoint[]
  rangeSec: number
  ranges: readonly MetricsRangeBtn[]
  rangeIdx: number
  onRangeChange: (idx: number) => void
  onClose: () => void
  fmtValue: (v: number) => string
  yDomain?: { yMin: number; yMax: number }
}) {
  useNow()
  const containerRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(640)
  const [hover, setHover] = useState<{ tMs: number; value: number } | null>(null)

  useEscapeKey(onClose)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(entries => {
      const w = Math.floor(entries[0]?.contentRect.width ?? 0)
      if (w > 0) setWidth(w)
    })
    ro.observe(el)
    const initial = Math.floor(el.getBoundingClientRect().width)
    if (initial > 0) setWidth(initial)
    return () => ro.disconnect()
  }, [])

  const nowMs = Date.now()
  const windowMs = Math.max(1, rangeSec * 1000)
  const windowStartMs = nowMs - windowMs

  const plotPoints = (() => {
    if (points.length === 0) return points
    const last = points[points.length - 1]!
    if (nowMs - last.tMs < 1000) return points
    return [...points, { tMs: nowMs, value: last.value }]
  })()

  const L_PAD = 64, R_PAD = 16, T_PAD = 16, B_PAD = 28
  const H = 320
  const cW = Math.max(width - L_PAD - R_PAD, 10)
  const cH = H - T_PAD - B_PAD

  const vals = plotPoints.map(p => safeNum(p.value))
  const { yMin, yMax } = yDomain ?? (() => {
    const rawMin = vals.length ? Math.min(...vals) : 0
    const rawMax = vals.length ? Math.max(...vals) : 1
    const pad = (rawMax - rawMin) * 0.15 || Math.abs(rawMax) * 0.1 || 0.001
    return {
      yMin: Math.max(0, rawMin - pad),
      yMax: Math.max(rawMin + pad, rawMax + pad),
    }
  })()

  // Resolve CSS vars to concrete colors — Safari SVG attrs can break on var(--…).
  const strokeColor = color.startsWith('var(') ? undefined : color
  const resolvedColor = strokeColor ?? (
    color.includes('green') ? '#2ea86a' :
    color.includes('blue') ? '#6ec8ff' :
    '#6ec8ff'
  )

  function toX(tMs: number) {
    const frac = Math.max(0, Math.min(1, (tMs - windowStartMs) / windowMs))
    return L_PAD + frac * cW
  }
  function toY(v: number) {
    const span = yMax - yMin || 1
    return T_PAD + cH - ((safeNum(v) - yMin) / span) * cH
  }

  // Fit ticks to plot width; long ranges use fewer, shorter labels.
  const tickCount = metricsAxisTickCount(rangeSec, cW)
  const xTicks = Array.from({ length: tickCount }, (_, i) => {
    const frac = tickCount === 1 ? 0 : i / (tickCount - 1)
    const tMs = windowStartMs + frac * windowMs
    return { x: toX(tMs), label: fmtMetricsAxisTick(tMs, rangeSec) }
  })

  const EXPANDED_Y_TICK_COUNT = 5
  const ySpan = yMax - yMin || 1
  const yLabels = Array.from({ length: EXPANDED_Y_TICK_COUNT }, (_, i) =>
    yMax - (i / (EXPANDED_Y_TICK_COUNT - 1)) * ySpan,
  )

  let linePath = ''
  let areaPath = ''
  if (plotPoints.length >= 2) {
    linePath = plotPoints.map((p, i) =>
      `${i === 0 ? 'M' : 'L'}${toX(p.tMs).toFixed(1)},${toY(vals[i]!).toFixed(1)}`
    ).join(' ')
    const lastX = toX(plotPoints[plotPoints.length - 1]!.tMs)
    const firstX = toX(plotPoints[0]!.tMs)
    areaPath = linePath
      + ` L${lastX.toFixed(1)},${(T_PAD + cH).toFixed(1)}`
      + ` L${firstX.toFixed(1)},${(T_PAD + cH).toFixed(1)} Z`
  }

  const series = plotPoints.map((p, i) => ({ tMs: p.tMs, value: vals[i]! }))

  function handlePointerMove(clientX: number, target: Element) {
    if (series.length === 0) return
    const rect = target.getBoundingClientRect()
    const frac = Math.max(0, Math.min(1, (clientX - rect.left - L_PAD) / cW))
    const targetMs = windowStartMs + frac * windowMs
    // Clamp hover to actual data span so crosshair stays on the line.
    const first = series[0]!.tMs
    const last = series[series.length - 1]!.tMs
    const clamped = Math.max(first, Math.min(last, targetMs))
    setHover(interpolateAtTime(series, clamped))
  }

  const hov = hover
  const hovVal = hov?.value ?? null
  const hovX = hov ? toX(hov.tMs) : null
  const hovY = hovVal != null ? toY(hovVal) : null
  const hovClock = hov ? fmtMetricsClock(hov.tMs, rangeSec) : ''

  return createPortal(
    <div className="mch-expanded-root" role="presentation">
      <div className="mch-expanded-backdrop" onMouseDown={onClose} onTouchEnd={e => { e.preventDefault(); onClose() }} />
      <div
        className="mch-expanded-modal"
        onMouseDown={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="mch-expanded-header">
          <div className="mch-expanded-titles">
            <span className="mch-expanded-title">{title}</span>
            {subtitle && <span className="mch-expanded-subtitle">{subtitle}</span>}
          </div>
          <div className="pod-mhdr-range mch-expanded-ranges">
            {ranges.map((r, i) => (
              <button
                key={r.label}
                type="button"
                className={`pod-mhdr-range-btn${i === rangeIdx ? ' active' : ''}`}
                onClick={() => onRangeChange(i)}
              >
                {r.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="ip-btn ip-btn-close mch-expanded-close"
            onClick={onClose}
            aria-label="Close"
            data-tooltip="Close"
          >
            <X size={16} strokeWidth={2} />
          </button>
        </div>
        <div ref={containerRef} className="mch-expanded-body">
          {plotPoints.length < 2 ? (
            <div className="mch-wrap mch-waiting" style={{ height: H }}>collecting data…</div>
          ) : (
            <svg
              width={width}
              height={H}
              onMouseMove={e => handlePointerMove(e.clientX, e.currentTarget)}
              onMouseLeave={() => setHover(null)}
              onTouchStart={e => {
                const t = e.touches[0]
                if (t) handlePointerMove(t.clientX, e.currentTarget)
              }}
              onTouchMove={e => {
                const t = e.touches[0]
                if (t) handlePointerMove(t.clientX, e.currentTarget)
              }}
              style={{ cursor: 'crosshair', display: 'block', overflow: 'visible' }}
            >
              {yLabels.map((v, i) => {
                const y = toY(v)
                return (
                  <g key={i}>
                    <line x1={L_PAD} y1={y} x2={L_PAD + cW} y2={y}
                      stroke="currentColor" strokeOpacity={0.25} strokeWidth={0.5} className="mch-grid-line" />
                    <text x={L_PAD - 6} y={y} textAnchor="end" dominantBaseline="middle"
                      fontSize={11} fill="currentColor" opacity={0.55} fontFamily="var(--font-mono)"
                      className="mch-axis-label">
                      {fmtValue(v)}
                    </text>
                  </g>
                )
              })}
              <path d={areaPath} fill={resolvedColor} fillOpacity={0.12} stroke="none" />
              <path d={linePath} fill="none" stroke={resolvedColor} strokeWidth={2}
                strokeLinecap="round" strokeLinejoin="round" />
              {xTicks.map((t, i) => (
                <text key={i} x={t.x} y={H - 6} fontSize={10} fill="currentColor" opacity={0.55}
                  fontFamily="var(--font-mono)" className="mch-axis-label"
                  textAnchor={i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle'}>
                  {t.label}
                </text>
              ))}
              {hov && hovX !== null && hovY !== null && hovVal != null && (() => {
                const tipW = 120, tipH = 42
                const tipX = hovX + 10 + tipW > L_PAD + cW ? hovX - 10 - tipW : hovX + 10
                const tipY = Math.max(T_PAD, Math.min(hovY - tipH / 2, T_PAD + cH - tipH))
                return (
                  <g>
                    <line x1={hovX} y1={T_PAD} x2={hovX} y2={T_PAD + cH}
                      stroke={resolvedColor} strokeWidth={1} strokeDasharray="4,3" strokeOpacity={0.55} />
                    <circle cx={hovX} cy={hovY} r={4} fill={resolvedColor} />
                    <rect x={tipX} y={tipY} width={tipW} height={tipH}
                      rx={4} fill="var(--surface2)" stroke="var(--border)" strokeWidth={0.5} />
                    <text x={tipX + 8} y={tipY + 14} fontSize={12} fill={resolvedColor}
                      fontFamily="var(--font-mono)" fontWeight="600">
                      {fmtValue(hovVal)}
                    </text>
                    <text x={tipX + 8} y={tipY + 28} fontSize={10} fill="currentColor" opacity={0.55}
                      fontFamily="var(--font-mono)">
                      {hovClock}
                    </text>
                  </g>
                )
              })()}
            </svg>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

/** Expand control — place in card/header corner, not over the plot. */
export function MetricsExpandButton({ onClick, title = 'Expand chart' }: {
  onClick: () => void
  title?: string
}) {
  return (
    <button
      type="button"
      className="mch-expand-btn"
      onClick={e => { e.stopPropagation(); onClick() }}
      title={title}
      aria-label={title}
    >
      <Maximize2 size={13} strokeWidth={2} />
    </button>
  )
}
