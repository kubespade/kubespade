export function StatCard({ value, label, accent, mono }: {
  value: string; label: string; accent?: 'ok' | 'warn' | 'danger'; mono?: boolean
}) {
  return (
    <div className={`ov-stat-card ${accent ? `ov-stat-${accent}` : ''}`}>
      <div className={`ov-stat-value ${mono ? 'monospace' : ''}`}>{value}</div>
      <div className="ov-stat-label">{label}</div>
    </div>
  )
}
