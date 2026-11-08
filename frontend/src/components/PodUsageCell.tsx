import type { PodMetricsSummary } from '../api/client'

function formatCPU(milli: number): string {
  if (milli >= 1000) return `${(milli / 1000).toFixed(2)}`
  return `${(milli / 1000).toFixed(3)}`
}

function formatMem(bytes: number): string {
  const MB = 1024 * 1024
  const GB = 1024 * MB
  return bytes >= 1000 * MB
    ? `${(bytes / GB).toFixed(2)}Gi`
    : `${(bytes / MB).toFixed(1)}Mi`
}

function parseFieldInt(v: string | undefined): number {
  if (!v) return 0
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/** CPU/Memory cell: usage text + bar vs limit (else request). */
export function PodUsageCell({
  kind,
  metrics,
  fields,
}: {
  kind: 'cpu' | 'memory'
  metrics?: PodMetricsSummary
  fields: Record<string, string>
}) {
  if (!metrics) return <span className="res-usage-muted">—</span>

  const usage = kind === 'cpu' ? metrics.cpuMilli : metrics.memBytes
  const lim = kind === 'cpu'
    ? parseFieldInt(fields.cpuLimMilli)
    : parseFieldInt(fields.memLimBytes)
  const req = kind === 'cpu'
    ? parseFieldInt(fields.cpuReqMilli)
    : parseFieldInt(fields.memReqBytes)
  const denom = lim || req
  const pct = denom > 0 ? Math.min(100, (usage / denom) * 100) : 0
  const over = denom > 0 && usage > denom
  const warn = !over && denom > 0 && usage / denom >= 0.85
  const label = kind === 'cpu' ? formatCPU(usage) : formatMem(usage)
  const tip = denom > 0
    ? `${label} / ${kind === 'cpu' ? formatCPU(denom) : formatMem(denom)}${lim ? ' limit' : ' request'}`
    : label

  return (
    <span className="res-usage" title={tip}>
      <span className="res-usage-val">{label}</span>
      {denom > 0 && (
        <span className={`res-usage-bar${over ? ' over' : warn ? ' warn' : ''}`}>
          <i style={{ width: `${pct}%` }} />
        </span>
      )}
    </span>
  )
}
