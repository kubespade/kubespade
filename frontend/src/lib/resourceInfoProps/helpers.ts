import { formatAge } from '../formatAge'

// ── tiny helpers ──────────────────────────────────────────────────────────────

export function raw(v: unknown): string { return v == null ? '' : String(v) }
export function arr(v: unknown): unknown[] { return Array.isArray(v) ? v : [] }
export function rec(v: unknown): Record<string, unknown> {
  return (v && typeof v === 'object' && !Array.isArray(v)) ? v as Record<string, unknown> : {}
}

export function formatTimestamp(ts: string, nowMs: number): string {
  const d = new Date(ts)
  if (isNaN(d.getTime())) return ts
  const age = formatAge(nowMs, d.getTime() / 1000)
  return `${age} ago  (${d.toLocaleString()})`
}

// ── property row types ────────────────────────────────────────────────────────

export type Color = 'green' | 'yellow' | 'red' | 'muted' | undefined

export type Prop =
  | { t: 'row';    label: string; text: string;  color?: Color }
  | { t: 'code';   label: string; text: string }
  | { t: 'labels'; label: string; items: Record<string, string> }
  | { t: 'chips';  label: string; items: Array<{ text: string; color?: Color }>; stack?: boolean }

export function row(label: string, text: string, color?: Color): Prop   { return { t: 'row', label, text, color } }
export function code(label: string, text: string): Prop                  { return { t: 'code', label, text } }
export function chips(label: string, items: Array<{ text: string; color?: Color }>, stack = false): Prop {
  return { t: 'chips', label, items, stack }
}
export function labels(label: string, items: Record<string, string>): Prop { return { t: 'labels', label, items } }

/** Build a Prop list from a mix of entries, dropping falsy ones. Single cast lives here. */
export function props(...items: Array<Prop | false | null | undefined>): Prop[] {
  return items.filter(Boolean) as Prop[]
}

// ── status color helpers ──────────────────────────────────────────────────────

export function podStatusColor(phase: string): Color {
  const p = phase.toLowerCase()
  if (p === 'running' || p === 'succeeded') return 'green'
  if (p === 'failed' || p === 'crashloopbackoff' || p === 'oomkilled') return 'red'
  if (p === 'pending' || p === 'containercreating') return 'yellow'
  return undefined
}

// ── NOISY_ANNOTATIONS ────────────────────────────────────────────────────────

const NOISY = new Set([
  'kubectl.kubernetes.io/last-applied-configuration',
  'deployment.kubernetes.io/revision',
  'deprecated.daemonset.template.generation',
  'pv.kubernetes.io/bind-completed',
  'pv.kubernetes.io/bound-by-controller',
  'volume.beta.kubernetes.io/storage-provisioner',
  'volume.kubernetes.io/storage-provisioner',
  'volume.kubernetes.io/selected-node',
])

// ── common metadata rows ──────────────────────────────────────────────────────

export function commonProps(detail: Record<string, unknown>, nowMs: number): Prop[] {
  const meta = rec(detail.metadata)
  const result: Prop[] = []

  if (raw(meta.creationTimestamp))
    result.push(row('Created', formatTimestamp(raw(meta.creationTimestamp), nowMs)))

  if (raw(meta.name)) result.push(row('Name', raw(meta.name)))
  if (raw(meta.namespace)) result.push(row('Namespace', raw(meta.namespace)))

  const lbls = rec(meta.labels)
  if (Object.keys(lbls).length > 0)
    result.push(labels('Labels', lbls as Record<string, string>))

  const annots = rec(meta.annotations)
  const filteredAnnots = Object.fromEntries(
    Object.entries(annots).filter(([k]) => !NOISY.has(k))
  ) as Record<string, string>
  if (Object.keys(filteredAnnots).length > 0)
    result.push(labels('Annotations', filteredAnnots))

  const owners = arr(meta.ownerReferences)
  if (owners.length > 0) {
    const owner = rec(owners[0])
    result.push(row('Controlled By', `${raw(owner.kind)} / ${raw(owner.name)}`))
  }

  return result
}

// ── scheduling / selector formatting helpers ──────────────────────────────────

export function formatToleration(t: Record<string, unknown>): string {
  const key = raw(t.key)
  const op = raw(t.operator) || (raw(t.value) ? 'Equal' : 'exists')
  const val = raw(t.value)
  const effect = raw(t.effect)
  const seconds = t.tolerationSeconds
  let s = key
    ? (op.toLowerCase() === 'exists' ? `${key} Exists` : `${key}=${val || ''}`)
    : (op.toLowerCase() === 'exists' ? 'Exists (any key)' : '—')
  if (effect) s += `:${effect}`
  if (seconds != null && seconds !== '') s += ` for ${seconds}s`
  return s
}

function formatNodeSelectorRequirement(ex: Record<string, unknown>): string {
  const key = raw(ex.key)
  const op = raw(ex.operator)
  const values = arr(ex.values).map(v => String(v)).join(', ')
  if (!key && !op) return ''
  if (op === 'Exists' || op === 'DoesNotExist') return `${key} ${op}`
  return `${key} ${op} [${values}]`
}

/** NodeSelectorTerm: matchExpressions (labels) and/or matchFields (e.g. DaemonSet → metadata.name). */
function formatNodeSelectorTerm(term: Record<string, unknown>): string[] {
  const lines: string[] = []
  for (const ex of arr(term.matchExpressions)) {
    const s = formatNodeSelectorRequirement(rec(ex))
    if (s) lines.push(s)
  }
  for (const ex of arr(term.matchFields)) {
    const s = formatNodeSelectorRequirement(rec(ex))
    if (s) lines.push(s)
  }
  const ml = rec(term.matchLabels)
  for (const [k, v] of Object.entries(ml)) {
    lines.push(`${k}=${v}`)
  }
  return lines
}

export function formatNodeAffinity(affinity: Record<string, unknown>): string {
  const node = rec(affinity.nodeAffinity)
  if (Object.keys(node).length === 0) return ''
  const lines: string[] = []

  const required = rec(node.requiredDuringSchedulingIgnoredDuringExecution)
  const reqTerms = arr(required.nodeSelectorTerms)
  if (reqTerms.length > 0) {
    lines.push('Required:')
    for (const term of reqTerms) {
      const exprs = formatNodeSelectorTerm(rec(term))
      if (exprs.length === 0) lines.push('  (empty term)')
      else lines.push(...exprs.map(l => `  ${l}`))
    }
  }

  const preferred = arr(node.preferredDuringSchedulingIgnoredDuringExecution)
  if (preferred.length > 0) {
    lines.push('Preferred:')
    for (const pref of preferred) {
      const p = rec(pref)
      const weight = raw(p.weight) || '?'
      const exprs = formatNodeSelectorTerm(rec(p.preference))
      lines.push(`  weight=${weight}`)
      lines.push(...(exprs.length ? exprs.map(l => `    ${l}`) : ['    (empty)']))
    }
  }

  return lines.join('\n')
}

export function formatSelectorText(sel: Record<string, unknown>): string {
  const parts: string[] = []
  const ml = rec(sel.matchLabels)
  for (const [k, v] of Object.entries(ml)) parts.push(`${k}=${v}`)
  for (const ex of arr(sel.matchExpressions)) {
    const s = formatNodeSelectorRequirement(rec(ex))
    if (s) parts.push(s)
  }
  return parts.join(', ')
}

export function selectorProp(sel: Record<string, unknown>, label = 'Selector'): Prop | null {
  const ml = rec(sel.matchLabels)
  const me = arr(sel.matchExpressions)
  if (Object.keys(ml).length > 0 && me.length === 0) return labels(label, ml as Record<string, string>)
  const text = formatSelectorText(sel)
  return text ? code(label, text) : null
}

function formatPodAffinityTerm(term: Record<string, unknown>): string {
  const sel = formatSelectorText(rec(term.labelSelector)) || '*'
  const topology = raw(term.topologyKey) || '?'
  const ns = arr(term.namespaces).map(String).join(',')
  return `${sel} topology=${topology}${ns ? ` ns=${ns}` : ''}`
}

export function formatPodAffinityBlock(block: Record<string, unknown>, title: string): string {
  if (Object.keys(block).length === 0) return ''
  const lines: string[] = [title]
  const required = arr(block.requiredDuringSchedulingIgnoredDuringExecution)
  if (required.length > 0) {
    lines.push('  Required:')
    for (const t of required) lines.push(`    ${formatPodAffinityTerm(rec(t))}`)
  }
  const preferred = arr(block.preferredDuringSchedulingIgnoredDuringExecution)
  if (preferred.length > 0) {
    lines.push('  Preferred:')
    for (const p of preferred) {
      const pr = rec(p)
      lines.push(`    weight=${raw(pr.weight) || '?'}`)
      lines.push(`      ${formatPodAffinityTerm(rec(pr.podAffinityTerm))}`)
    }
  }
  return lines.length > 1 ? lines.join('\n') : ''
}

// ── pod template / volume helpers ─────────────────────────────────────────────

export function formatPvcMount(m: Record<string, unknown>, claim: string): string {
  const sub = raw(m.subPath)
  return `${claim} → ${raw(m.mountPath)}${sub ? ` [${sub}]` : ''}${m.readOnly === true ? ' (ro)' : ''}`
}

export function podTemplateSpec(kind: string, spec: Record<string, unknown>): Record<string, unknown> | null {
  if (kind === 'pods') return spec
  if (kind === 'cronjobs') return rec(rec(rec(rec(spec.jobTemplate).spec).template).spec)
  if (
    kind === 'deployments' || kind === 'replicasets' || kind === 'daemonsets' ||
    kind === 'statefulsets' || kind === 'jobs' || kind === 'replicationcontrollers'
  ) {
    return rec(rec(spec.template).spec)
  }
  return null
}

export function pvcVolumeMap(spec: Record<string, unknown>): Map<string, string> {
  const names = new Map<string, string>()
  for (const v of arr(spec.volumes)) {
    const r = rec(v)
    const claim = raw(rec(r.persistentVolumeClaim).claimName)
    const name = raw(r.name)
    if (claim && name) names.set(name, claim)
  }
  return names
}

// ── secret / configmap data helpers ───────────────────────────────────────────

export function decodeSecretValue(b64: string): { text: string; binary: boolean } {
  try {
    const bin = atob(b64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return { text, binary: false }
  } catch {
    return { text: b64, binary: true }
  }
}

export type DataEntry = { key: string; text: string; binary: boolean }

export function secretDataEntries(data: Record<string, unknown>): DataEntry[] {
  return Object.entries(data).map(([key, b64]) => {
    const { text, binary } = decodeSecretValue(String(b64))
    return { key, text, binary }
  })
}

export function configMapDataEntries(data: Record<string, unknown>, binaryData: Record<string, unknown>): DataEntry[] {
  const entries: DataEntry[] = Object.entries(data).map(([key, v]) => ({
    key, text: String(v ?? ''), binary: false,
  }))
  for (const [key, b64] of Object.entries(binaryData)) {
    if (entries.some(e => e.key === key)) continue
    const { text, binary } = decodeSecretValue(String(b64))
    entries.push({ key, text, binary })
  }
  return entries
}
