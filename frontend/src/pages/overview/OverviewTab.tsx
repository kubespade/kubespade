import { useEffect, useState } from 'react'
import type { ClusterInfo } from '../../types'
import type { MetricsHistorySource } from '../../api/client'
import { useNow } from '../../hooks/useNow'
import type { HistoryPoint } from './types'
import { StatCard } from './StatCard'
import { OverviewChart } from './OverviewChart'
import { DonutCard } from './DonutCard'
import { WarningsTable } from './WarningsTable'
import { fmtOverviewMetric } from '../../lib/metricFormat'
import {
  buildOverviewWindowPoints,
  computeOverviewYDomain,
  densifyOverviewWindowPoints,
  downsampleOverviewPoints,
  metricsRangesForLongHistory,
  metricsSourceLabel,
} from '../../lib/metricsRanges'
import { openSettings } from '../../lib/openSettings'
import { MetricsExpandedModal } from '../../components/MetricsExpandedModal'

export type { HistoryPoint } from './types'

export function OverviewTab({
  info,
  history,
  historySource,
  longHistory = false,
  retentionDays,
}: {
  info: ClusterInfo
  history: HistoryPoint[]
  historySource?: MetricsHistorySource
  longHistory?: boolean
  retentionDays?: number | null
}) {
  const now = useNow()
  const ranges = metricsRangesForLongHistory(longHistory, retentionDays)
  const [rangeIdx, setRangeIdx] = useState(0)
  const [expanded, setExpanded] = useState<'cpu' | 'mem' | null>(null)
  useEffect(() => {
    if (rangeIdx >= ranges.length) setRangeIdx(Math.max(0, ranges.length - 1))
  }, [ranges.length, rangeIdx])
  const warnings = (info.events ?? []).filter(e => e.type === 'Warning')
  const readyNodes = info.readyNodes ?? info.nodes.filter(n => n.status === 'Ready').length
  const notReady = info.nodeCount - readyNodes
  const m = info.metrics
  const sourceLabel = metricsSourceLabel(historySource)

  const safeIdx = Math.min(rangeIdx, ranges.length - 1)
  const rangeSec = ranges[safeIdx]!.seconds
  const windowPoints = m?.hasMetrics
    ? buildOverviewWindowPoints(history, rangeSec, { cpu: m.cpu.usage, mem: m.memory.usage })
    : []
  const chartPoints = densifyOverviewWindowPoints(windowPoints, rangeSec)
  const cpuChartPoints = downsampleOverviewPoints(chartPoints, 'cpu')
  const memChartPoints = downsampleOverviewPoints(chartPoints, 'mem')
  const cpuYDomain = computeOverviewYDomain(
    windowPoints.map(p => p.cpu),
    m && m.cpu.allocatable > 0 ? m.cpu.allocatable : undefined,
  )
  const memYDomain = computeOverviewYDomain(
    windowPoints.map(p => p.mem),
    m && m.memory.allocatable > 0 ? m.memory.allocatable : undefined,
  )
  const showHistoryCta = Boolean(m?.hasMetrics) && history.length < 2
    && historySource !== 'prometheus' && !longHistory

  return (
    <div className="ov-page">

      {/* ── Stats row ── */}
      <div className="ov-stats">
        <StatCard value={`${readyNodes} / ${info.nodeCount}`} label="Nodes Ready"
          accent={notReady > 0 ? 'danger' : 'ok'} />
        <StatCard value={String(info.namespaces.length)} label="Namespaces" />
        <StatCard value={info.version} label="Kubernetes" mono />
        {warnings.length > 0 && (
          <StatCard value={String(warnings.length)} label="Warnings" accent="warn" />
        )}
      </div>

      {/* ── Charts ── */}
      {m && (
        <div className="ov-charts">
          {m.hasMetrics && history.length > 1 && (
            <div className="ov-line-charts-block">
              <div className="ov-line-charts-header">
                <span className="ov-line-charts-title">Cluster Usage</span>
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
              </div>
              <div className="ov-line-charts-row">
                <OverviewChart
                  points={cpuChartPoints}
                  field="cpu"
                  color="#6ec8ff"
                  title="CPU"
                  rangeSec={rangeSec}
                  yDomain={cpuYDomain}
                  onExpand={() => setExpanded('cpu')}
                />
                <OverviewChart
                  points={memChartPoints}
                  field="mem"
                  color="#2ea86a"
                  title="Memory"
                  rangeSec={rangeSec}
                  yDomain={memYDomain}
                  onExpand={() => setExpanded('mem')}
                />
              </div>
            </div>
          )}

          {showHistoryCta && (
            <p className="metrics-source-cta">
              Enable collector or install Prometheus in{' '}
              <button type="button" className="link-btn" onClick={() => openSettings()}>Settings</button>
              {' '}for longer chart history.
            </p>
          )}

          {/* Donut charts */}
          <div className="ov-donuts">
            {m.hasMetrics && (
              <DonutCard
                title="CPU"
                usage={m.cpu.usage}
                requests={m.cpu.requests}
                limits={m.cpu.limits}
                allocatable={m.cpu.allocatable}
                color="#e0a01a"
                fmt={v => v.toFixed(2)}
                unit="cores"
              />
            )}
            {m.hasMetrics && (
              <DonutCard
                title="Memory"
                usage={m.memory.usage}
                requests={m.memory.requests}
                limits={m.memory.limits}
                allocatable={m.memory.allocatable}
                color="#2ea86a"
                fmt={v => v.toFixed(1)}
                unit="GiB"
              />
            )}
            <DonutCard
              title="Pods"
              usage={m.pods.usage}
              requests={0}
              limits={0}
              allocatable={m.pods.allocatable}
              color="#6ec8ff"
              fmt={v => String(Math.round(v))}
              unit="pods"
            />
            {!m.hasMetrics && (
              <div className="ov-no-metrics">
                Metrics Server not available.<br />
                CPU &amp; Memory usage requires <code>metrics-server</code>.
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Warnings ── */}
      {warnings.length > 0 && (
        <WarningsTable warnings={warnings} now={now} />
      )}

      {expanded && (
        <MetricsExpandedModal
          title={expanded === 'cpu' ? 'CPU' : 'Memory'}
          subtitle="Cluster Usage"
          color={expanded === 'cpu' ? '#6ec8ff' : '#2ea86a'}
          points={chartPoints.map(p => ({ tMs: p.t, value: p[expanded] }))}
          rangeSec={rangeSec}
          ranges={ranges}
          rangeIdx={safeIdx}
          onRangeChange={setRangeIdx}
          onClose={() => setExpanded(null)}
          fmtValue={v => fmtOverviewMetric(v, expanded)}
          yDomain={expanded === 'cpu' ? cpuYDomain : memYDomain}
        />
      )}

    </div>
  )
}

export default OverviewTab
