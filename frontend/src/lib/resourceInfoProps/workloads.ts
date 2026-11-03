import {
  type Color,
  type Prop,
  arr,
  chips,
  code,
  formatNodeAffinity,
  formatPodAffinityBlock,
  formatTimestamp,
  formatToleration,
  labels,
  podStatusColor,
  props,
  raw,
  rec,
  row,
  selectorProp,
} from './helpers'

function podSpecExtras(spec: Record<string, unknown>): Prop[] {
  const out: Prop[] = []
  if (spec.hostNetwork === true) out.push(row('Host Network', 'True', 'yellow'))
  return out
}

const DEFAULT_TOLERATION_KEYS = new Set([
  'node.kubernetes.io/not-ready',
  'node.kubernetes.io/unreachable',
  'node.kubernetes.io/disk-pressure',
  'node.kubernetes.io/memory-pressure',
  'node.kubernetes.io/pid-pressure',
  'node.kubernetes.io/unschedulable',
  'node.kubernetes.io/network-unavailable',
])

function podSchedulingProps(spec: Record<string, unknown>): Prop[] {
  const out: Prop[] = []
  const nodeSelector = rec(spec.nodeSelector)
  if (Object.keys(nodeSelector).length > 0) {
    out.push(labels('Node Selector', nodeSelector as Record<string, string>))
  }

  const affinity = rec(spec.affinity)
  const affinityText = formatNodeAffinity(affinity)
  if (affinityText) out.push(code('Node Affinity', affinityText))
  const podAff = formatPodAffinityBlock(rec(affinity.podAffinity), 'Pod Affinity')
  if (podAff) out.push(code('Pod Affinity', podAff))
  const podAnti = formatPodAffinityBlock(rec(affinity.podAntiAffinity), 'Pod Anti-Affinity')
  if (podAnti) out.push(code('Pod Anti-Affinity', podAnti))

  const tolerations = arr(spec.tolerations)
    .map(t => rec(t))
    .filter(t => !DEFAULT_TOLERATION_KEYS.has(raw(t.key)))
    .map(t => formatToleration(t))
    .filter(Boolean)
  if (tolerations.length > 0) {
    out.push(code('Tolerations', tolerations.join('\n')))
  }

  return out
}

export function podProps(spec: Record<string, unknown>, status: Record<string, unknown>, nowMs: number): Prop[] {
  const phase = raw(status.phase)
  const conditions = arr(status.conditions).map(c => ({
    text: raw(rec(c).type),
    color: rec(c).status === 'True' ? ('green' as Color) : ('muted' as Color),
  })).filter(c => c.text)

  const startTime = raw(status.startTime)
  const podIPs = arr(status.podIPs).map(p => raw(rec(p).ip)).filter(Boolean).join(', ')

  return props(
    row('Status', phase || '—', podStatusColor(phase)),
    row('Node', raw(spec.nodeName) || '—'),
    row('Pod IP', raw(status.podIP) || '—'),
    podIPs && podIPs !== raw(status.podIP) ? row('Pod IPs', podIPs) : null,
    row('Service Account', raw(spec.serviceAccountName) || 'default'),
    row('QoS Class', raw(status.qosClass) || '—'),
    raw(spec.priorityClassName) ? row('Priority Class', raw(spec.priorityClassName)) : null,
    startTime ? row('Started', formatTimestamp(startTime, nowMs)) : null,
    conditions.length > 0 ? chips('Conditions', conditions) : null,
    ...podSchedulingProps(spec),
    ...podSpecExtras(spec),
  )
}

function rollingUpdateText(strategy: Record<string, unknown>): string {
  const type = raw(strategy.type) || 'RollingUpdate'
  const ru = rec(strategy.rollingUpdate)
  const surge = raw(ru.maxSurge)
  const unavail = raw(ru.maxUnavailable)
  if (!surge && !unavail) return type
  const bits = [type]
  if (surge) bits.push(`maxSurge ${surge}`)
  if (unavail) bits.push(`maxUnavailable ${unavail}`)
  return bits.join(', ')
}

export function deploymentProps(spec: Record<string, unknown>, status: Record<string, unknown>): Prop[] {
  const desired = raw(spec.replicas) || '1'
  const ready   = raw(status.readyReplicas)   || '0'
  const updated = raw(status.updatedReplicas) || '0'
  const avail   = raw(status.availableReplicas) || '0'
  return props(
    row('Replicas', `${ready} ready / ${desired} desired`),
    row('Updated', updated),
    row('Available', avail),
    row('Strategy', rollingUpdateText(rec(spec.strategy))),
    spec.minReadySeconds != null && spec.minReadySeconds !== '' && Number(spec.minReadySeconds) !== 0
      ? row('Min Ready Seconds', String(spec.minReadySeconds)) : null,
    spec.revisionHistoryLimit != null && spec.revisionHistoryLimit !== '' && Number(spec.revisionHistoryLimit) !== 10
      ? row('Revision History', String(spec.revisionHistoryLimit)) : null,
    spec.progressDeadlineSeconds != null && spec.progressDeadlineSeconds !== '' && Number(spec.progressDeadlineSeconds) !== 600
      ? row('Progress Deadline', `${spec.progressDeadlineSeconds}s`) : null,
    spec.paused === true ? row('Paused', 'True', 'yellow') : null,
    selectorProp(rec(spec.selector)),
  )
}

export function statefulSetProps(spec: Record<string, unknown>, status: Record<string, unknown>): Prop[] {
  const desired  = raw(spec.replicas) || '1'
  const ready    = raw(status.readyReplicas)   || '0'
  const updated  = raw(status.updatedReplicas) || '0'
  const claims = arr(spec.volumeClaimTemplates).map(c => raw(rec(rec(c).metadata).name)).filter(Boolean)
  const ust = rec(spec.updateStrategy)
  return props(
    row('Replicas', `${ready} ready / ${desired} desired`),
    row('Updated', updated),
    row('Service', raw(spec.serviceName) || '—'),
    raw(spec.podManagementPolicy) && raw(spec.podManagementPolicy) !== 'OrderedReady'
      ? row('Pod Management', raw(spec.podManagementPolicy)) : null,
    raw(ust.type) ? row('Update Strategy', raw(ust.type)) : null,
    claims.length ? row('Volume Claims', claims.join(', ')) : null,
    selectorProp(rec(spec.selector)),
  )
}

export function daemonSetProps(spec: Record<string, unknown>, status: Record<string, unknown>): Prop[] {
  return props(
    row('Desired',   raw(status.desiredNumberScheduled) || '0'),
    row('Ready',     raw(status.numberReady)            || '0'),
    row('Available', raw(status.numberAvailable)        || '0'),
    row('Up-To-Date', raw(status.updatedNumberScheduled) || '0'),
    row('Strategy', rollingUpdateText(rec(spec.updateStrategy))),
    selectorProp(rec(spec.selector)),
  )
}

export function replicaSetProps(spec: Record<string, unknown>, status: Record<string, unknown>): Prop[] {
  const sel = rec(spec.selector)
  const selector = ('matchLabels' in sel || 'matchExpressions' in sel)
    ? selectorProp(sel)
    : (Object.keys(sel).length > 0 ? labels('Selector', sel as Record<string, string>) : null)
  return props(
    row('Replicas', `${raw(status.readyReplicas) || '0'} ready / ${raw(spec.replicas) || '1'} desired`),
    row('Available', raw(status.availableReplicas) || '0'),
    selector,
  )
}

export function jobProps(spec: Record<string, unknown>, status: Record<string, unknown>): Prop[] {
  return props(
    row('Completions', `${raw(status.succeeded) || '0'} / ${raw(spec.completions) || '1'}`),
    spec.parallelism != null && spec.parallelism !== '' ? row('Parallelism', String(spec.parallelism)) : null,
    spec.backoffLimit != null && spec.backoffLimit !== '' ? row('Backoff Limit', String(spec.backoffLimit)) : null,
    spec.activeDeadlineSeconds != null && spec.activeDeadlineSeconds !== ''
      ? row('Active Deadline', `${spec.activeDeadlineSeconds}s`) : null,
    spec.ttlSecondsAfterFinished != null && spec.ttlSecondsAfterFinished !== ''
      ? row('TTL After Finished', `${spec.ttlSecondsAfterFinished}s`) : null,
    raw(spec.completionMode) ? row('Completion Mode', raw(spec.completionMode)) : null,
    spec.suspend === true ? row('Suspended', 'True', 'yellow') : null,
    row('Active',  raw(status.active)  || '0'),
    row('Failed',  raw(status.failed)  || '0'),
    raw(status.startTime)      ? row('Started',   formatTimestamp(raw(status.startTime), Date.now())) : null,
    raw(status.completionTime) ? row('Completed', formatTimestamp(raw(status.completionTime), Date.now())) : null,
    selectorProp(rec(spec.selector)),
  )
}

export function cronJobProps(spec: Record<string, unknown>, status: Record<string, unknown>): Prop[] {
  return props(
    row('Schedule',      raw(spec.schedule) || '—'),
    raw(spec.timeZone) ? row('Time Zone', raw(spec.timeZone)) : null,
    row('Suspended',     spec.suspend === true ? 'True' : 'False', spec.suspend === true ? 'yellow' : undefined),
    raw(spec.concurrencyPolicy) ? row('Concurrency', raw(spec.concurrencyPolicy)) : null,
    spec.startingDeadlineSeconds != null && spec.startingDeadlineSeconds !== ''
      ? row('Starting Deadline', `${spec.startingDeadlineSeconds}s`) : null,
    spec.successfulJobsHistoryLimit != null && spec.successfulJobsHistoryLimit !== ''
      ? row('Success History', String(spec.successfulJobsHistoryLimit)) : null,
    spec.failedJobsHistoryLimit != null && spec.failedJobsHistoryLimit !== ''
      ? row('Failed History', String(spec.failedJobsHistoryLimit)) : null,
    row('Active Jobs',   String(arr(status.active).length)),
    raw(status.lastScheduleTime) ? row('Last Schedule', formatTimestamp(raw(status.lastScheduleTime), Date.now())) : null,
    raw(status.lastSuccessfulTime) ? row('Last Success', formatTimestamp(raw(status.lastSuccessfulTime), Date.now())) : null,
  )
}

export function nodeProps(spec: Record<string, unknown>, status: Record<string, unknown>): Prop[] {
  const info = rec(status.nodeInfo)
  const capacity = rec(status.capacity)
  const allocatable = rec(status.allocatable)
  const conditions = arr(status.conditions)
    .filter(c => raw(rec(c).status) === 'True')
    .map(c => ({ text: raw(rec(c).type), color: raw(rec(c).type) === 'Ready' ? ('green' as Color) : ('yellow' as Color) }))
  const taints = arr(spec.taints).map(t => {
    const r = rec(t)
    const k = raw(r.key)
    const v = raw(r.value)
    const e = raw(r.effect)
    return v ? `${k}=${v}:${e}` : `${k}:${e}`
  })
  const addrs = arr(status.addresses).map(a => {
    const r = rec(a)
    return `${raw(r.type)} ${raw(r.address)}`
  }).filter(a => !a.endsWith(' '))

  return props(
    row('OS Image',    raw(info.osImage)            || '—'),
    !raw(info.osImage) && raw(info.operatingSystem) ? row('OS', raw(info.operatingSystem)) : null,
    row('Architecture', raw(info.architecture)      || '—'),
    row('Kernel',      raw(info.kernelVersion)       || '—'),
    row('Container Runtime', raw(info.containerRuntimeVersion) || '—'),
    row('Kubelet',     raw(info.kubeletVersion)      || '—'),
    raw(info.kubeProxyVersion) ? row('Kube-Proxy', raw(info.kubeProxyVersion)) : null,
    addrs.length ? code('Addresses', addrs.join('\n')) : null,
    raw(spec.providerID) ? row('Provider ID', raw(spec.providerID)) : null,
    raw(spec.podCIDR) ? row('Pod CIDR', raw(spec.podCIDR)) : null,
    arr(spec.podCIDRs).length > 1 ? row('Pod CIDRs', arr(spec.podCIDRs).join(', ')) : null,
    row('CPU Allocatable', raw(allocatable.cpu) || raw(capacity.cpu) || '—'),
    raw(capacity.cpu) && raw(allocatable.cpu) && raw(capacity.cpu) !== raw(allocatable.cpu)
      ? row('CPU Capacity', raw(capacity.cpu)) : null,
    row('Memory Allocatable', raw(allocatable.memory) || raw(capacity.memory) || '—'),
    row('Pods Allocatable',   raw(allocatable.pods)  || raw(capacity.pods)   || '—'),
    spec.unschedulable === true ? row('Scheduling', 'Cordoned', 'yellow') : null,
    taints.length > 0 ? code('Taints', taints.join('\n')) : null,
    conditions.length > 0 ? chips('Conditions', conditions) : null,
  )
}

// ── HorizontalPodAutoscaler ───────────────────────────────────────────────────

function hpaTargetValue(target: Record<string, unknown>): string {
  const t = raw(target.type).toLowerCase()
  if (t === 'utilization') {
    const u = raw(target.averageUtilization)
    return u ? `${u}%` : '—'
  }
  if (t === 'averagevalue') return raw(target.averageValue) || '—'
  if (t === 'value') return raw(target.value) || raw(target.targetValue) || '—'
  return raw(target.averageUtilization) || raw(target.averageValue) || raw(target.value) || '—'
}

function hpaCurrentValue(current: Record<string, unknown>): string {
  const u = raw(current.averageUtilization)
  const avg = raw(current.averageValue)
  const v = raw(current.value)
  if (u && avg) return `${u}% (${avg})`
  if (u) return `${u}%`
  return avg || v || '—'
}

function hpaMetricName(m: Record<string, unknown>): string {
  const type = raw(m.type)
  if (type === 'Resource') return raw(rec(m.resource).name) || 'resource'
  if (type === 'ContainerResource') {
    const cr = rec(m.containerResource)
    const n = raw(cr.name) || 'resource'
    const c = raw(cr.container)
    return c ? `${n} (${c})` : n
  }
  if (type === 'Pods') return raw(rec(rec(m.pods).metric).name) || 'pods'
  if (type === 'Object') {
    const obj = rec(m.object)
    const n = raw(rec(obj.metric).name) || 'object'
    const desc = rec(obj.describedObject)
    const ref = raw(desc.kind) && raw(desc.name) ? ` ${raw(desc.kind)}/${raw(desc.name)}` : ''
    return `${n}${ref}`
  }
  if (type === 'External') return raw(rec(rec(m.external).metric).name) || 'external'
  return type || 'metric'
}

function hpaMetricTarget(m: Record<string, unknown>): string {
  const type = raw(m.type)
  if (type === 'Resource') return hpaTargetValue(rec(rec(m.resource).target))
  if (type === 'ContainerResource') return hpaTargetValue(rec(rec(m.containerResource).target))
  if (type === 'Pods') return hpaTargetValue(rec(rec(m.pods).target))
  if (type === 'Object') return hpaTargetValue(rec(rec(m.object).target))
  if (type === 'External') return hpaTargetValue(rec(rec(m.external).target))
  return '—'
}

function hpaMetricCurrent(m: Record<string, unknown>): string {
  const type = raw(m.type)
  if (type === 'Resource') return hpaCurrentValue(rec(rec(m.resource).current))
  if (type === 'ContainerResource') return hpaCurrentValue(rec(rec(m.containerResource).current))
  if (type === 'Pods') return hpaCurrentValue(rec(rec(m.pods).current))
  if (type === 'Object') return hpaCurrentValue(rec(rec(m.object).current))
  if (type === 'External') return hpaCurrentValue(rec(rec(m.external).current))
  return '—'
}

function hpaMetricKey(m: Record<string, unknown>): string {
  return `${raw(m.type)}:${hpaMetricName(m)}`
}

export function hpaProps(spec: Record<string, unknown>, status: Record<string, unknown>): Prop[] {
  const ref = rec(spec.scaleTargetRef)
  const metrics = arr(spec.metrics)
  const currentMetrics = arr(status.currentMetrics)
  const currentByKey = new Map<string, Record<string, unknown>>()
  for (const c of currentMetrics) {
    const cm = rec(c)
    currentByKey.set(hpaMetricKey(cm), cm)
  }

  const metricChips: Array<{ text: string; color?: Color }> = []
  for (const rawM of metrics) {
    const m = rec(rawM)
    const name = hpaMetricName(m)
    const target = hpaMetricTarget(m)
    const cur = currentByKey.get(hpaMetricKey(m))
    const current = cur ? hpaMetricCurrent(cur) : '—'
    const type = raw(m.type)
    const prefix = type && type !== 'Resource' ? `${type} ` : ''
    metricChips.push({ text: `${prefix}${name}: ${current} / ${target}` })
  }
  // Status-only metrics (rare) not listed in spec
  for (const rawC of currentMetrics) {
    const c = rec(rawC)
    const key = hpaMetricKey(c)
    if (metrics.some(m => hpaMetricKey(rec(m)) === key)) continue
    metricChips.push({ text: `${hpaMetricName(c)}: ${hpaMetricCurrent(c)}`, color: 'muted' })
  }

  return [
    row('Target', `${raw(ref.kind)} / ${raw(ref.name)}`),
    row('Min Replicas', raw(spec.minReplicas) || '1'),
    row('Max Replicas', raw(spec.maxReplicas) || '—'),
    row('Current Replicas', raw(status.currentReplicas) || '0'),
    row('Desired Replicas', raw(status.desiredReplicas) || '0'),
    metricChips.length > 0
      ? chips('Metrics', metricChips, true)
      : row('Metrics', '—', 'muted'),
  ]
}
