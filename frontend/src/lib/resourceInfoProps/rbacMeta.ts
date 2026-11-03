import {
  type Prop,
  arr,
  code,
  formatTimestamp,
  formatToleration,
  labels,
  props,
  raw,
  rec,
  row,
  selectorProp,
} from './helpers'

function formatRbacRule(r: Record<string, unknown>): string {
  const verbs = arr(r.verbs).map(String).join(',') || '?'
  const resources = arr(r.resources).map(String).join(',')
  const groups = arr(r.apiGroups).map(g => g === '' ? 'core' : String(g)).join(',')
  const names = arr(r.resourceNames).map(String)
  const urls = arr(r.nonResourceURLs).map(String)
  const target = resources || urls.join(',') || '?'
  let s = `${verbs}  ${target}`
  if (groups) s += `  [${groups}]`
  if (names.length) s += `  names=${names.join(',')}`
  return s
}

export function rbacProps(detail: Record<string, unknown>, kindLabel: string): Prop[] {
  const rules = arr(detail.rules).map(r => formatRbacRule(rec(r)))
  return props(
    row(kindLabel, `${rules.length} rule${rules.length === 1 ? '' : 's'}`),
    rules.length ? code('Rules', rules.join('\n')) : null,
  )
}

export function rbacBindingProps(detail: Record<string, unknown>): Prop[] {
  const roleRef  = rec(detail.roleRef)
  const subjects = arr(detail.subjects).map(s => {
    const r = rec(s)
    const ns = raw(r.namespace)
    return `${raw(r.kind)}/${raw(r.name)}${ns ? ` (${ns})` : ''}`
  })
  return props(
    row('Role', `${raw(roleRef.kind)} / ${raw(roleRef.name)}`),
    raw(roleRef.apiGroup) && raw(roleRef.apiGroup) !== 'rbac.authorization.k8s.io'
      ? row('API Group', raw(roleRef.apiGroup)) : null,
    subjects.length ? code('Subjects', subjects.join('\n')) : row('Subjects', '—'),
  )
}

export function serviceAccountProps(detail: Record<string, unknown>): Prop[] {
  const secrets = arr(detail.secrets).map(s => raw(rec(s).name)).filter(Boolean)
  const pulls = arr(detail.imagePullSecrets).map(s => raw(rec(s).name)).filter(Boolean)
  return props(
    detail.automountServiceAccountToken === false ? row('Automount Token', 'False', 'yellow') : null,
    secrets.length ? row('Secrets', secrets.join(', ')) : null,
    pulls.length ? row('Image Pull Secrets', pulls.join(', ')) : null,
  )
}

export function csrProps(spec: Record<string, unknown>, status: Record<string, unknown>): Prop[] {
  let condition = 'Pending'
  for (const c of arr(status.conditions)) {
    const t = raw(rec(c).type)
    if (t === 'Approved' || t === 'Denied' || t === 'Failed') condition = t
  }
  const issued = !!raw(status.certificate)
  return props(
    row('Signer', raw(spec.signerName) || '—'),
    row('Username', raw(spec.username) || '—'),
    raw(spec.uid) ? row('UID', raw(spec.uid)) : null,
    arr(spec.groups).length ? row('Groups', arr(spec.groups).join(', ')) : null,
    spec.expirationSeconds != null && spec.expirationSeconds !== ''
      ? row('Expiration', `${spec.expirationSeconds}s`) : null,
    row('Condition', condition),
    row('Certificate', issued ? 'Issued' : 'Not issued'),
    arr(spec.usages).length > 0 ? row('Usages', arr(spec.usages).map(u => String(u)).join(', ')) : null,
  )
}

export function namespaceProps(detail: Record<string, unknown>): Prop[] {
  const spec = rec(detail.spec)
  const status = rec(detail.status)
  const phase = raw(status.phase)
  return props(
    row('Status', phase || '—', phase === 'Active' ? 'green' : 'yellow'),
    arr(spec.finalizers).length ? row('Finalizers', arr(spec.finalizers).join(', ')) : null,
  )
}

export function pdbProps(spec: Record<string, unknown>, status: Record<string, unknown>): Prop[] {
  return props(
    spec.minAvailable != null && spec.minAvailable !== '' ? row('Min Available', String(spec.minAvailable)) : null,
    spec.maxUnavailable != null && spec.maxUnavailable !== '' ? row('Max Unavailable', String(spec.maxUnavailable)) : null,
    spec.unhealthyPodEvictionPolicy ? row('Unhealthy Eviction', String(spec.unhealthyPodEvictionPolicy)) : null,
    row('Disruptions Allowed', raw(status.disruptionsAllowed) || '0'),
    row('Healthy', `${raw(status.currentHealthy) || '0'} / ${raw(status.desiredHealthy) || '0'} desired`),
    row('Expected Pods', raw(status.expectedPods) || '0'),
    selectorProp(rec(spec.selector)),
  )
}

export function resourceQuotaProps(spec: Record<string, unknown>, status: Record<string, unknown>): Prop[] {
  const hard = rec(spec.hard) as Record<string, string>
  const used = rec(status.used) as Record<string, string>
  const lines = Object.keys({ ...hard, ...used }).sort().map(k => {
    const u = used[k] ?? '—'
    const h = hard[k] ?? '—'
    return `${k}: ${u} / ${h}`
  })
  const scopes = arr(spec.scopes).map(String)
  return props(
    scopes.length ? row('Scopes', scopes.join(', ')) : null,
    lines.length ? code('Used / Hard', lines.join('\n')) : row('Quota', '—'),
  )
}

export function limitRangeProps(spec: Record<string, unknown>): Prop[] {
  const lines: string[] = []
  for (const item of arr(spec.limits)) {
    const r = rec(item)
    const type = raw(r.type) || '?'
    const bits: string[] = []
    for (const key of ['min', 'max', 'default', 'defaultRequest', 'maxLimitRequestRatio'] as const) {
      const obj = rec(r[key])
      const kv = Object.entries(obj).map(([k, v]) => `${k}=${v}`).join(', ')
      if (kv) bits.push(`${key} ${kv}`)
    }
    lines.push(bits.length ? `${type}: ${bits.join('; ')}` : type)
  }
  return [lines.length ? code('Limits', lines.join('\n')) : row('Limits', '—')]
}

export function priorityClassProps(detail: Record<string, unknown>): Prop[] {
  return props(
    row('Value', raw(detail.value) || '—'),
    detail.globalDefault === true ? row('Global Default', 'True') : null,
    raw(detail.preemptionPolicy) ? row('Preemption', raw(detail.preemptionPolicy)) : null,
    raw(detail.description) ? row('Description', raw(detail.description)) : null,
  )
}

export function runtimeClassProps(spec: Record<string, unknown>): Prop[] {
  const sched = rec(spec.scheduling)
  const nodeSel = rec(sched.nodeSelector) as Record<string, string>
  const tols = arr(sched.tolerations).map(t => formatToleration(rec(t))).filter(Boolean)
  return props(
    row('Handler', raw(spec.runtimeHandler) || raw(spec.handler) || '—'),
    Object.keys(nodeSel).length ? labels('Node Selector', nodeSel) : null,
    tols.length ? code('Tolerations', tols.join('\n')) : null,
  )
}

export function leaseProps(spec: Record<string, unknown>): Prop[] {
  return props(
    row('Holder', raw(spec.holderIdentity) || '—'),
    spec.leaseDurationSeconds != null && spec.leaseDurationSeconds !== ''
      ? row('Duration', `${spec.leaseDurationSeconds}s`) : null,
    spec.leaseTransitions != null && spec.leaseTransitions !== ''
      ? row('Transitions', String(spec.leaseTransitions)) : null,
    raw(spec.acquireTime) ? row('Acquired', formatTimestamp(raw(spec.acquireTime), Date.now())) : null,
    raw(spec.renewTime) ? row('Renewed', formatTimestamp(raw(spec.renewTime), Date.now())) : null,
  )
}
