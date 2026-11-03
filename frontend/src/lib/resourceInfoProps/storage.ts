import {
  type Prop,
  arr,
  code,
  labels,
  props,
  raw,
  rec,
  row,
  selectorProp,
} from './helpers'

export function pvcProps(spec: Record<string, unknown>, status: Record<string, unknown>): Prop[] {
  const accessModes = arr(spec.accessModes).join(', ')
  const storageReq  = raw(rec(rec(spec.resources).requests).storage)
  const storageLim  = raw(rec(rec(spec.resources).limits).storage)
  const capacity    = raw(rec(status.capacity).storage)
  const phase = raw(status.phase)
  const ds = rec(spec.dataSource)
  return props(
    row('Status', phase, phase === 'Bound' ? 'green' : phase === 'Pending' ? 'yellow' : 'red'),
    row('Volume', raw(spec.volumeName) || '—'),
    row('Capacity', capacity || storageReq || '—'),
    storageReq && capacity && storageReq !== capacity ? row('Requested', storageReq) : null,
    storageLim ? row('Limit', storageLim) : null,
    row('Access Modes', accessModes || '—'),
    row('Storage Class', raw(spec.storageClassName) || 'default'),
    selectorProp(rec(spec.selector), 'Selector'),
    raw(ds.name) ? row('Data Source', `${raw(ds.kind) || '—'} / ${raw(ds.name)}`) : null,
  )
}

function pvSource(spec: Record<string, unknown>): string {
  if (spec.csi) return `csi ${raw(rec(spec.csi).driver)} ${raw(rec(spec.csi).volumeHandle)}`.trim()
  if (spec.nfs) return `nfs ${raw(rec(spec.nfs).server)}:${raw(rec(spec.nfs).path)}`
  if (spec.hostPath) return `hostPath ${raw(rec(spec.hostPath).path)}`
  if (spec.local) return `local ${raw(rec(spec.local).path)}`
  if (spec.awsElasticBlockStore) return `awsEBS ${raw(rec(spec.awsElasticBlockStore).volumeID)}`
  if (spec.azureDisk) return `azureDisk ${raw(rec(spec.azureDisk).diskName)}`
  if (spec.gcePersistentDisk) return `gcePD ${raw(rec(spec.gcePersistentDisk).pdName)}`
  for (const k of ['iscsi', 'rbd', 'cephfs', 'fc', 'flexVolume', 'vsphereVolume', 'portworxVolume', 'cinder']) {
    if (spec[k]) return k
  }
  return ''
}

export function pvProps(spec: Record<string, unknown>, status: Record<string, unknown>): Prop[] {
  const accessModes = arr(spec.accessModes).join(', ')
  const capacity    = raw(rec(spec.capacity).storage)
  const phase = raw(status.phase)
  const claimRef = rec(spec.claimRef)
  const src = pvSource(spec)
  const mounts = arr(spec.mountOptions).map(String).join(', ')
  return props(
    row('Status',        phase, phase === 'Bound' ? 'green' : 'yellow'),
    row('Capacity',      capacity || '—'),
    row('Access Modes',  accessModes || '—'),
    row('Volume Mode',   raw(spec.volumeMode) || 'Filesystem'),
    row('Reclaim Policy', raw(spec.persistentVolumeReclaimPolicy) || '—'),
    row('Storage Class', raw(spec.storageClassName) || '—'),
    src ? row('Source', src) : null,
    mounts ? row('Mount Options', mounts) : null,
    raw(claimRef.name) ? row('Claim', `${raw(claimRef.namespace)}/${raw(claimRef.name)}`) : null,
  )
}

export function storageClassProps(detail: Record<string, unknown>): Prop[] {
  const params = rec(detail.parameters) as Record<string, string>
  const mounts = arr(detail.mountOptions).map(String).join(', ')
  return props(
    row('Provisioner',    raw(detail.provisioner)          || '—'),
    row('Reclaim Policy', raw(detail.reclaimPolicy)        || '—'),
    row('Binding Mode',   raw(detail.volumeBindingMode)    || '—'),
    row('Expandable',     detail.allowVolumeExpansion === true ? 'True' : 'False'),
    mounts ? row('Mount Options', mounts) : null,
    Object.keys(params).length > 0 ? labels('Parameters', params) : null,
  )
}

export function volumeAttachmentProps(spec: Record<string, unknown>, status: Record<string, unknown>): Prop[] {
  const src = rec(spec.source)
  return props(
    row('Attacher', raw(spec.attacher) || '—'),
    row('Node', raw(spec.nodeName) || '—'),
    raw(src.persistentVolumeName) ? row('Volume', raw(src.persistentVolumeName)) : null,
    row('Attached', status.attached === true ? 'True' : 'False', status.attached === true ? 'green' : 'yellow'),
  )
}

export function csiDriverProps(spec: Record<string, unknown>): Prop[] {
  return props(
    row('Attach Required', spec.attachRequired === false ? 'False' : 'True'),
    row('Pod Info On Mount', spec.podInfoOnMount === true ? 'True' : 'False'),
    spec.storageCapacity === true ? row('Storage Capacity', 'True') : null,
    raw(spec.fsGroupPolicy) ? row('FSGroup Policy', raw(spec.fsGroupPolicy)) : null,
    arr(spec.volumeLifecycleModes).length ? row('Lifecycle Modes', arr(spec.volumeLifecycleModes).join(', ')) : null,
    arr(spec.tokenRequests).length ? row('Token Requests', String(arr(spec.tokenRequests).length)) : null,
  )
}

export function csiNodeProps(spec: Record<string, unknown>): Prop[] {
  const drivers = arr(spec.drivers).map(d => {
    const r = rec(d)
    return `${raw(r.name)}  nodeID=${raw(r.nodeID)}${arr(r.topologyKeys).length ? ` topology=${arr(r.topologyKeys).join(',')}` : ''}`
  })
  return [drivers.length ? code('Drivers', drivers.join('\n')) : row('Drivers', '—')]
}
