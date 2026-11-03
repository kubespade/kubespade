import {
  type Prop,
  arr,
  code,
  formatTimestamp,
  props,
  raw,
  rec,
  row,
} from './helpers'

export function configMapProps(data: unknown, binaryData?: unknown, immutable?: unknown): Prop[] {
  const keys = Object.keys(rec(data)).length + Object.keys(rec(binaryData)).length
  return props(
    row('Keys', keys > 0 ? String(keys) : '—'),
    immutable === true ? row('Immutable', 'True') : null,
  )
}

export function secretProps(type_: string, data: unknown, immutable?: unknown): Prop[] {
  const keys = Object.keys(rec(data))
  return props(
    row('Type', type_ || '—'),
    row('Keys', keys.length > 0 ? String(keys.length) : '—'),
    immutable === true ? row('Immutable', 'True') : null,
  )
}

export function webhookConfigProps(detail: Record<string, unknown>): Prop[] {
  const hooks = arr(detail.webhooks).map(w => {
    const r = rec(w)
    const client = rec(r.clientConfig)
    const svc = rec(client.service)
    const dest = raw(client.url) || (raw(svc.name) ? `${raw(svc.namespace)}/${raw(svc.name)}` : '—')
    const rules = arr(r.rules).map(rule => {
      const x = rec(rule)
      return `${arr(x.operations).join('|')} ${arr(x.apiGroups).join(',')}/${arr(x.resources).join(',')}`
    })
    return `${raw(r.name)}\n  ${dest}  fail=${raw(r.failurePolicy) || 'Fail'}\n  ${rules.join('; ') || 'no rules'}`
  })
  return [hooks.length ? code('Webhooks', hooks.join('\n')) : row('Webhooks', '—')]
}

export function eventProps(detail: Record<string, unknown>): Prop[] {
  const involved = rec(detail.involvedObject)
  const src = rec(detail.source)
  return props(
    row('Type', raw(detail.type) || '—', raw(detail.type) === 'Warning' ? 'yellow' : undefined),
    row('Reason', raw(detail.reason) || '—'),
    raw(involved.kind) ? row('Object', `${raw(involved.kind)}/${raw(involved.name)}`) : null,
    raw(involved.namespace) ? row('Object Namespace', raw(involved.namespace)) : null,
    row('Message', raw(detail.message) || '—'),
    detail.count != null ? row('Count', String(detail.count)) : null,
    raw(src.component) || raw(src.host) ? row('Source', [raw(src.component), raw(src.host)].filter(Boolean).join(' ')) : null,
    raw(detail.firstTimestamp) ? row('First', formatTimestamp(raw(detail.firstTimestamp), Date.now())) : null,
    raw(detail.lastTimestamp) ? row('Last', formatTimestamp(raw(detail.lastTimestamp), Date.now())) : null,
  )
}

export function genericSpecProps(spec: Record<string, unknown>): Prop[] {
  const skip = new Set([
    'dnsPolicy', 'terminationGracePeriodSeconds', 'restartPolicy', 'schedulerName',
    'enableServiceLinks', 'shareProcessNamespace', 'automountServiceAccountToken',
    'preemptionPolicy', 'priority', 'hostUsers',
  ])
  const out: Prop[] = []
  for (const [k, v] of Object.entries(spec)) {
    if (skip.has(k)) continue
    if (v == null || v === '') continue
    if (Array.isArray(v) && v.length === 0) continue
    if (typeof v === 'object' && !Array.isArray(v) && Object.keys(rec(v)).length === 0) continue
    let text: string
    if (typeof v === 'object') {
      try {
        const s = JSON.stringify(v, null, 2)
        text = s.length > 8000 ? `${s.slice(0, 8000)}\n…` : s
      } catch {
        text = String(v)
      }
      out.push(code(k, text))
    } else {
      out.push(row(k, String(v)))
    }
  }
  return out
}
