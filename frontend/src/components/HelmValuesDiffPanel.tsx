import { useMemo, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { diffStats, lineDiff, type DiffLine } from '../lib/lineDiff'

interface Props {
  fromVersion: string
  toVersion: string
  fromYaml: string
  toYaml: string
  loading?: boolean
  error?: string
}

export function HelmValuesDiffPanel({
  fromVersion,
  toVersion,
  fromYaml,
  toYaml,
  loading,
  error,
}: Props) {
  const [open, setOpen] = useState(false)

  const lines = useMemo(() => lineDiff(fromYaml, toYaml), [fromYaml, toYaml])
  const stats = useMemo(() => diffStats(lines), [lines])
  const unchanged = !loading && !error && stats.added === 0 && stats.removed === 0

  let summary = ''
  if (loading) summary = 'Loading…'
  else if (error) summary = 'Could not load chart values'
  else if (unchanged) summary = 'No changes in values.yaml'
  else summary = `+${stats.added} / −${stats.removed}`

  return (
    <div className="helm-values-diff">
      <button
        type="button"
        className="helm-values-diff-toggle"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
      >
        <ChevronRight
          size={14}
          className={`helm-values-diff-chevron${open ? ' helm-values-diff-chevron-open' : ''}`}
        />
        <span className="helm-values-diff-title">
          Chart values.yaml
          <em>{fromVersion} → {toVersion}</em>
        </span>
        <span className={`helm-values-diff-summary${error ? ' helm-values-diff-summary-err' : ''}`}>
          {summary}
        </span>
      </button>
      {open && (
        <div className="helm-values-diff-body">
          {loading && <div className="helm-values-diff-msg">Fetching chart defaults…</div>}
          {error && !loading && (
            <div className="helm-values-diff-msg helm-values-diff-msg-err">{error}</div>
          )}
          {!loading && !error && (
            unchanged
              ? (
                <div className="helm-values-diff-msg">
                  values.yaml is identical between these versions.
                </div>
              )
              : <DiffView lines={lines} />
          )}
        </div>
      )}
    </div>
  )
}

function DiffView({ lines }: { lines: DiffLine[] }) {
  const CONTEXT = 2
  const interesting = lines.map((l, i) => (l.kind !== 'equal' ? i : -1)).filter(i => i >= 0)
  if (interesting.length === 0) {
    return <div className="helm-values-diff-msg">No changes.</div>
  }
  const show = new Set<number>()
  for (const i of interesting) {
    for (let k = Math.max(0, i - CONTEXT); k <= Math.min(lines.length - 1, i + CONTEXT); k++) {
      show.add(k)
    }
  }
  const ordered = [...show].sort((a, b) => a - b)
  const display: Array<DiffLine | { kind: 'skip'; count: number }> = []
  let prev = -2
  for (const i of ordered) {
    if (prev >= 0 && i > prev + 1) {
      display.push({ kind: 'skip', count: i - prev - 1 })
    }
    display.push(lines[i])
    prev = i
  }

  return (
    <pre className="helm-values-diff-pre">
      {display.map((row, idx) => {
        if (row.kind === 'skip') {
          return (
            <div key={`s${idx}`} className="helm-values-diff-line helm-values-diff-skip">
              ⋯ {row.count} unchanged line{row.count === 1 ? '' : 's'}
            </div>
          )
        }
        const cls =
          row.kind === 'add' ? 'helm-values-diff-add'
            : row.kind === 'del' ? 'helm-values-diff-del'
              : 'helm-values-diff-eq'
        const mark = row.kind === 'add' ? '+' : row.kind === 'del' ? '−' : ' '
        return (
          <div key={idx} className={`helm-values-diff-line ${cls}`}>
            <span className="helm-values-diff-mark">{mark}</span>
            <span className="helm-values-diff-text">{row.text || ' '}</span>
          </div>
        )
      })}
    </pre>
  )
}
