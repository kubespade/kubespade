import { describe, it, expect } from 'vitest'
import {
  pointTsSec,
  metricsRangesForCollector,
  metricsRangesForLongHistory,
  metricsSourceLabel,
  densifyMaxSecForRange,
  densifyStepSecForRange,
  metricsAxisMidFracs,
  isCollectorEnabledState,
  interpolateAtTime,
  computeMetricsYDomain,
  computeOverviewYDomain,
  downsampleMetricPoints,
  downsampleOverviewPoints,
  appendMetricSample,
  appendHistorySample,
  applyRemoteMetricHistory,
  applyRemoteOverviewHistory,
  mergeMetricHistories,
  mergeOverviewHistories,
  buildMetricWindowPoints,
  buildOverviewWindowPoints,
  densifyMetricWindowPoints,
  densifyOverviewWindowPoints,
  extendMetricPointsToNow,
  extendHistoryPointsToNow,
  METRICS_RANGE_SHORT,
  type MetricPointLike,
  type HistoryPointLike,
} from './metricsRanges'

// ── fully deterministic ────────────────────────────────────────────────────

describe('pointTsSec', () => {
  it('passes through second-scale values', () => {
    expect(pointTsSec(1000)).toBe(1000)
  })
  it('converts ms-scale values (>1e12) to seconds', () => {
    expect(pointTsSec(1_700_000_000_000)).toBe(1_700_000_000)
  })
})

describe('metricsRangesForCollector', () => {
  it('returns only short ranges when collector is off', () => {
    expect(metricsRangesForCollector(false)).toBe(METRICS_RANGE_SHORT)
    expect(metricsRangesForCollector(false).length).toBe(4)
  })
  it('defaults retention to 7 days when unset', () => {
    const labels = metricsRangesForCollector(true, null).map(r => r.label)
    expect(labels).toEqual(['5m', '10m', '30m', '1h', '6h', '24h', '7d'])
  })
  it('caps long ranges by retention (14 days)', () => {
    const labels = metricsRangesForCollector(true, 14).map(r => r.label)
    expect(labels).toEqual(['5m', '10m', '30m', '1h', '6h', '24h', '7d', '14d'])
  })
  it('includes all ranges at 30 day retention', () => {
    expect(metricsRangesForCollector(true, 30).map(r => r.label)).toContain('30d')
    expect(metricsRangesForCollector(true, 30).length).toBe(9)
  })
})

describe('metricsRangesForLongHistory', () => {
  it('unlocks 30d when long history is available', () => {
    expect(metricsRangesForLongHistory(true).map(r => r.label)).toContain('30d')
  })
  it('stays short when long history is off', () => {
    expect(metricsRangesForLongHistory(false)).toBe(METRICS_RANGE_SHORT)
  })
})

describe('metricsSourceLabel', () => {
  it.each([
    ['prometheus', 'Prometheus'],
    ['cluster', 'Collector'],
    ['local', 'Local'],
    ['none', ''],
  ] as const)('%s → %s', (src, label) => {
    expect(metricsSourceLabel(src)).toBe(label)
  })
})

describe('densifyMaxSecForRange / densifyStepSecForRange / metricsAxisMidFracs', () => {
  it('allows densify through 30d windows', () => {
    expect(densifyMaxSecForRange(24 * 3600)).toBe(24 * 3600)
    expect(densifyMaxSecForRange(30 * 86400)).toBe(30 * 86400)
  })
  it('steps grow with range', () => {
    expect(densifyStepSecForRange(300)).toBe(15)
    expect(densifyStepSecForRange(24 * 3600)).toBe(120)
    expect(densifyStepSecForRange(7 * 86400)).toBe(900)
  })
  it('adds mid ticks on longer compact charts', () => {
    expect(metricsAxisMidFracs(300)).toEqual([])
    expect(metricsAxisMidFracs(1800)).toEqual([0.5])
    expect(metricsAxisMidFracs(24 * 3600)).toEqual([0.25, 0.5, 0.75])
  })
})

describe('isCollectorEnabledState', () => {
  it.each(['running', 'pending', 'error'])('true for %s', (s) => {
    expect(isCollectorEnabledState(s)).toBe(true)
  })
  it.each([undefined, 'free', 'stopped', ''])('false for %j', (s) => {
    expect(isCollectorEnabledState(s)).toBe(false)
  })
})

describe('interpolateAtTime', () => {
  it('returns null for empty series', () => {
    expect(interpolateAtTime([], 5)).toBeNull()
  })
  it('returns the sole point for a single-element series', () => {
    expect(interpolateAtTime([{ tMs: 3, value: 7 }], 999)).toEqual({ tMs: 3, value: 7 })
  })
  it('clamps to first point before range', () => {
    const pts = [{ tMs: 10, value: 1 }, { tMs: 20, value: 2 }]
    expect(interpolateAtTime(pts, 5)).toEqual({ tMs: 10, value: 1 })
  })
  it('clamps to last point after range', () => {
    const pts = [{ tMs: 10, value: 1 }, { tMs: 20, value: 2 }]
    expect(interpolateAtTime(pts, 50)).toEqual({ tMs: 20, value: 2 })
  })
  it('linearly interpolates the midpoint', () => {
    const pts = [{ tMs: 0, value: 0 }, { tMs: 10, value: 100 }]
    expect(interpolateAtTime(pts, 5)).toEqual({ tMs: 5, value: 50 })
  })
})

describe('computeMetricsYDomain', () => {
  it('anchors to [0, anchorMax] when anchorMax provided', () => {
    expect(computeMetricsYDomain([1, 2, 3], 'cpu', 10)).toEqual({ yMin: 0, yMax: 10 })
  })
  it('pads and snaps for cpu (snap 0.01)', () => {
    const { yMin, yMax } = computeMetricsYDomain([1, 2], 'cpu')
    expect(yMin).toBeCloseTo(0.85, 5)
    expect(yMax).toBeCloseTo(2.15, 5)
  })
  it('pads and snaps for mem (snap 1)', () => {
    expect(computeMetricsYDomain([100, 200], 'mem')).toEqual({ yMin: 85, yMax: 215 })
  })
  it('falls back to snap-sized domain for empty input', () => {
    expect(computeMetricsYDomain([], 'cpu')).toEqual({ yMin: 0, yMax: 0.01 })
    expect(computeMetricsYDomain([], 'mem')).toEqual({ yMin: 0, yMax: 1 })
  })
  it('ignores negative/non-finite values', () => {
    const { yMin } = computeMetricsYDomain([-5, NaN, 100, 200], 'mem')
    expect(yMin).toBeGreaterThanOrEqual(0)
  })
})

describe('computeOverviewYDomain', () => {
  it('anchors to [0, anchorMax]', () => {
    expect(computeOverviewYDomain([1, 2], 5)).toEqual({ yMin: 0, yMax: 5 })
  })
  it('pads around min/max', () => {
    const { yMin, yMax } = computeOverviewYDomain([1, 2])
    expect(yMin).toBeCloseTo(0.85, 5)
    expect(yMax).toBeCloseTo(2.15, 5)
  })
  it('uses a tiny fallback pad for empty input', () => {
    expect(computeOverviewYDomain([])).toEqual({ yMin: 0, yMax: 0.001 })
  })
})

describe('downsampleMetricPoints', () => {
  const mk = (ts: number, cpuMilli: number): MetricPointLike => ({ ts, cpuMilli, memBytes: cpuMilli })

  it('passes through (same reference) when length <= maxPoints', () => {
    const pts = [mk(1, 1), mk(2, 2)]
    expect(downsampleMetricPoints(pts, 'cpu', 4)).toBe(pts)
  })

  it('preserves spikes (min and max of each bucket) and stays time-ordered', () => {
    const pts = [mk(1, 1), mk(2, 5), mk(3, 2), mk(4, 3), mk(5, 10), mk(6, 4), mk(7, 6), mk(8, 0)]
    const out = downsampleMetricPoints(pts, 'cpu', 2)
    const cpus = out.map(p => p.cpuMilli)
    expect(cpus).toContain(10) // global max spike kept
    expect(cpus).toContain(0)  // global min kept
    const times = out.map(p => p.ts)
    expect([...times].sort((a, b) => a - b)).toEqual(times)
  })
})

describe('downsampleOverviewPoints', () => {
  const mk = (t: number, cpu: number): HistoryPointLike => ({ t, cpu, mem: cpu })
  it('passes through when small', () => {
    const pts = [mk(1, 1)]
    expect(downsampleOverviewPoints(pts, 'cpu', 4)).toBe(pts)
  })
  it('keeps spikes when downsampling', () => {
    const pts = [mk(1, 1), mk(2, 9), mk(3, 2), mk(4, 3), mk(5, 8), mk(6, 0)]
    const cpus = downsampleOverviewPoints(pts, 'cpu', 2).map(p => p.cpu)
    expect(cpus).toContain(9)
    expect(cpus).toContain(0)
  })
})

// ── dedup / append semantics (deterministic on second boundaries) ───────────

describe('appendMetricSample', () => {
  const mk = (ts: number, cpuMilli: number): MetricPointLike => ({ ts, cpuMilli, memBytes: cpuMilli })
  it('replaces the last point within the same second', () => {
    const out = appendMetricSample([mk(100, 1)], mk(100, 9))
    expect(out).toHaveLength(1)
    expect(out[0]!.cpuMilli).toBe(9)
  })
  it('appends when the second differs', () => {
    const out = appendMetricSample([mk(100, 1)], mk(101, 2))
    expect(out).toHaveLength(2)
    expect(out[1]!.cpuMilli).toBe(2)
  })
})

describe('appendHistorySample', () => {
  const mk = (t: number, cpu: number): HistoryPointLike => ({ t, cpu, mem: cpu })
  it('replaces when within 1000ms', () => {
    const out = appendHistorySample([mk(1000, 1)], mk(1500, 9))
    expect(out).toHaveLength(1)
    expect(out[0]!.cpu).toBe(9)
  })
  it('appends when >= 1000ms apart', () => {
    const out = appendHistorySample([mk(1000, 1)], mk(2500, 2))
    expect(out).toHaveLength(2)
  })
})

describe('applyRemoteOverviewHistory', () => {
  it('replaces a short local buffer with a long server series', () => {
    const server = Array.from({ length: 100 }, (_, i) => ({ t: i * 1000, cpu: 1, mem: 2 }))
    const client = [{ t: 99_000, cpu: 9, mem: 9 }]
    const out = applyRemoteOverviewHistory(server, client, 720)
    expect(out.length).toBe(100)
    expect(out[0]!.t).toBe(0)
  })
})

describe('applyRemoteMetricHistory', () => {
  it('replaces a short local buffer with a long server series', () => {
    const server = Array.from({ length: 50 }, (_, i) => ({ ts: i, cpuMilli: 1, memBytes: 2 }))
    const client = [{ ts: 49, cpuMilli: 9, memBytes: 9 }]
    const out = applyRemoteMetricHistory(server, client, 720)
    expect(out.length).toBe(50)
  })
})

describe('mergeMetricHistories', () => {
  const mk = (ts: number, cpuMilli: number): MetricPointLike => ({ ts, cpuMilli, memBytes: cpuMilli })
  it('returns client tail when server empty', () => {
    expect(mergeMetricHistories([], [mk(1, 1)], 10)).toEqual([mk(1, 1)])
  })
  it('returns server tail when client empty', () => {
    expect(mergeMetricHistories([mk(1, 1)], [], 10)).toEqual([mk(1, 1)])
  })
  it('dedups by second and keeps server value for old overlapping samples', () => {
    // seconds far in the past → below recentCutoff, so client must NOT override
    const out = mergeMetricHistories([mk(100, 1)], [mk(100, 9), mk(50, 5)], 10)
    const at100 = out.find(p => p.ts === 100)!
    expect(at100.cpuMilli).toBe(1)
    expect(out.map(p => p.ts)).toEqual([50, 100]) // sorted ascending
  })
})

describe('mergeOverviewHistories', () => {
  const mk = (t: number, cpu: number): HistoryPointLike => ({ t, cpu, mem: cpu })
  it('dedups by second, server wins for old overlaps, sorted output', () => {
    const out = mergeOverviewHistories([mk(100_000, 1)], [mk(100_000, 9), mk(50_000, 5)], 10)
    expect(out.find(p => p.t === 100_000)!.cpu).toBe(1)
    expect(out.map(p => p.t)).toEqual([50_000, 100_000])
  })
})

// ── Date.now()-coupled: assert robust invariants using relative timestamps ────

describe('buildMetricWindowPoints', () => {
  it('returns a single live point when history is empty', () => {
    const out = buildMetricWindowPoints<MetricPointLike>([], 3600, { cpuMilli: 5, memBytes: 6 })
    expect(out).toHaveLength(1)
    expect(out[0]!.cpuMilli).toBe(5)
    expect(out[0]!.memBytes).toBe(6)
  })
  it('appends a live tail after an older in-window sample', () => {
    const nowSec = Math.floor(Date.now() / 1000)
    const hist: MetricPointLike[] = [{ ts: nowSec - 100, cpuMilli: 1, memBytes: 1 }]
    const out = buildMetricWindowPoints(hist, 3600, { cpuMilli: 5, memBytes: 5 })
    expect(out.length).toBeGreaterThanOrEqual(2)
    expect(out[out.length - 1]!.cpuMilli).toBe(5)
  })
  it('seeds short windows from the last pre-window sample', () => {
    const nowSec = Math.floor(Date.now() / 1000)
    const hist: MetricPointLike[] = [{ ts: nowSec - 10_000, cpuMilli: 1, memBytes: 1 }]
    const out = buildMetricWindowPoints(hist, 300, { cpuMilli: 5, memBytes: 5 })
    expect(out[0]!.cpuMilli).toBe(1)
    expect(out[out.length - 1]!.cpuMilli).toBe(5)
  })
})

describe('buildOverviewWindowPoints', () => {
  it('returns a single live point when history is empty', () => {
    const out = buildOverviewWindowPoints<HistoryPointLike>([], 3600, { cpu: 2, mem: 3 })
    expect(out).toHaveLength(1)
    expect(out[0]!.cpu).toBe(2)
  })
  it('appends live tail after older sample', () => {
    const now = Date.now()
    const out = buildOverviewWindowPoints([{ t: now - 100_000, cpu: 1, mem: 1 }], 3600, { cpu: 9, mem: 9 })
    expect(out[out.length - 1]!.cpu).toBe(9)
  })
  it('seeds short windows from the last pre-window sample', () => {
    const now = Date.now()
    const out = buildOverviewWindowPoints(
      [{ t: now - 50 * 60_000, cpu: 4, mem: 8 }],
      300,
      { cpu: 9, mem: 9 },
    )
    expect(out[0]!.cpu).toBe(4)
    expect(out[0]!.mem).toBe(8)
    expect(out[0]!.t).toBeGreaterThanOrEqual(now - 300_000 - 5)
    expect(out[out.length - 1]!.cpu).toBe(9)
  })
})

describe('densifyMetricWindowPoints', () => {
  it('passes through when empty', () => {
    expect(densifyMetricWindowPoints<MetricPointLike>([], 300)).toEqual([])
  })
  it('passes through when range exceeds densify max', () => {
    const pts: MetricPointLike[] = [{ ts: 1, cpuMilli: 1, memBytes: 1 }]
    expect(densifyMetricWindowPoints(pts, 40 * 86400)).toBe(pts)
  })
  it('densifies multi-day windows from first sample only (24h)', () => {
    const nowSec = Math.floor(Date.now() / 1000)
    const first = nowSec - 3600
    const out = densifyMetricWindowPoints(
      [{ ts: first, cpuMilli: 5, memBytes: 6 }],
      24 * 3600,
    )
    expect(out.length).toBeGreaterThan(10)
    expect(Math.min(...out.map(p => pointTsSec(p.ts)))).toBeGreaterThanOrEqual(first - 1)
  })
  it('does not invent samples before the first real point on long ranges', () => {
    const nowSec = Math.floor(Date.now() / 1000)
    const first = nowSec - 3 * 3600
    const out = densifyMetricWindowPoints(
      [{ ts: first, cpuMilli: 42, memBytes: 7 }],
      14 * 86400,
    )
    expect(out.length).toBeGreaterThan(1)
    expect(Math.min(...out.map(p => pointTsSec(p.ts)))).toBeGreaterThanOrEqual(first - 1)
    expect(out.every(p => p.cpuMilli === 42)).toBe(true)
  })
  it('hold-last-value fills forward from the first sample (monotonic, constant held value)', () => {
    const nowSec = Math.floor(Date.now() / 1000)
    const out = densifyMetricWindowPoints([{ ts: nowSec - 120, cpuMilli: 3, memBytes: 4 }], 300)
    expect(out.length).toBeGreaterThan(1)
    expect(out.every(p => p.cpuMilli === 3 && p.memBytes === 4)).toBe(true)
    const times = out.map(p => p.ts)
    expect([...times].sort((a, b) => a - b)).toEqual(times)
  })
})

describe('densifyOverviewWindowPoints', () => {
  it('passes through when empty or range too large', () => {
    expect(densifyOverviewWindowPoints<HistoryPointLike>([], 300)).toEqual([])
    const pts: HistoryPointLike[] = [{ t: 1, cpu: 1, mem: 1 }]
    expect(densifyOverviewWindowPoints(pts, 40 * 86400)).toBe(pts)
  })
  it('hold-last-value fills forward from the first sample', () => {
    const now = Date.now()
    const first = now - 120_000
    const out = densifyOverviewWindowPoints([{ t: first, cpu: 2, mem: 5 }], 300)
    expect(out.length).toBeGreaterThan(1)
    expect(out.every(p => p.cpu === 2 && p.mem === 5)).toBe(true)
    expect(Math.min(...out.map(p => p.t))).toBeGreaterThanOrEqual(first - 1)
  })
  it('does not backfill empty history on long overview ranges', () => {
    const now = Date.now()
    const first = now - 2 * 3600_000
    const out = densifyOverviewWindowPoints([{ t: first, cpu: 9, mem: 1 }], 7 * 86400)
    expect(Math.min(...out.map(p => p.t))).toBeGreaterThanOrEqual(first - 1)
  })
})

describe('extendMetricPointsToNow', () => {
  it('returns input for empty series', () => {
    const pts: MetricPointLike[] = []
    expect(extendMetricPointsToNow(pts)).toBe(pts)
  })
  it('appends a now-anchored copy of the last point when stale', () => {
    const nowSec = Math.floor(Date.now() / 1000)
    const out = extendMetricPointsToNow<MetricPointLike>([{ ts: nowSec - 100, cpuMilli: 7, memBytes: 8 }])
    expect(out).toHaveLength(2)
    expect(out[1]!.cpuMilli).toBe(7)
    expect(out[1]!.memBytes).toBe(8)
  })
})

describe('extendHistoryPointsToNow', () => {
  it('returns input for empty series', () => {
    const pts: HistoryPointLike[] = []
    expect(extendHistoryPointsToNow(pts)).toBe(pts)
  })
  it('appends a now-anchored copy when stale', () => {
    const out = extendHistoryPointsToNow<HistoryPointLike>([{ t: Date.now() - 100_000, cpu: 1, mem: 2 }])
    expect(out).toHaveLength(2)
    expect(out[1]!.cpu).toBe(1)
  })
})
