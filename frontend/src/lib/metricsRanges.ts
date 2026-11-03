/** Chart time-window presets (local buffer ≈1h; longer needs in-cluster collector). */
export const METRICS_LIVE_POLL_MS = 3_000
export const METRICS_HISTORY_POLL_MS = 5_000
export const METRICS_OVERVIEW_POLL_MS = 5_000
/** 720 × 5s ≈ 1h of local history at fast poll rate. */
export const METRICS_HISTORY_MAX_POINTS = 720
/** Cap for in-cluster collector series (multi-day). */
export const OVERVIEW_HISTORY_CAP = 20_000
/** Hold-last-value fill up to this window (collector samples ~60–120s apart). */
export const METRICS_DENSIFY_MAX_SEC = 6 * 3600

export const METRICS_RANGE_SHORT = [
  { label: '5m', seconds: 300 },
  { label: '10m', seconds: 600 },
  { label: '30m', seconds: 1800 },
  { label: '1h', seconds: 3600 },
] as const

export const METRICS_RANGE_LONG = [
  { label: '6h', seconds: 6 * 3600 },
  { label: '24h', seconds: 24 * 3600 },
  { label: '7d', seconds: 7 * 86400 },
  { label: '14d', seconds: 14 * 86400 },
  { label: '30d', seconds: 30 * 86400 },
] as const

export const METRICS_RANGE_OPTIONS = [
  ...METRICS_RANGE_SHORT,
  ...METRICS_RANGE_LONG,
] as const

export type MetricsRangeOption = (typeof METRICS_RANGE_OPTIONS)[number]

/**
 * Short ranges always. Long ranges when collector or Prometheus provides multi-day history.
 * Retention caps long windows for the in-cluster collector; Prometheus defaults to 30d.
 */
export function metricsRangesForCollector(
  collectorEnabled: boolean,
  retentionDays?: number | null,
): readonly MetricsRangeOption[] {
  if (!collectorEnabled) return METRICS_RANGE_SHORT
  const days = retentionDays && retentionDays > 0 ? retentionDays : 7
  const maxSec = days * 86400
  return [
    ...METRICS_RANGE_SHORT,
    ...METRICS_RANGE_LONG.filter(r => r.seconds <= maxSec),
  ]
}

/** Long history available from Prometheus (treat like 30d retention). */
export function metricsRangesForLongHistory(
  longHistory: boolean,
  retentionDays?: number | null,
): readonly MetricsRangeOption[] {
  return metricsRangesForCollector(longHistory, retentionDays ?? (longHistory ? 30 : null))
}

export function metricsSourceLabel(source: string | undefined | null): string {
  switch (source) {
    case 'prometheus': return 'Prometheus'
    case 'cluster': return 'Collector'
    case 'local': return 'Local'
    default: return ''
  }
}

/** Hold-last densify window: densify for any selected chart range up to 30d. */
export function densifyMaxSecForRange(rangeSec: number): number {
  if (rangeSec <= 3600) return METRICS_DENSIFY_MAX_SEC
  return Math.min(Math.max(rangeSec, METRICS_DENSIFY_MAX_SEC), 30 * 86400)
}

/** Adaptive hold-last step so long Prom/collector windows stay readable after densify. */
export function densifyStepSecForRange(rangeSec: number): number {
  if (rangeSec <= 3600) return 15
  if (rangeSec <= 6 * 3600) return 60
  if (rangeSec <= 24 * 3600) return 120
  if (rangeSec <= 7 * 86400) return 900
  return 3600
}

/** Mid-axis fractions for compact charts (skip on very short windows). */
export function metricsAxisMidFracs(rangeSec: number): number[] {
  if (rangeSec <= 600) return []
  if (rangeSec <= 3600) return [0.5]
  return [0.25, 0.5, 0.75]
}

/** Installed / collecting — not merely Free or never enabled. */
export function isCollectorEnabledState(state: string | undefined): boolean {
  return state === 'running' || state === 'pending' || state === 'error'
}

export function pointTsSec(ts: number): number {
  return ts > 1e12 ? ts / 1000 : ts
}

export interface HistoryPointLike {
  t: number
  cpu: number
  mem: number
}


/** Absolute clock label for a sample timestamp (ms). Used in hover tooltips. */
export function fmtMetricsClock(tMs: number, rangeSec = 3600): string {
  const d = new Date(tMs)
  if (!Number.isFinite(d.getTime())) return '—'
  if (rangeSec <= 86400) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
  return d.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Compact X-axis tick — short enough to avoid overlap on wide windows. */
export function fmtMetricsAxisTick(tMs: number, rangeSec: number): string {
  const d = new Date(tMs)
  if (!Number.isFinite(d.getTime())) return '—'
  if (rangeSec <= 3600) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  }
  if (rangeSec <= 86400) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
  // Multi-day: date only (time still available on hover).
  return d.toLocaleDateString([], { day: 'numeric', month: 'short' })
}

/** How many X ticks fit without overlapping, given plot width and range. */
export function metricsAxisTickCount(rangeSec: number, plotWidth: number): number {
  const labelW = rangeSec <= 3600 ? 56 : rangeSec <= 86400 ? 48 : 64
  const byWidth = Math.max(3, Math.floor(plotWidth / labelW))
  const byRange =
    rangeSec <= 600 ? 6 :
    rangeSec <= 1800 ? 7 :
    rangeSec <= 3600 ? 8 :
    rangeSec <= 6 * 3600 ? 7 :
    rangeSec <= 86400 ? 6 :
    rangeSec <= 7 * 86400 ? 7 :
    6
  return Math.min(byWidth, byRange)
}

/** Interpolate series value at an arbitrary time (smooth hover / crosshair). */
export function interpolateAtTime(
  points: ReadonlyArray<{ tMs: number; value: number }>,
  targetMs: number,
): { tMs: number; value: number } | null {
  if (points.length === 0) return null
  if (points.length === 1) return { tMs: points[0]!.tMs, value: points[0]!.value }

  if (targetMs <= points[0]!.tMs) {
    return { tMs: points[0]!.tMs, value: points[0]!.value }
  }
  const last = points[points.length - 1]!
  if (targetMs >= last.tMs) {
    return { tMs: last.tMs, value: last.value }
  }

  let lo = 0
  let hi = points.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (points[mid]!.tMs <= targetMs) lo = mid
    else hi = mid
  }
  const a = points[lo]!
  const b = points[hi]!
  const span = b.tMs - a.tMs
  const t = span > 0 ? (targetMs - a.tMs) / span : 0
  return {
    tMs: targetMs,
    value: a.value + (b.value - a.value) * t,
  }
}

/** Accessors so pod/node ({ts,cpuMilli,memBytes}) and overview ({t,cpu,mem}) share cores. */
export interface SeriesAccessors<T, Live = never> {
  /** Point time in milliseconds. */
  getTimeMs: (p: T) => number
  getCpu: (p: T) => number
  getMem: (p: T) => number
  withTimeMs: (p: T, tMs: number) => T
  withValues: (p: T, cpu: number, mem: number) => T
  makeAt: (tMs: number, cpu: number, mem: number) => T
  liveCpu?: (live: Live) => number
  liveMem?: (live: Live) => number
}

const metricAccessors: SeriesAccessors<
  { ts: number; cpuMilli: number; memBytes: number },
  { cpuMilli: number; memBytes: number }
> = {
  getTimeMs: p => pointTsSec(p.ts) * 1000,
  getCpu: p => p.cpuMilli,
  getMem: p => p.memBytes,
  withTimeMs: (p, tMs) => ({ ...p, ts: Math.floor(tMs / 1000) }),
  withValues: (p, cpu, mem) => ({ ...p, cpuMilli: cpu, memBytes: mem }),
  makeAt: (tMs, cpu, mem) => ({ ts: Math.floor(tMs / 1000), cpuMilli: cpu, memBytes: mem }),
  liveCpu: l => l.cpuMilli,
  liveMem: l => l.memBytes,
}

const overviewAccessors: SeriesAccessors<HistoryPointLike, { cpu: number; mem: number }> = {
  getTimeMs: p => p.t,
  getCpu: p => p.cpu,
  getMem: p => p.mem,
  withTimeMs: (p, tMs) => ({ ...p, t: tMs }),
  withValues: (p, cpu, mem) => ({ ...p, cpu, mem }),
  makeAt: (tMs, cpu, mem) => ({ t: tMs, cpu, mem }),
  liveCpu: l => l.cpu,
  liveMem: l => l.mem,
}

function extendPointsToNowCore<T>(points: T[], acc: SeriesAccessors<T>): T[] {
  if (points.length === 0) return points
  const last = points[points.length - 1]!
  const now = Date.now()
  if (now - acc.getTimeMs(last) < 1000) return points
  return [...points, acc.withTimeMs(last, now)]
}

function appendSampleCore<T>(
  history: T[],
  sample: T,
  acc: SeriesAccessors<T>,
  maxPoints = METRICS_HISTORY_MAX_POINTS,
): T[] {
  const last = history[history.length - 1]
  const sameBucket = last != null
    && Math.floor(acc.getTimeMs(last) / 1000) === Math.floor(acc.getTimeMs(sample) / 1000)
  const out = sameBucket
    ? [...history.slice(0, -1), sample]
    : [...history, sample]
  const grew = !sameBucket
  const cap = Math.min(OVERVIEW_HISTORY_CAP, Math.max(maxPoints, history.length + (grew ? 1 : 0)))
  return out.length > cap ? out.slice(out.length - cap) : out
}

function mergeHistoriesCore<T>(
  server: T[],
  client: T[],
  acc: SeriesAccessors<T>,
  maxPoints = METRICS_HISTORY_MAX_POINTS,
  /** Overview merge may keep multi-day series; pod/node merge stays at maxPoints. */
  allowLargeCap = false,
): T[] {
  if (server.length === 0) return client.slice(-maxPoints)
  if (client.length === 0) return server.slice(-maxPoints)

  const nowSec = Math.floor(Date.now() / 1000)
  const recentCutoff = nowSec - 15
  const cap = allowLargeCap
    ? Math.max(maxPoints, server.length > 500 ? OVERVIEW_HISTORY_CAP : maxPoints)
    : maxPoints
  const bySec = new Map<number, T>()

  for (const p of server) {
    bySec.set(Math.floor(acc.getTimeMs(p) / 1000), p)
  }
  for (const p of client) {
    const sec = Math.floor(acc.getTimeMs(p) / 1000)
    if (!bySec.has(sec) || sec >= recentCutoff) {
      bySec.set(sec, p)
    }
  }

  const merged = [...bySec.entries()].sort((a, b) => a[0] - b[0]).map(([, p]) => p)
  return merged.length > cap ? merged.slice(merged.length - cap) : merged
}

function applyRemoteHistoryCore<T>(
  server: T[],
  client: T[],
  acc: SeriesAccessors<T>,
  maxPoints = METRICS_HISTORY_MAX_POINTS,
  allowLargeCap = false,
): T[] {
  if (server.length === 0) return client.slice(-maxPoints)
  if (client.length === 0 || server.length > client.length + 3) {
    const cap = Math.max(maxPoints, server.length > 500 ? OVERVIEW_HISTORY_CAP : maxPoints)
    return server.length > cap ? server.slice(server.length - cap) : server
  }
  return mergeHistoriesCore(server, client, acc, maxPoints, allowLargeCap)
}

function buildWindowPointsCore<T, Live>(
  history: T[],
  rangeSec: number,
  live: Live,
  acc: SeriesAccessors<T, Live>,
): T[] {
  const cutoffMs = Date.now() - rangeSec * 1000
  const sorted = [...history].sort((a, b) => acc.getTimeMs(a) - acc.getTimeMs(b))
  let seed: T | undefined
  const windowHistory: T[] = []
  for (const p of sorted) {
    if (acc.getTimeMs(p) < cutoffMs) seed = p
    else windowHistory.push(p)
  }
  const seeded = seed
    ? [acc.withTimeMs(seed, cutoffMs), ...windowHistory]
    : windowHistory
  const now = Date.now()
  const cpu = acc.liveCpu!(live)
  const mem = acc.liveMem!(live)
  const last = seeded[seeded.length - 1]
  if (!last) {
    return [acc.makeAt(now, cpu, mem)]
  }
  if (now - acc.getTimeMs(last) < 1000) {
    if (acc.getCpu(last) === cpu && acc.getMem(last) === mem) return seeded
    return [...seeded.slice(0, -1), acc.withValues(last, cpu, mem)]
  }
  return [...seeded, acc.makeAt(now, cpu, mem)]
}

function densifyWindowPointsCore<T>(
  points: T[],
  rangeSec: number,
  acc: SeriesAccessors<T>,
): T[] {
  const densifyCap = densifyMaxSecForRange(rangeSec)
  if (points.length === 0 || rangeSec > densifyCap) return points
  const windowEndMs = Date.now()
  const windowStartMs = windowEndMs - rangeSec * 1000
  const sorted = [...points].sort((a, b) => acc.getTimeMs(a) - acc.getTimeMs(b))
  const stepMs = densifyStepSecForRange(rangeSec) * 1000

  let idx = 0
  while (idx + 1 < sorted.length && acc.getTimeMs(sorted[idx + 1]!) <= windowStartMs) {
    idx++
  }
  const fillStartMs = Math.max(windowStartMs, acc.getTimeMs(sorted[idx]!))
  if (fillStartMs > windowEndMs) return sorted.filter(p => acc.getTimeMs(p) >= windowStartMs)

  let cur = sorted[idx]!
  const out: T[] = []
  for (let t = fillStartMs; t <= windowEndMs; t += stepMs) {
    while (idx + 1 < sorted.length && acc.getTimeMs(sorted[idx + 1]!) <= t) {
      idx++
      cur = sorted[idx]!
    }
    out.push(acc.withTimeMs(cur, t))
  }
  const last = sorted[sorted.length - 1]!
  if (out.length === 0 || acc.getTimeMs(out[out.length - 1]!) < acc.getTimeMs(last)) {
    out.push(acc.withTimeMs(last, acc.getTimeMs(last)))
  }
  return out
}

/** Hold last sample until now so the line reaches the right edge (live dashboards). */
export function extendMetricPointsToNow<T extends { ts: number; cpuMilli: number; memBytes: number }>(
  points: T[],
): T[] {
  return extendPointsToNowCore(points, metricAccessors as unknown as SeriesAccessors<T>)
}

/** Same as extendMetricPointsToNow for overview cluster charts (t in ms). */
export function extendHistoryPointsToNow<T extends HistoryPointLike>(points: T[]): T[] {
  return extendPointsToNowCore(points, overviewAccessors as unknown as SeriesAccessors<T>)
}

/** Append a live sample; replace last point if within the same second. */
export function appendMetricSample<T extends { ts: number }>(
  history: T[],
  sample: T,
  maxPoints = METRICS_HISTORY_MAX_POINTS,
): T[] {
  return appendSampleCore(history, sample, metricAccessors as unknown as SeriesAccessors<T>, maxPoints)
}

/** Overview charts use t in milliseconds. */
export function appendHistorySample<T extends HistoryPointLike>(
  history: T[],
  sample: T,
  maxPoints = METRICS_HISTORY_MAX_POINTS,
): T[] {
  return appendSampleCore(history, sample, overviewAccessors as unknown as SeriesAccessors<T>, maxPoints)
}

/** Keep client samples collected between slower server history polls. */
export function mergeMetricHistories<T extends { ts: number }>(
  server: T[],
  client: T[],
  maxPoints = METRICS_HISTORY_MAX_POINTS,
): T[] {
  return mergeHistoriesCore(server, client, metricAccessors as unknown as SeriesAccessors<T>, maxPoints)
}

export interface MetricPointLike {
  ts: number
  cpuMilli: number
  memBytes: number
}

/** Windowed history + one live tail (no duplicate same-second samples).
 * Keeps the last sample before the window so hold-last densify can fill short ranges
 * when Prometheus/collector steps are coarser than the selected window. */
export function buildMetricWindowPoints<T extends MetricPointLike>(
  history: T[],
  rangeSec: number,
  live: { cpuMilli: number; memBytes: number },
): T[] {
  return buildWindowPointsCore(history, rangeSec, live, metricAccessors as unknown as SeriesAccessors<T, typeof live>)
}

/** Hold-last-value fill for pod/node windows (collector ~60–120s; Prometheus step varies).
 * Never invent samples before the first real point (young pods / short series). */
export function densifyMetricWindowPoints<T extends MetricPointLike>(
  points: T[],
  rangeSec: number,
): T[] {
  return densifyWindowPointsCore(points, rangeSec, metricAccessors as unknown as SeriesAccessors<T>)
}

export function computeMetricsYDomain(
  values: number[],
  type: 'cpu' | 'mem',
  anchorMax?: number,
): { yMin: number; yMax: number } {
  const finite = values.filter(v => Number.isFinite(v) && v >= 0)
  const rawMin = finite.length ? Math.min(...finite) : 0
  const rawMax = finite.length ? Math.max(...finite) : 0
  const snap = type === 'cpu' ? 0.01 : 1

  if (anchorMax != null && anchorMax > 0) {
    return { yMin: 0, yMax: anchorMax }
  }

  const pad = (rawMax - rawMin) * 0.15 || rawMax * 0.1 || snap
  const yMin = Math.max(0, Math.floor((rawMin - pad) / snap) * snap)
  const yMax = Math.ceil((rawMax + pad) / snap) * snap || snap
  return { yMin, yMax }
}

/**
 * Preserve spikes when downsampling: bucket the series and keep the min+max of
 * each bucket (ordered by time). Shared core for the pod/node and overview charts,
 * parameterised by how to read a point's value and timestamp.
 */
function downsampleByBuckets<T>(
  points: T[],
  getVal: (p: T) => number,
  getTime: (p: T) => number,
  maxPoints: number,
): T[] {
  if (points.length <= maxPoints) return points
  const bucketCount = Math.max(2, Math.floor(maxPoints / 2))
  const out: T[] = []
  const step = points.length / bucketCount

  for (let i = 0; i < bucketCount; i++) {
    const start = Math.floor(i * step)
    const end = i === bucketCount - 1 ? points.length : Math.floor((i + 1) * step)
    const slice = points.slice(start, end)
    if (slice.length === 0) continue
    let minP: T = slice[0]!
    let maxP: T = slice[0]!
    for (const p of slice) {
      if (getVal(p) < getVal(minP)) minP = p
      if (getVal(p) > getVal(maxP)) maxP = p
    }
    if (minP === maxP) {
      out.push(minP)
    } else if (getTime(minP) <= getTime(maxP)) {
      out.push(minP, maxP)
    } else {
      out.push(maxP, minP)
    }
  }

  return out.sort((a, b) => getTime(a) - getTime(b))
}

/** Preserve spikes when downsampling — compute Y domain from full series, render this subset. */
export function downsampleMetricPoints<T extends MetricPointLike>(
  points: T[],
  metric: 'cpu' | 'mem',
  maxPoints = 180,
): T[] {
  return downsampleByBuckets(
    points,
    p => (metric === 'cpu' ? p.cpuMilli : p.memBytes),
    p => pointTsSec(p.ts),
    maxPoints,
  )
}

/** Prefer a full remote series over a short in-app buffer (after restart). */
export function applyRemoteOverviewHistory<T extends HistoryPointLike>(
  server: T[],
  client: T[],
  maxPoints = METRICS_HISTORY_MAX_POINTS,
): T[] {
  return applyRemoteHistoryCore(server, client, overviewAccessors as unknown as SeriesAccessors<T>, maxPoints, true)
}

/** Prefer Prometheus/collector history over the ~1h local poll buffer. */
export function applyRemoteMetricHistory<T extends { ts: number }>(
  server: T[],
  client: T[],
  maxPoints = METRICS_HISTORY_MAX_POINTS,
): T[] {
  return applyRemoteHistoryCore(server, client, metricAccessors as unknown as SeriesAccessors<T>, maxPoints, false)
}

/** Merge collector series with live EventSource samples (overview uses t in ms). */
export function mergeOverviewHistories<T extends HistoryPointLike>(
  server: T[],
  client: T[],
  maxPoints = METRICS_HISTORY_MAX_POINTS,
): T[] {
  return mergeHistoriesCore(server, client, overviewAccessors as unknown as SeriesAccessors<T>, maxPoints, true)
}

export function buildOverviewWindowPoints<T extends HistoryPointLike>(
  history: T[],
  rangeSec: number,
  live: { cpu: number; mem: number },
): T[] {
  return buildWindowPointsCore(history, rangeSec, live, overviewAccessors as unknown as SeriesAccessors<T, typeof live>)
}

export function computeOverviewYDomain(
  values: number[],
  anchorMax?: number,
): { yMin: number; yMax: number } {
  const finite = values.filter(v => Number.isFinite(v) && v >= 0)
  const rawMin = finite.length ? Math.min(...finite) : 0
  const rawMax = finite.length ? Math.max(...finite) : 0

  if (anchorMax != null && anchorMax > 0) {
    return { yMin: 0, yMax: anchorMax }
  }

  const pad = (rawMax - rawMin) * 0.15 || rawMax * 0.1 || 0.001
  return {
    yMin: Math.max(0, rawMin - pad),
    yMax: Math.max(rawMin + pad, rawMax + pad),
  }
}

/** Preserve spikes when downsampling overview cluster charts. */
export function downsampleOverviewPoints<T extends HistoryPointLike>(
  points: T[],
  field: 'cpu' | 'mem',
  maxPoints = 180,
): T[] {
  return downsampleByBuckets(points, p => p[field], p => p.t, maxPoints)
}

/** Hold-last-value fill for overview windows.
 * Never invent samples before the first real point. */
export function densifyOverviewWindowPoints<T extends HistoryPointLike>(
  points: T[],
  rangeSec: number,
): T[] {
  return densifyWindowPointsCore(points, rangeSec, overviewAccessors as unknown as SeriesAccessors<T>)
}
