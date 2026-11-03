import React, { useEffect, useRef, useState } from 'react'
import type { HistoryPoint } from './types'
import { computeOverviewYDomain, fmtMetricsAxisTick, fmtMetricsClock, extendHistoryPointsToNow, interpolateAtTime, metricsAxisMidFracs } from '../../lib/metricsRanges'
import { fmtOverviewMetric } from '../../lib/metricFormat'
import { useNow } from '../../hooks/useNow'
import { MetricsExpandButton } from '../../components/MetricsExpandedModal'

export function OverviewChart({ points, field, color, title, rangeSec, onExpand, yDomain }: {
  points: HistoryPoint[]
  field: 'cpu' | 'mem'
  color: string
  title: string
  rangeSec: number
  onExpand?: () => void
  yDomain?: { yMin: number; yMax: number }
}) {
  useNow()
  const containerRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(300)
  const [hover, setHover] = useState<{ tMs: number; value: number } | null>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(entries => setWidth(Math.floor(entries[0]!.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  if (points.length < 2) {
    return (
      <div ref={containerRef} className="mch-wrap mch-waiting">
        collecting data…
      </div>
    )
  }

  const plotPoints = extendHistoryPointsToNow(points)

  const L_PAD = 54, R_PAD = 8, T_PAD = 8, B_PAD = 18
  const H = 98
  const cW = Math.max(width - L_PAD - R_PAD, 10)
  const cH = H - T_PAD - B_PAD

  const vals = plotPoints.map(p => p[field])
  const { yMin, yMax } = yDomain ?? computeOverviewYDomain(vals)

  const nowMs = Date.now()
  const windowMs = rangeSec * 1000
  const windowStartMs = nowMs - windowMs

  function toX(tMs: number) {
    const frac = Math.max(0, Math.min(1, (tMs - windowStartMs) / windowMs))
    return L_PAD + frac * cW
  }
  function toY(v: number) { return T_PAD + cH - ((v - yMin) / (yMax - yMin)) * cH }

  const linePath = plotPoints.map((p, i) =>
    `${i === 0 ? 'M' : 'L'}${toX(p.t).toFixed(1)},${toY(vals[i]!).toFixed(1)}`
  ).join(' ')
  const lastX = toX(plotPoints[plotPoints.length - 1]!.t)
  const firstX = toX(plotPoints[0]!.t)
  const areaPath = linePath
    + ` L${lastX.toFixed(1)},${(T_PAD + cH).toFixed(1)}`
    + ` L${firstX.toFixed(1)},${(T_PAD + cH).toFixed(1)} Z`

  const yLabels = [yMax, (yMin + yMax) / 2, yMin]

  function handleMouseMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left - L_PAD) / cW))
    const targetMs = windowStartMs + frac * windowMs
    const series = plotPoints.map(p => ({ tMs: p.t, value: p[field] }))
    const first = series[0]!.tMs
    const last = series[series.length - 1]!.tMs
    const clamped = Math.max(first, Math.min(last, targetMs))
    setHover(interpolateAtTime(series, clamped))
  }

  const hov = hover
  const hovVal = hov?.value ?? null
  const hovX = hov ? toX(hov.tMs) : null
  const hovY = hovVal != null ? toY(hovVal) : null
  const hovTimeLabel = hov ? fmtMetricsClock(hov.tMs, rangeSec) : ''

  return (
    <div
      ref={containerRef}
      className={`mch-wrap ov-chart-cell${onExpand ? ' mch-expandable' : ''}`}
      onClick={onExpand}
      role={onExpand ? 'button' : undefined}
      tabIndex={onExpand ? 0 : undefined}
      onKeyDown={onExpand ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onExpand() } } : undefined}
      title={onExpand ? 'Click to expand' : undefined}
    >
      <div className="ov-chart-cell-hdr">
        <span className="ov-chart-cell-title">{title}</span>
        {onExpand && <MetricsExpandButton onClick={onExpand} />}
      </div>
      <svg width={width} height={H} onMouseMove={handleMouseMove} onMouseLeave={() => setHover(null)}
        style={{ cursor: onExpand ? 'pointer' : 'crosshair', display: 'block', overflow: 'visible' }}>
        {yLabels.map((v, i) => {
          const y = toY(v)
          return (
            <g key={i}>
              <line x1={L_PAD} y1={y} x2={L_PAD + cW} y2={y}
                stroke="var(--border)" strokeWidth={0.5} />
              <text x={L_PAD - 4} y={y} textAnchor="end" dominantBaseline="middle"
                fontSize={9} fill="var(--muted)" fontFamily="var(--font-mono)">
                {fmtOverviewMetric(v, field)}
              </text>
            </g>
          )
        })}
        <path d={areaPath} fill={color} fillOpacity={0.12} stroke="none" />
        <path d={linePath} fill="none" stroke={color} strokeWidth={1.5}
          strokeLinecap="round" strokeLinejoin="round" />
        <text x={L_PAD} y={H - 4} fontSize={9} fill="var(--muted)"
          fontFamily="var(--font-mono)" textAnchor="start">
          {fmtMetricsAxisTick(windowStartMs, rangeSec)}
        </text>
        {metricsAxisMidFracs(rangeSec).map(frac => {
          const tMs = windowStartMs + frac * windowMs
          return (
            <text
              key={frac}
              x={toX(tMs)}
              y={H - 4}
              fontSize={9}
              fill="var(--muted)"
              fontFamily="var(--font-mono)"
              textAnchor="middle"
            >
              {fmtMetricsAxisTick(tMs, rangeSec)}
            </text>
          )
        })}
        <text x={L_PAD + cW} y={H - 4} fontSize={9} fill="var(--muted)"
          fontFamily="var(--font-mono)" textAnchor="end">
          {fmtMetricsAxisTick(nowMs, rangeSec)}
        </text>
        {hov && hovX !== null && hovY !== null && hovVal !== null && (() => {
          const tipW = 96, tipH = 30
          const tipX = hovX + 8 + tipW > L_PAD + cW ? hovX - 8 - tipW : hovX + 8
          const tipY = Math.max(T_PAD, Math.min(hovY - tipH / 2, T_PAD + cH - tipH))
          return (
            <g>
              <line x1={hovX} y1={T_PAD} x2={hovX} y2={T_PAD + cH}
                stroke={color} strokeWidth={1} strokeDasharray="3,2" strokeOpacity={0.5} />
              <circle cx={hovX} cy={hovY} r={3} fill={color} />
              <rect x={tipX} y={tipY} width={tipW} height={tipH}
                rx={3} fill="var(--surface2)" stroke="var(--border)" strokeWidth={0.5} />
              <text x={tipX + 6} y={tipY + 11} fontSize={10} fill={color}
                fontFamily="var(--font-mono)" fontWeight="600">
                {fmtOverviewMetric(hovVal, field)}
              </text>
              <text x={tipX + 6} y={tipY + 23} fontSize={9} fill="var(--muted)"
                fontFamily="var(--font-mono)">
                {hovTimeLabel}
              </text>
            </g>
          )
        })()}
      </svg>
    </div>
  )
}
