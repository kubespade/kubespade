function LegendRow({ color, label, value, faint }: {
  color: string; label: string; value: string; faint?: boolean
}) {
  return (
    <div className="ov-legend-row">
      <span className="ov-legend-dot" style={{ background: color, opacity: faint ? 0.4 : 1 }} />
      <span className="ov-legend-label">{label}:</span>
      <span className="ov-legend-value" style={{ opacity: faint ? 0.7 : 1 }}>{value}</span>
    </div>
  )
}

export function DonutCard({ title, usage, requests, limits, allocatable, color, fmt, unit }: {
  title: string
  usage: number
  requests: number
  limits: number
  allocatable: number
  color: string
  fmt: (v: number) => string
  unit: string
}) {
  // Outer ring (r=36): requests  Inner ring (r=24): usage
  const rOuter = 36, rInner = 24, sw = 6
  const circOuter = 2 * Math.PI * rOuter
  const circInner = 2 * Math.PI * rInner
  const reqPct = allocatable > 0 ? Math.min(requests / allocatable, 1) : 0
  const usePct = allocatable > 0 ? Math.min(usage / allocatable, 1) : 0

  return (
    <div className="ov-donut-card">
      <div className="ov-donut-title">{title}</div>
      <svg className="ov-donut-svg" viewBox="0 0 90 90">
        {/* Outer track */}
        <circle cx="45" cy="45" r={rOuter} fill="none" stroke="var(--surface2)" strokeWidth={sw} />
        {/* Requests arc */}
        {reqPct > 0 && (
          <circle cx="45" cy="45" r={rOuter} fill="none"
            stroke={color} strokeWidth={sw} opacity="0.35"
            strokeDasharray={`${reqPct * circOuter} ${circOuter}`}
            strokeLinecap="round" transform="rotate(-90 45 45)" />
        )}
        {/* Inner track */}
        <circle cx="45" cy="45" r={rInner} fill="none" stroke="var(--surface2)" strokeWidth={sw} />
        {/* Usage arc */}
        {usePct > 0 && (
          <circle cx="45" cy="45" r={rInner} fill="none"
            stroke={color} strokeWidth={sw}
            strokeDasharray={`${usePct * circInner} ${circInner}`}
            strokeLinecap="round" transform="rotate(-90 45 45)" />
        )}
        {/* Center */}
        <text x="45" y="42" textAnchor="middle" fill="var(--text)" fontSize="11" fontWeight="700">
          {fmt(usage)}
        </text>
        <text x="45" y="53" textAnchor="middle" fill="var(--muted)" fontSize="8">
          {unit}
        </text>
      </svg>
      <div className="ov-donut-legend">
        <LegendRow color={color} label="Usage"       value={`${fmt(usage)} ${unit}`} />
        {requests > 0 && (
          <LegendRow color={color} label="Requests" value={`${fmt(requests)} ${unit}`} faint />
        )}
        {limits > 0 && (
          <LegendRow color="var(--muted)" label="Limits" value={`${fmt(limits)} ${unit}`} />
        )}
        <LegendRow color="var(--border)" label="Allocatable" value={`${fmt(allocatable)} ${unit}`} />
        <div className="ov-donut-pct">{(usePct * 100).toFixed(1)}%</div>
      </div>
    </div>
  )
}
