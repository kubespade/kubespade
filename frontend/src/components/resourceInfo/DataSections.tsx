import { useState } from 'react'
import { Check, ChevronDown, ChevronRight, Copy, Eye, EyeOff } from 'lucide-react'
import type { NodePodSummary, ResourceEvent } from '../../api/client'
import { formatAge } from '../../lib/formatAge'
import {
  configMapDataEntries,
  secretDataEntries,
  type DataEntry,
  type Prop,
} from '../../lib/resourceInfoProps'

export function KeyValueDataSection({ entries, masked = false }: {
  entries: DataEntry[]
  masked?: boolean
}) {
  const sorted = [...entries].sort((a, b) => a.key.localeCompare(b.key))
  const [revealed, setRevealed] = useState<Set<string>>(new Set())
  const [copiedKey, setCopiedKey] = useState<string | null>(null)

  async function copyText(key: string, text: string) {
    await navigator.clipboard.writeText(text)
    setCopiedKey(key)
    setTimeout(() => setCopiedKey(null), 1500)
  }

  async function copyAll() {
    const lines = sorted.map(e => `${e.key}=${e.text}`)
    await copyText('__all__', lines.join('\n'))
  }

  function toggleReveal(key: string) {
    setRevealed(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  if (sorted.length === 0) return <div className="ip-empty">No data</div>

  return (
    <div className="ip-secret-data">
      {sorted.length > 1 && (
        <div className="ip-secret-toolbar">
          <div className="ip-header-actions">
            <button
              type="button"
              className="ip-btn"
              onClick={copyAll}
              data-tooltip={copiedKey === '__all__' ? 'Copied!' : 'Copy all'}
            >
              {copiedKey === '__all__' ? <Check size={12} /> : <Copy size={12} />}
            </button>
          </div>
        </div>
      )}
      {sorted.map(({ key, text, binary }) => {
        const isRevealed = !masked || revealed.has(key)
        const display = isRevealed
          ? text
          : '•'.repeat(Math.min(Math.max(text.length, 8), 24))
        return (
          <div key={key} className="ip-secret-row">
            <div className="ip-secret-row-head">
              <span className="ip-secret-key">{key}</span>
              {binary && <span className="ip-secret-tag">binary</span>}
            </div>
            <div className="ip-secret-val-wrap">
              <div className="ip-prop-field ip-prop-scroll">
                <pre className={`ip-secret-val${isRevealed ? '' : ' ip-secret-val-masked'}`}>{display}</pre>
              </div>
              <div className="ip-secret-val-actions">
                {masked && (
                  <button
                    type="button"
                    className="ip-btn"
                    onClick={() => toggleReveal(key)}
                    data-tooltip={isRevealed ? 'Hide value' : 'Show value'}
                  >
                    {isRevealed ? <EyeOff size={12} /> : <Eye size={12} />}
                  </button>
                )}
                <button
                  type="button"
                  className="ip-btn"
                  onClick={() => copyText(key, text)}
                  data-tooltip={copiedKey === key ? 'Copied!' : 'Copy value'}
                >
                  {copiedKey === key ? <Check size={12} /> : <Copy size={12} />}
                </button>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function SecretDataSection({ data }: { data: Record<string, unknown> }) {
  return <KeyValueDataSection entries={secretDataEntries(data)} masked />
}

export function ConfigMapDataSection({ data, binaryData }: {
  data: Record<string, unknown>
  binaryData: Record<string, unknown>
}) {
  return <KeyValueDataSection entries={configMapDataEntries(data, binaryData)} />
}

// ── Section ───────────────────────────────────────────────────────────────────

export function Section({
  title, defaultOpen = true, count, children,
}: { title: string; defaultOpen?: boolean; count?: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="ip-section">
      <button className="ip-section-hdr" onClick={() => setOpen(o => !o)}>
        {open ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        <span className="ip-section-title">{title}</span>
        {count !== undefined && <span className="ip-section-count">{count}</span>}
      </button>
      {open && <div className="ip-section-body">{children}</div>}
    </div>
  )
}

// ── Property table ────────────────────────────────────────────────────────────

const COLOR_CLASS: Record<string, string> = {
  green: 'ip-val-green', yellow: 'ip-val-yellow', red: 'ip-val-red', muted: 'ip-val-muted',
}

export function PropField({ children }: { children: React.ReactNode }) {
  return <div className="ip-prop-field ip-prop-scroll">{children}</div>
}

export function PropTable({ props }: { props: Prop[] }) {
  return (
    <div className="ip-prop-table">
      {props.map((p, i) => {
        if (p.t === 'row') return (
          <div key={i} className="ip-prop-row ip-prop-row-top">
            <span className="ip-prop-label">{p.label}</span>
            <PropField>
              <span className={`ip-prop-value ${p.color ? COLOR_CLASS[p.color] : ''}`}>{p.text}</span>
            </PropField>
          </div>
        )
        if (p.t === 'code') return (
          <div key={i} className="ip-prop-row ip-prop-row-top">
            <span className="ip-prop-label">{p.label}</span>
            <PropField>
              <span className="ip-prop-value ip-prop-code">{p.text}</span>
            </PropField>
          </div>
        )
        if (p.t === 'labels') return (
          <div key={i} className="ip-prop-row ip-prop-row-top">
            <span className="ip-prop-label">{p.label}</span>
            <PropField>
              <div className="ip-prop-chips">
                {Object.entries(p.items).map(([k, v]) => (
                  <span key={k} className="ip-chip ip-chip-label">{k}={v}</span>
                ))}
              </div>
            </PropField>
          </div>
        )
        if (p.t === 'chips') return (
          <div key={i} className="ip-prop-row ip-prop-row-top">
            <span className="ip-prop-label">{p.label}</span>
            <PropField>
              <div className={`ip-prop-chips${p.stack ? ' ip-prop-chips-stack' : ''}`}>
                {p.items.map((item, j) => (
                  <span key={j} className={`ip-chip ${item.color ? `ip-chip-${item.color}` : ''}`}>{item.text}</span>
                ))}
              </div>
            </PropField>
          </div>
        )
        return null
      })}
    </div>
  )
}

// ── Pod metrics header ────────────────────────────────────────────────────────

export function EventsList({ events, now }: { events: ResourceEvent[]; now: number }) {
  if (events.length === 0) return <div className="ip-empty">No events</div>
  return (
    <div className="ip-events">
      {events.map((ev, i) => (
        <div key={i} className={`ip-event ip-event-${ev.type.toLowerCase()}`}>
          <div className="ip-event-top">
            <span className={`badge ${ev.type === 'Warning' ? 'res-status-warn' : 'res-status-default'}`}>
              {ev.type}
            </span>
            <span className="ip-event-reason">{ev.reason}</span>
            <span className="ip-event-age">{formatAge(now, ev.age)}</span>
            {ev.count > 1 && <span className="ip-event-count">×{ev.count}</span>}
          </div>
          <div className="ip-event-msg ip-prop-scroll">{ev.message}</div>
        </div>
      ))}
    </div>
  )
}

// ── Containers section ────────────────────────────────────────────────────────

export function podPhaseClass(phase: string): string {
  const p = phase.toLowerCase()
  if (p === 'running') return 'res-status-running'
  if (p === 'pending') return 'res-status-pending'
  if (p === 'failed') return 'res-status-failed'
  if (p === 'succeeded') return 'res-status-succeeded'
  return 'res-status-default'
}

export function NodePodsList({ pods }: { pods: NodePodSummary[] | null }) {
  if (pods === null) return <div className="ip-empty">Loading…</div>
  if (pods.length === 0) return <div className="ip-empty">No pods</div>
  return (
    <div className="ip-node-pods">
      {pods.map(p => (
        <div key={`${p.namespace}/${p.name}`} className="ip-node-pod-row">
          <div className="ip-node-pod-name-wrap ip-prop-scroll">
            <span className="ip-node-pod-name">{p.namespace}/{p.name}</span>
          </div>
          <div className="ip-node-pod-meta">
            {p.ownerKind ? <span className="ip-node-pod-owner">{p.ownerKind}</span> : null}
            <span className={`badge ${podPhaseClass(p.phase)}`}>{p.phase || 'Unknown'}</span>
          </div>
        </div>
      ))}
    </div>
  )
}
