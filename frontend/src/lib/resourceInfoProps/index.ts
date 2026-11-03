import { type Prop, commonProps, raw, rec } from './helpers'
import {
  cronJobProps,
  daemonSetProps,
  deploymentProps,
  hpaProps,
  jobProps,
  nodeProps,
  podProps,
  replicaSetProps,
  statefulSetProps,
} from './workloads'
import {
  endpointSliceProps,
  endpointsProps,
  ingressClassProps,
  ingressProps,
  networkPolicyProps,
  serviceProps,
} from './network'
import {
  csiDriverProps,
  csiNodeProps,
  pvProps,
  pvcProps,
  storageClassProps,
  volumeAttachmentProps,
} from './storage'
import {
  csrProps,
  leaseProps,
  limitRangeProps,
  namespaceProps,
  pdbProps,
  priorityClassProps,
  rbacBindingProps,
  rbacProps,
  resourceQuotaProps,
  runtimeClassProps,
  serviceAccountProps,
} from './rbacMeta'
import {
  configMapProps,
  eventProps,
  genericSpecProps,
  secretProps,
  webhookConfigProps,
} from './misc'

// ── public re-exports (keep `../lib/resourceInfoProps` API identical) ─────────

export {
  raw,
  arr,
  rec,
  formatPvcMount,
  podTemplateSpec,
  pvcVolumeMap,
  decodeSecretValue,
  secretDataEntries,
  configMapDataEntries,
} from './helpers'
export type { Color, Prop, DataEntry } from './helpers'

// ── main property builder ─────────────────────────────────────────────────────

export function getProperties(kind: string, detail: Record<string, unknown>, nowMs: number): Prop[] {
  const spec   = rec(detail.spec)
  const status = rec(detail.status)
  const common = commonProps(detail, nowMs)

  switch (kind) {
    case 'pods':           return [...common, ...podProps(spec, status, nowMs)]
    case 'deployments':    return [...common, ...deploymentProps(spec, status)]
    case 'statefulsets':   return [...common, ...statefulSetProps(spec, status)]
    case 'daemonsets':     return [...common, ...daemonSetProps(spec, status)]
    case 'replicasets':
    case 'replicationcontrollers': return [...common, ...replicaSetProps(spec, status)]
    case 'jobs':           return [...common, ...jobProps(spec, status)]
    case 'cronjobs':       return [...common, ...cronJobProps(spec, status)]
    case 'services':       return [...common, ...serviceProps(spec, status)]
    case 'ingresses':      return [...common, ...ingressProps(spec)]
    case 'ingressclasses': return [...common, ...ingressClassProps(spec, detail)]
    case 'endpoints':      return [...common, ...endpointsProps(detail)]
    case 'endpointslices': return [...common, ...endpointSliceProps(detail)]
    case 'networkpolicies': return [...common, ...networkPolicyProps(spec)]
    case 'persistentvolumeclaims': return [...common, ...pvcProps(spec, status)]
    case 'persistentvolumes':      return [...common, ...pvProps(spec, status)]
    case 'volumeattachments': return [...common, ...volumeAttachmentProps(spec, status)]
    case 'csidrivers':     return [...common, ...csiDriverProps(spec)]
    case 'csinodes':       return [...common, ...csiNodeProps(spec)]
    case 'nodes':          return [...common, ...nodeProps(spec, status)]
    case 'namespaces':     return [...common, ...namespaceProps(detail)]
    case 'configmaps':     return [...common, ...configMapProps(detail.data, detail.binaryData, detail.immutable)]
    case 'secrets':        return [...common, ...secretProps(raw(detail.type), detail.data, detail.immutable)]
    case 'storageclasses': return [...common, ...storageClassProps(detail)]
    case 'horizontalpodautoscalers': return [...common, ...hpaProps(spec, status)]
    case 'poddisruptionbudgets': return [...common, ...pdbProps(spec, status)]
    case 'resourcequotas': return [...common, ...resourceQuotaProps(spec, status)]
    case 'limitranges':    return [...common, ...limitRangeProps(spec)]
    case 'priorityclasses': return [...common, ...priorityClassProps(detail)]
    case 'runtimeclasses': return [...common, ...runtimeClassProps(spec)]
    case 'leases':         return [...common, ...leaseProps(spec)]
    case 'clusterroles':   return [...common, ...rbacProps(detail, 'Rules')]
    case 'roles':          return [...common, ...rbacProps(detail, 'Rules')]
    case 'clusterrolebindings': return [...common, ...rbacBindingProps(detail)]
    case 'rolebindings':        return [...common, ...rbacBindingProps(detail)]
    case 'serviceaccounts':     return [...common, ...serviceAccountProps(detail)]
    case 'certificatesigningrequests': return [...common, ...csrProps(spec, status)]
    case 'mutatingwebhookconfigurations':
    case 'validatingwebhookconfigurations': return [...common, ...webhookConfigProps(detail)]
    case 'events':         return [...common, ...eventProps(detail)]
    default:               return [...common, ...genericSpecProps(spec)]
  }
}
