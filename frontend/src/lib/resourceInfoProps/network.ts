import {
  type Prop,
  arr,
  code,
  formatSelectorText,
  labels,
  props,
  raw,
  rec,
  row,
  selectorProp,
} from './helpers'

export function serviceProps(spec: Record<string, unknown>, status: Record<string, unknown>): Prop[] {
  const ports = arr(spec.ports).map(p => {
    const port = rec(p)
    const name = raw(port.name)
    const tp = raw(port.targetPort) || raw(port.port)
    const proto = raw(port.protocol) || 'TCP'
    const np = raw(port.nodePort)
    return `${name ? `${name}: ` : ''}${raw(port.port)}→${tp}/${proto}${np ? ` node ${np}` : ''}`
  }).join('\n')

  const extIPs = arr(spec.externalIPs).join(', ')
  const clusterIPs = arr(spec.clusterIPs).map(String).join(', ')
  const lbIngress = arr(rec(status.loadBalancer).ingress).map(i => {
    const r = rec(i)
    return raw(r.ip) || raw(r.hostname)
  }).filter(Boolean).join(', ')

  return props(
    row('Type',       raw(spec.type)      || '—'),
    row('Cluster IP', raw(spec.clusterIP) || '—'),
    clusterIPs && clusterIPs !== raw(spec.clusterIP) ? row('Cluster IPs', clusterIPs) : null,
    arr(spec.ipFamilies).length > 1 || (arr(spec.ipFamilies).length === 1 && raw(arr(spec.ipFamilies)[0]) !== 'IPv4')
      ? row('IP Families', arr(spec.ipFamilies).join(', ')) : null,
    extIPs ? row('External IPs', extIPs) : null,
    raw(spec.externalName) ? row('External Name', raw(spec.externalName)) : null,
    raw(spec.loadBalancerIP) ? row('Load Balancer IP', raw(spec.loadBalancerIP)) : null,
    lbIngress ? row('LB Ingress', lbIngress) : null,
    raw(spec.loadBalancerClass) ? row('LB Class', raw(spec.loadBalancerClass)) : null,
    ports ? code('Ports', ports) : null,
    raw(spec.sessionAffinity) && raw(spec.sessionAffinity) !== 'None'
      ? row('Session Affinity', raw(spec.sessionAffinity)) : null,
    raw(spec.externalTrafficPolicy) && raw(spec.externalTrafficPolicy) !== 'Cluster'
      ? row('External Traffic', raw(spec.externalTrafficPolicy)) : null,
    raw(spec.internalTrafficPolicy) && raw(spec.internalTrafficPolicy) !== 'Cluster'
      ? row('Internal Traffic', raw(spec.internalTrafficPolicy)) : null,
    spec.publishNotReadyAddresses === true ? row('Publish Not Ready', 'True') : null,
    spec.allocateLoadBalancerNodePorts === false ? row('Allocate Node Ports', 'False') : null,
    Object.keys(rec(spec.selector)).length > 0 ? labels('Selector', rec(spec.selector) as Record<string, string>) : null,
  )
}

function formatIngressBackend(backend: Record<string, unknown>): string {
  const svc = rec(backend.service)
  const port = rec(svc.port)
  const portS = raw(port.number) || raw(port.name)
  if (raw(svc.name)) return `${raw(svc.name)}:${portS || '?'}`
  const res = rec(backend.resource)
  if (raw(res.kind) || raw(res.name)) return `${raw(res.kind)}/${raw(res.name)}`
  return ''
}

export function ingressProps(spec: Record<string, unknown>): Prop[] {
  const cls = raw(spec.ingressClassName) || '—'
  const rules: string[] = []
  for (const r of arr(spec.rules)) {
    const rule = rec(r)
    const host = raw(rule.host) || '*'
    const paths = arr(rec(rule.http).paths).map(p => {
      const pr = rec(p)
      const path = raw(pr.path) || '/'
      const ptype = raw(pr.pathType)
      const dest = formatIngressBackend(rec(pr.backend))
      return `  ${path}${ptype ? ` (${ptype})` : ''}${dest ? ` → ${dest}` : ''}`
    })
    rules.push(paths.length ? `${host}\n${paths.join('\n')}` : host)
  }
  const tls = arr(spec.tls).map(t => {
    const tr = rec(t)
    const hosts = arr(tr.hosts).join(', ') || '*'
    return `${hosts} (${raw(tr.secretName) || 'no secret'})`
  })
  const def = formatIngressBackend(rec(spec.defaultBackend))
  return props(
    row('Class', cls),
    rules.length ? code('Rules', rules.join('\n')) : null,
    tls.length ? code('TLS', tls.join('\n')) : null,
    def ? row('Default Backend', def) : null,
  )
}

export function ingressClassProps(spec: Record<string, unknown>, detail: Record<string, unknown>): Prop[] {
  const params = rec(spec.parameters)
  return props(
    row('Controller', raw(spec.controller) || '—'),
    raw(params.kind) || raw(params.name)
      ? row('Parameters', `${raw(params.apiGroup) ? raw(params.apiGroup) + '/' : ''}${raw(params.kind)}/${raw(params.name)}`)
      : null,
    rec(detail.metadata).annotations && String(rec(rec(detail.metadata).annotations)['ingressclass.kubernetes.io/is-default-class']) === 'true'
      ? row('Default', 'True') : null,
  )
}

export function endpointsProps(detail: Record<string, unknown>): Prop[] {
  const lines: string[] = []
  for (const sub of arr(detail.subsets)) {
    const s = rec(sub)
    const addrs = arr(s.addresses).map(a => raw(rec(a).ip)).filter(Boolean)
    const notReady = arr(s.notReadyAddresses).map(a => raw(rec(a).ip)).filter(Boolean)
    const ports = arr(s.ports).map(p => {
      const r = rec(p)
      return `${raw(r.name) ? raw(r.name) + ':' : ''}${raw(r.port)}/${raw(r.protocol) || 'TCP'}`
    })
    if (addrs.length) lines.push(`${addrs.join(', ')}  ${ports.join(', ')}`)
    if (notReady.length) lines.push(`not ready: ${notReady.join(', ')}  ${ports.join(', ')}`)
  }
  return [lines.length ? code('Subsets', lines.join('\n')) : row('Endpoints', '—')]
}

export function endpointSliceProps(detail: Record<string, unknown>): Prop[] {
  const addressType = raw(detail.addressType)
  const ports = arr(detail.ports).map(p => {
    const r = rec(p)
    return `${raw(r.name) ? raw(r.name) + ':' : ''}${raw(r.port)}/${raw(r.protocol) || 'TCP'}`
  })
  const eps = arr(detail.endpoints).map(e => {
    const r = rec(e)
    const addrs = arr(r.addresses).join(', ')
    const ready = rec(r.conditions).ready === false ? ' not-ready' : ''
    const node = raw(r.nodeName)
    return `${addrs}${node ? ` @${node}` : ''}${ready}`
  })
  return props(
    row('Address Type', addressType || '—'),
    ports.length ? row('Ports', ports.join(', ')) : null,
    eps.length ? code('Endpoints', eps.join('\n')) : row('Endpoints', '—'),
  )
}

function formatNetPeer(p: Record<string, unknown>): string {
  const bits: string[] = []
  const pod = rec(p.podSelector)
  const ns = rec(p.namespaceSelector)
  const ip = rec(p.ipBlock)
  const podT = formatSelectorText(pod)
  const nsT = formatSelectorText(ns)
  if (podT) bits.push(`pod ${podT}`)
  if (nsT) bits.push(`ns ${nsT}`)
  if (raw(ip.cidr)) {
    const except = arr(ip.except).map(String).join(',')
    bits.push(`cidr ${raw(ip.cidr)}${except ? ` except ${except}` : ''}`)
  }
  return bits.join(', ') || '*'
}

function formatNetRule(rule: Record<string, unknown>, peerKey: string): string {
  const ports = arr(rule.ports).map(p => {
    const r = rec(p)
    const proto = raw(r.protocol) || 'TCP'
    const port = raw(r.port) || 'all'
    const end = raw(r.endPort)
    return end ? `${proto}/${port}-${end}` : `${proto}/${port}`
  })
  const peers = arr(rule[peerKey]).map(x => formatNetPeer(rec(x)))
  const portS = ports.length ? ports.join(',') : 'all ports'
  const peerS = peers.length ? peers.join('; ') : '*'
  return `${portS} ← ${peerS}`
}

export function networkPolicyProps(spec: Record<string, unknown>): Prop[] {
  const types = arr(spec.policyTypes).map(String)
  const ingress = arr(spec.ingress).map(r => formatNetRule(rec(r), 'from'))
  const egress = arr(spec.egress).map(r => formatNetRule(rec(r), 'to'))
  return props(
    types.length ? row('Policy Types', types.join(', ')) : null,
    selectorProp(rec(spec.podSelector), 'Pod Selector') || row('Pod Selector', '*'),
    ingress.length ? code('Ingress', ingress.join('\n')) : (types.includes('Ingress') || types.length === 0 ? row('Ingress', 'deny all') : null),
    egress.length ? code('Egress', egress.join('\n')) : (types.includes('Egress') ? row('Egress', 'deny all') : null),
  )
}
