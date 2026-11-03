import { useEffect, useRef, useState } from 'react'
import type { ContainerMetric, MetricPoint, MetricsHistorySource, NodeMetricsSummary } from '../../api/client'
import { useNow } from '../../hooks/useNow'
import {
  buildMetricWindowPoints,
  computeMetricsYDomain,
  densifyMetricWindowPoints,
  downsampleMetricPoints,
  extendMetricPointsToNow,
  fmtMetricsAxisTick,
  fmtMetricsClock,
  interpolateAtTime,
  metricsAxisMidFracs,
  metricsRangesForLongHistory,
  metricsSourceLabel,
  pointTsSec,
} from '../../lib/metricsRanges'
import { openSettings } from '../../lib/openSettings'
import { MetricsExpandedModal, MetricsExpandButton } from '../MetricsExpandedModal'
import { fmtMetric, parseCPUMilli, parseMemBytes } from '../../lib/metricFormat'
import { arr, raw, rec } from '../../lib/resourceInfoProps'

export function MiniGauge({ pct, color }: { pct: number; color: string }) {
  const R = 22
  const C = 2 * Math.PI * R
  const arc = Math.min(Math.max(pct, 0), 1) * C
  return (
    <svg width={54} height={54} viewBox="0 0 54 54" style={{ flexShrink: 0 }}>
      <circle cx={27} cy={27} r={R} fill="none" stroke="var(--border)" strokeWidth={5} />
      {arc > 0.01 && (
        <circle cx={27} cy={27} r={R} fill="none" stroke={color} strokeWidth={5}
          strokeDasharray={`${arc} ${C - arc}`}
          strokeLinecap="round"
          transform="rotate(-90 27 27)"
        />
      )}
      <text x={27} y={27} dominantBaseline="middle" textAnchor="middle"
        fill="var(--text)" fontSize={9} fontFamily="var(--font-mono)" fontWeight="700">
        {Math.round(pct * 100)}%
      </text>
    </svg>
  )
}

export function MetricsChart({ points, color, type, rangeSec, onExpand, yDomain }: {
  points: MetricPoint[]
  color: string
  type: 'cpu' | 'mem'
  rangeSec: number
  onExpand?: () => void
  yDomain?: { yMin: number; yMax: number }
}) {
  useNow()
  const containerRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(240)
  const [hover, setHover] = useState<{ tMs: number; value: number } | null>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(entries => {
      setWidth(Math.floor(entries[0].contentRect.width))
    })
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

  const plotPoints = extendMetricPointsToNow(points)

  const L_PAD = 44, R_PAD = 8, T_PAD = 6, B_PAD = 18
  const H = 74
  const cW = Math.max(width - L_PAD - R_PAD, 10)
  const cH = H - T_PAD - B_PAD

  const vals = plotPoints.map(p => {
    const v = type === 'cpu' ? p.cpuMilli : p.memBytes
    return Number.isFinite(v) && v >= 0 ? v : 0
  })
  const { yMin, yMax } = yDomain ?? computeMetricsYDomain(vals, type)

  const nowSec = Date.now() / 1000
  const windowStartSec = nowSec - rangeSec

  function toX(ts: number) {
    const frac = Math.max(0, Math.min(1, (pointTsSec(ts) - windowStartSec) / rangeSec))
    return L_PAD + frac * cW
  }
  function toY(v: number) { return T_PAD + cH - ((v - yMin) / (yMax - yMin)) * cH }

  const linePath = plotPoints.map((p, i) =>
    `${i === 0 ? 'M' : 'L'}${toX(p.ts).toFixed(1)},${toY(vals[i]).toFixed(1)}`
  ).join(' ')
  const lastX = toX(plotPoints[plotPoints.length - 1]!.ts)
  const firstX = toX(plotPoints[0]!.ts)
  const areaPath = linePath
    + ` L${lastX.toFixed(1)},${(T_PAD + cH).toFixed(1)}`
    + ` L${firstX.toFixed(1)},${(T_PAD + cH).toFixed(1)} Z`

  const yLabels = [yMax, (yMin + yMax) / 2, yMin]

  function handleMouseMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left - L_PAD) / cW))
    const targetMs = (windowStartSec + frac * rangeSec) * 1000
    const series = plotPoints.map((p, i) => ({ tMs: pointTsSec(p.ts) * 1000, value: vals[i]! }))
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
      className={`mch-wrap${onExpand ? ' mch-expandable' : ''}`}
      onClick={onExpand}
      role={onExpand ? 'button' : undefined}
      tabIndex={onExpand ? 0 : undefined}
      onKeyDown={onExpand ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onExpand() } } : undefined}
      title={onExpand ? 'Click to expand' : undefined}
    >
      <svg width={width} height={H} onMouseMove={handleMouseMove} onMouseLeave={() => setHover(null)}
        style={{ cursor: onExpand ? 'pointer' : undefined }}>
        {yLabels.map((v, i) => {
          const y = toY(v)
          return (
            <g key={i}>
              <line x1={L_PAD} y1={y} x2={L_PAD + cW} y2={y}
                stroke="var(--border)" strokeWidth={0.5} />
              <text x={L_PAD - 4} y={y} textAnchor="end" dominantBaseline="middle"
                fontSize={9} fill="var(--muted)" fontFamily="var(--font-mono)">
                {fmtMetric(v, type)}
              </text>
            </g>
          )
        })}
        <path d={areaPath} fill={color} fillOpacity={0.1} stroke="none" />
        <path d={linePath} fill="none" stroke={color} strokeWidth={1.5}
          strokeLinecap="round" strokeLinejoin="round" />
        <text x={L_PAD} y={H - 4} fontSize={9} fill="var(--muted)"
          fontFamily="var(--font-mono)" textAnchor="start">
          {fmtMetricsAxisTick(windowStartSec * 1000, rangeSec)}
        </text>
        {metricsAxisMidFracs(rangeSec).map(frac => {
          const tSec = windowStartSec + frac * rangeSec
          return (
            <text
              key={frac}
              x={L_PAD + frac * cW}
              y={H - 4}
              fontSize={9}
              fill="var(--muted)"
              fontFamily="var(--font-mono)"
              textAnchor="middle"
            >
              {fmtMetricsAxisTick(tSec * 1000, rangeSec)}
            </text>
          )
        })}
        <text x={L_PAD + cW} y={H - 4} fontSize={9} fill="var(--muted)"
          fontFamily="var(--font-mono)" textAnchor="end">
          {fmtMetricsAxisTick(nowSec * 1000, rangeSec)}
        </text>
        {hov && hovX !== null && hovY !== null && hovVal !== null && (() => {
          const tipW = 82, tipH = 30
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
                {fmtMetric(hovVal, type)}
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

/**
 * Shared metrics header for pods and nodes. Callers pass already-computed current /
 * anchor values and sub-labels; markup is identical for both (nodes additionally pass
 * a `disk` card). Chart/window/domain computation and range + expand state live here.
 */
export function MetricsHeader({
  cpuCurrentMilli, cpuAnchorMilli, cpuLimitText,
  memCurrentBytes, memAnchorBytes, memLimitText,
  disk, history, longHistory, retentionDays, historySource, resourceName,
}: {
  cpuCurrentMilli: number
  cpuAnchorMilli: number
  cpuLimitText: string | null
  memCurrentBytes: number
  memAnchorBytes: number
  memLimitText: string | null
  disk?: { used: number; cap: number }
  history: MetricPoint[]
  longHistory: boolean
  retentionDays?: number | null
  historySource?: MetricsHistorySource
  resourceName?: string
}) {
  const ranges = metricsRangesForLongHistory(longHistory, retentionDays)
  const [rangeIdx, setRangeIdx] = useState(0)
  const [expanded, setExpanded] = useState<'cpu' | 'mem' | null>(null)
  useEffect(() => {
    if (rangeIdx >= ranges.length) setRangeIdx(Math.max(0, ranges.length - 1))
  }, [ranges.length, rangeIdx])

  const cpuPct = cpuAnchorMilli > 0 ? cpuCurrentMilli / cpuAnchorMilli : 0
  const memPct = memAnchorBytes > 0 ? memCurrentBytes / memAnchorBytes : 0

  const safeIdx = Math.min(rangeIdx, ranges.length - 1)
  const rangeSec = ranges[safeIdx]!.seconds
  const windowPoints = buildMetricWindowPoints(history, rangeSec, {
    cpuMilli: cpuCurrentMilli,
    memBytes: memCurrentBytes,
  })
  const chartPoints = densifyMetricWindowPoints(windowPoints, rangeSec)
  const cpuChartPoints = downsampleMetricPoints(chartPoints, 'cpu')
  const memChartPoints = downsampleMetricPoints(chartPoints, 'mem')
  const cpuYDomain = computeMetricsYDomain(
    windowPoints.map(p => p.cpuMilli),
    'cpu',
    cpuAnchorMilli > 0 ? cpuAnchorMilli : undefined,
  )
  const memYDomain = computeMetricsYDomain(
    windowPoints.map(p => p.memBytes),
    'mem',
    memAnchorBytes > 0 ? memAnchorBytes : undefined,
  )
  const sourceLabel = metricsSourceLabel(historySource)
  const showHistoryCta = history.length < 2 && historySource !== 'prometheus' && !longHistory

  return (
    <div className="pod-mhdr">
      <div className="pod-mhdr-range">
        {sourceLabel && (
          <span className="metrics-source-chip" title="Metrics history source">{sourceLabel}</span>
        )}
        {ranges.map((r, i) => (
          <button
            key={r.label}
            className={`pod-mhdr-range-btn${i === safeIdx ? ' active' : ''}`}
            onClick={() => setRangeIdx(i)}
          >
            {r.label}
          </button>
        ))}
      </div>
      {showHistoryCta && (
        <p className="metrics-source-cta">
          Enable collector or install Prometheus in{' '}
          <button type="button" className="link-btn" onClick={() => openSettings()}>Settings</button>
          {' '}for longer chart history.
        </p>
      )}
      <div className="pod-mhdr-cards">
        <div className="pod-mhdr-card">
          <div className="pod-mhdr-top">
            <MiniGauge pct={cpuPct} color="var(--c-blue)" />
            <div className="pod-mhdr-text">
              <span className="pod-mhdr-label">CPU</span>
              <span className="pod-mhdr-val">{fmtMetric(cpuCurrentMilli, 'cpu')}</span>
              {cpuLimitText != null && <span className="pod-mhdr-limit">{cpuLimitText}</span>}
            </div>
            <MetricsExpandButton onClick={() => setExpanded('cpu')} />
          </div>
          <MetricsChart points={cpuChartPoints} color="var(--c-blue)" type="cpu" rangeSec={rangeSec} yDomain={cpuYDomain} onExpand={() => setExpanded('cpu')} />
        </div>
        <div className="pod-mhdr-card">
          <div className="pod-mhdr-top">
            <MiniGauge pct={memPct} color="var(--c-green)" />
            <div className="pod-mhdr-text">
              <span className="pod-mhdr-label">Memory</span>
              <span className="pod-mhdr-val">{fmtMetric(memCurrentBytes, 'mem')}</span>
              {memLimitText != null && <span className="pod-mhdr-limit">{memLimitText}</span>}
            </div>
            <MetricsExpandButton onClick={() => setExpanded('mem')} />
          </div>
          <MetricsChart points={memChartPoints} color="var(--c-green)" type="mem" rangeSec={rangeSec} yDomain={memYDomain} onExpand={() => setExpanded('mem')} />
        </div>
        {disk && (
          <div className="pod-mhdr-card">
            <div className="pod-mhdr-top">
              <MiniGauge pct={disk.cap > 0 ? disk.used / disk.cap : 0} color="var(--c-orange, #e8832a)" />
              <div className="pod-mhdr-text">
                <span className="pod-mhdr-label">Disk</span>
                <span className="pod-mhdr-val">{fmtMetric(disk.used, 'mem')}</span>
                <span className="pod-mhdr-limit">of {fmtMetric(disk.cap, 'mem')}</span>
              </div>
            </div>
            <DiskUsageBar used={disk.used} total={disk.cap} />
          </div>
        )}
      </div>
      {expanded && (
        <MetricsExpandedModal
          title={expanded === 'cpu' ? 'CPU' : 'Memory'}
          subtitle={resourceName}
          color={expanded === 'cpu' ? 'var(--c-blue)' : 'var(--c-green)'}
          points={chartPoints.map(p => ({
            tMs: pointTsSec(p.ts) * 1000,
            value: expanded === 'cpu' ? p.cpuMilli : p.memBytes,
          }))}
          rangeSec={rangeSec}
          ranges={ranges}
          rangeIdx={safeIdx}
          onRangeChange={setRangeIdx}
          onClose={() => setExpanded(null)}
          fmtValue={v => fmtMetric(v, expanded)}
          yDomain={expanded === 'cpu' ? cpuYDomain : memYDomain}
        />
      )}
    </div>
  )
}

export function PodMetricsHeader({ spec, metricsMap, history, longHistory, retentionDays, historySource, resourceName }: {
  spec: Record<string, unknown>
  metricsMap: Record<string, ContainerMetric>
  history: MetricPoint[]
  longHistory: boolean
  retentionDays?: number | null
  historySource?: MetricsHistorySource
  resourceName?: string
}) {
  const containers = arr(spec.containers)

  let totalCPUMilli = 0
  let totalMemBytes = 0
  for (const m of Object.values(metricsMap)) {
    totalCPUMilli += m.cpuMilli
    totalMemBytes += m.memBytes
  }

  let limitCPUMilli = 0
  let limitMemBytes = 0
  for (const c of containers) {
    const lim = rec(rec(rec(c).resources).limits)
    const cpuLim = raw(lim.cpu); const memLim = raw(lim.memory)
    if (cpuLim) limitCPUMilli += parseCPUMilli(cpuLim)
    if (memLim) limitMemBytes += parseMemBytes(memLim)
  }

  return (
    <MetricsHeader
      cpuCurrentMilli={totalCPUMilli}
      cpuAnchorMilli={limitCPUMilli}
      cpuLimitText={limitCPUMilli > 0 ? `limit ${fmtMetric(limitCPUMilli, 'cpu')}` : null}
      memCurrentBytes={totalMemBytes}
      memAnchorBytes={limitMemBytes}
      memLimitText={limitMemBytes > 0 ? `limit ${fmtMetric(limitMemBytes, 'mem')}` : null}
      history={history}
      longHistory={longHistory}
      retentionDays={retentionDays}
      historySource={historySource}
      resourceName={resourceName}
    />
  )
}

export function DiskUsageBar({ used, total }: { used: number; total: number }) {
  const pct = total > 0 ? Math.min(used / total, 1) : 0
  const free = Math.max(0, total - used)
  const color = pct > 0.9 ? 'var(--c-red, #e05252)' : pct > 0.7 ? 'var(--c-yellow, #d4a)' : 'var(--c-orange, #e8832a)'
  const segments = 20
  return (
    <div className="disk-bar-wrap">
      <div className="disk-bar-segments">
        {Array.from({ length: segments }, (_, i) => (
          <div
            key={i}
            className="disk-bar-seg"
            style={{ background: i / segments < pct ? color : undefined }}
          />
        ))}
      </div>
      <div className="disk-bar-row">
        <span className="disk-bar-used" style={{ color }}>{fmtMetric(used, 'mem')} used</span>
        <span className="disk-bar-free">{fmtMetric(free, 'mem')} free</span>
      </div>
      <div className="disk-bar-row">
        <span className="disk-bar-pct">{Math.round(pct * 100)}%</span>
        <span className="disk-bar-total">of {fmtMetric(total, 'mem')}</span>
      </div>
    </div>
  )
}

// ── Node metrics header ───────────────────────────────────────────────────────

export function NodeMetricsHeader({ status, metrics, history, longHistory, retentionDays, historySource, resourceName }: {
  status: Record<string, unknown>
  metrics: NodeMetricsSummary
  history: MetricPoint[]
  longHistory: boolean
  retentionDays?: number | null
  historySource?: MetricsHistorySource
  resourceName?: string
}) {
  const allocatable = rec(status.allocatable)
  const cpuAllocMilli = parseCPUMilli(raw(allocatable.cpu))
  const memAllocBytes = parseMemBytes(raw(allocatable.memory))
  const diskUsed = metrics.diskUsedBytes ?? 0
  const diskCap = metrics.diskCapBytes ?? 0

  return (
    <MetricsHeader
      cpuCurrentMilli={metrics.cpuMilli}
      cpuAnchorMilli={cpuAllocMilli}
      cpuLimitText={cpuAllocMilli > 0 ? `of ${fmtMetric(cpuAllocMilli, 'cpu')} allocatable` : null}
      memCurrentBytes={metrics.memBytes}
      memAnchorBytes={memAllocBytes}
      memLimitText={memAllocBytes > 0 ? `of ${fmtMetric(memAllocBytes, 'mem')} allocatable` : null}
      disk={diskCap > 0 ? { used: diskUsed, cap: diskCap } : undefined}
      history={history}
      longHistory={longHistory}
      retentionDays={retentionDays}
      historySource={historySource}
      resourceName={resourceName}
    />
  )
}

// ── Events section ────────────────────────────────────────────────────────────
