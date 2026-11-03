/** Parse Kubernetes CPU quantity → millicores. */
export function parseCPUMilli(s: string): number {
  if (!s) return 0
  if (s.endsWith('m')) return parseInt(s)
  if (s.endsWith('n')) return parseInt(s) / 1e6
  return parseFloat(s) * 1000
}

/** Parse Kubernetes memory quantity → bytes. */
export function parseMemBytes(s: string): number {
  if (!s) return 0
  const units: [string, number][] = [
    ['Ki', 1024], ['Mi', 1024 ** 2], ['Gi', 1024 ** 3], ['Ti', 1024 ** 4],
    ['K', 1000],  ['M', 1000 ** 2],  ['G', 1000 ** 3],
  ]
  for (const [suf, mult] of units) {
    if (s.endsWith(suf)) return parseFloat(s) * mult
  }
  return parseInt(s) || 0
}

/** Format millicores for node table cells (e.g. "250m", "1.50c"). */
export function fmtCPUMilli(milli: number): string {
  if (milli >= 1000) return `${(milli / 1000).toFixed(2)}c`
  return `${milli}m`
}

/** Format bytes for node table cells (e.g. "512Mi", "1.5Gi"). */
export function fmtMemBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)}Gi`
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)}Mi`
  return `${Math.round(bytes / 1024)}Ki`
}

/** Format a metric sample for Info panel gauges/charts. */
export function fmtMetric(val: number, type: 'cpu' | 'mem'): string {
  if (!Number.isFinite(val) || val < 0) val = 0
  if (type === 'cpu') {
    if (val >= 1000) return `${(val / 1000).toFixed(2)}c`
    // Round so float noise never becomes "1.6500000000000001m"
    const m = Math.round(val * 100) / 100
    return Number.isInteger(m) ? `${m}m` : `${m.toFixed(2)}m`
  }
  if (val >= 1024 ** 3) return `${(val / 1024 ** 3).toFixed(1)}Gi`
  if (val >= 1024 ** 2) return `${Math.round(val / 1024 ** 2)}Mi`
  if (val >= 1024) return `${Math.round(val / 1024)}Ki`
  return `${Math.round(val)}B`
}

/**
 * Format an overview-scale value for axis ticks / labels, where the input is
 * already in "big" units — CPU in cores, memory in GiB.
 */
export function fmtOverviewMetric(v: number, field: 'cpu' | 'mem'): string {
  if (field === 'cpu') return v >= 1 ? `${v.toFixed(2)}c` : `${(v * 1000).toFixed(0)}m`
  return v >= 1 ? `${v.toFixed(2)} GiB` : `${(v * 1024).toFixed(0)} MiB`
}
