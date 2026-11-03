import type { NodeInfo } from '../types'
import type { ColDef as SortableColDef } from '../components/SortableTable'
import { HoverTip } from '../components/HoverTip'
import { formatAge } from './formatAge'
import { NodeStatusBadges, nodeStatusSortKey } from './nodeScheduling'
import { NON_CREATABLE_KINDS } from './resourceTemplates'
import { prefsGet } from './persistentStore'

export const RESOURCE_LABELS: Record<string, string> = {
  overview: 'Overview',
  applications: 'Applications',
  namespaces: 'Namespaces',
  nodes: 'Nodes',
  events: 'Events',
  certificatesigningrequests: 'Certificate Signing Requests',
  csidrivers: 'CSI Drivers',
  csinodes: 'CSI Nodes',
  volumeattachments: 'Volume Attachments',
  csistoragecapacities: 'CSI Storage Capacities',
  flowschemas: 'Flow Schemas',
  prioritylevelconfigurations: 'Priority Level Configurations',
  validatingadmissionpolicies: 'Validating Admission Policies',
  validatingadmissionpolicybindings: 'Validating Admission Policy Bindings',
  pods: 'Pods',
  deployments: 'Deployments',
  replicasets: 'Replica Sets',
  replicationcontrollers: 'Replication Controllers',
  daemonsets: 'Daemon Sets',
  statefulsets: 'Stateful Sets',
  jobs: 'Jobs',
  cronjobs: 'Cron Jobs',
  services: 'Services',
  ingresses: 'Ingresses',
  ingressclasses: 'Ingress Classes',
  endpointslices: 'Endpoint Slices',
  endpoints: 'Endpoints',
  networkpolicies: 'Network Policies',
  'network-map': 'Policy Map',
  portforwards: 'Port Forwarding',
  persistentvolumeclaims: 'Persistent Volume Claims',
  persistentvolumes: 'Persistent Volumes',
  storageclasses: 'Storage Classes',
  configmaps: 'Config Maps',
  secrets: 'Secrets',
  resourcequotas: 'Resource Quotas',
  limitranges: 'Limit Ranges',
  horizontalpodautoscalers: 'Horizontal Pod Autoscalers',
  poddisruptionbudgets: 'Pod Disruption Budgets',
  priorityclasses: 'Priority Classes',
  runtimeclasses: 'Runtime Classes',
  leases: 'Leases',
  mutatingwebhookconfigurations: 'Mutating Webhook Configurations',
  validatingwebhookconfigurations: 'Validating Webhook Configurations',
  serviceaccounts: 'Service Accounts',
  clusterroles: 'Cluster Roles',
  roles: 'Roles',
  clusterrolebindings: 'Cluster Role Bindings',
  rolebindings: 'Role Bindings',
  'helm-releases': 'Helm Releases',
  'helm-charts': 'Helm Charts',
}

export { CLUSTER_SCOPED_KINDS } from './resourceKinds'

export const K8S_RESOURCE_KINDS = new Set([
  'namespaces',
  'pods', 'deployments', 'replicasets', 'replicationcontrollers', 'daemonsets', 'statefulsets', 'jobs', 'cronjobs',
  'events',
  'services', 'ingresses', 'endpointslices', 'endpoints', 'ingressclasses', 'networkpolicies',
  'persistentvolumeclaims', 'persistentvolumes', 'storageclasses',
  'volumeattachments', 'csidrivers', 'csinodes', 'csistoragecapacities',
  'configmaps', 'secrets',
  'resourcequotas', 'limitranges', 'horizontalpodautoscalers', 'poddisruptionbudgets',
  'priorityclasses', 'runtimeclasses', 'leases',
  'mutatingwebhookconfigurations', 'validatingwebhookconfigurations',
  'flowschemas', 'prioritylevelconfigurations',
  'validatingadmissionpolicies', 'validatingadmissionpolicybindings',
  'serviceaccounts', 'clusterroles', 'roles', 'clusterrolebindings', 'rolebindings',
  'certificatesigningrequests',
])

export function resolveCreateNamespace(selectedNs: string[] | null, isClusterScoped: boolean): string {
  if (isClusterScoped) return ''
  if (selectedNs && selectedNs.length >= 1) return selectedNs[0]
  return 'default'
}

export function canCreateResource(resource: string, selectedNs: string[] | null, isClusterScoped: boolean): boolean {
  if (!K8S_RESOURCE_KINDS.has(resource)) return false
  if (NON_CREATABLE_KINDS.has(resource)) return false
  if (isClusterScoped) return true
  return selectedNs !== null
}

export const NODE_COLUMNS: SortableColDef<NodeInfo>[] = [
  { key: 'name',         label: 'Name',          mono: true, sortValue: n => n.name,         render: n => n.name },
  { key: 'role',         label: 'Role',                      sortValue: n => n.role,         render: n => <span className="badge role">{n.role}</span> },
  { key: 'status',       label: 'Status',                    sortValue: nodeStatusSortKey, render: n => <NodeStatusBadges n={n} /> },
  { key: 'version',      label: 'Kubelet',        mono: true, sortValue: n => n.version,      render: n => n.version },
  { key: 'internalIP',   label: 'Internal IP',    mono: true, sortValue: n => n.internalIP,   render: n => n.internalIP || '—' },
  { key: 'cpuCap',       label: 'CPU',            mono: true, sortValue: n => n.cpuCap,       render: n => n.cpuCap || '—' },
  { key: 'memCap',       label: 'Memory',         mono: true, sortValue: n => n.memCap,       render: n => n.memCap || '—' },
  { key: 'diskCap',      label: 'Disk',           mono: true, sortValue: n => n.diskAllocBytes, render: n => n.diskAlloc || '—' },
  { key: 'os',           label: 'OS',                         sortValue: n => n.os,           render: n => n.os || '—' },
  { key: 'instanceType', label: 'Instance Type',  mono: true, sortValue: n => n.instanceType, render: n => n.instanceType || '—' },
  { key: 'zone',         label: 'Zone',           mono: true, sortValue: n => n.zone,         render: n => n.zone || '—' },
  {
    key: 'lifecycle',
    label: 'Lifecycle',
    sortValue: n => n.lifecycle || '',
    render: n => n.lifecycle
      ? (
          <span className={`badge lifecycle${n.lifecycle === 'Spot' || n.lifecycle === 'Preemptible' ? ' spot' : ''}`}>
            {n.lifecycle}
          </span>
        )
      : '—',
  },
  { key: 'taints',       label: 'Taints',         mono: true, sortValue: n => n.taints,       render: n => n.taints > 0 ? <HoverTip tip={n.taintsDetail}>{n.taints}</HoverTip> : '—' },
  { key: 'age',          label: 'Age',            mono: true, sortValue: n => n.age,          render: n => <span className="ov-age">{formatAge(Date.now(), n.age)}</span> },
]

export const NODE_COLUMNS_DEFAULT_HIDDEN = new Set(['os', 'instanceType', 'zone', 'lifecycle', 'taints', 'diskCap'])

export interface ColDef { key: string; label: string; mono?: boolean }

export const DEFAULT_HIDDEN: Partial<Record<string, string[]>> = {
  pods:                   ['ip'],
  deployments:            ['images', 'strategy'],
  daemonsets:             ['images'],
  statefulsets:           ['serviceName', 'images'],
  replicasets:            ['images'],
  jobs:                   ['status'],
  cronjobs:               ['lastRun'],
  ingresses:              ['tls'],
  persistentvolumeclaims: ['volume'],
  horizontalpodautoscalers: ['metrics'],
}

export function getInitialHiddenCols(resource: string): Set<string> {
  try {
    const saved = prefsGet(`k8s-col-hidden::${resource}`)
    if (saved !== null) return new Set(JSON.parse(saved) as string[])
  } catch { /* ignore */ }
  return new Set(DEFAULT_HIDDEN[resource] ?? [])
}

export const COLUMNS: Record<string, ColDef[]> = {
  pods: [
    { key: 'namespace',  label: 'Namespace',  mono: true },
    { key: 'status',     label: 'Status' },
    { key: 'restarts',   label: 'Restarts',   mono: true },
    { key: 'containers', label: 'Containers', mono: true },
    { key: 'cpu',        label: 'CPU',        mono: true },
    { key: 'memory',     label: 'Memory',     mono: true },
    { key: 'ip',         label: 'IP',         mono: true },
    { key: 'node',       label: 'Node',       mono: true },
  ],
  deployments: [
    { key: 'namespace', label: 'Namespace',   mono: true },
    { key: 'status',    label: 'Status' },
    { key: 'ready',     label: 'Ready',       mono: true },
    { key: 'upToDate',  label: 'Up-To-Date',  mono: true },
    { key: 'available', label: 'Available',   mono: true },
    { key: 'paused',    label: 'Paused' },
    { key: 'images',    label: 'Images',      mono: true },
    { key: 'strategy',  label: 'Strategy',    mono: true },
  ],
  replicasets: [
    { key: 'namespace', label: 'Namespace', mono: true },
    { key: 'desired',   label: 'Desired',   mono: true },
    { key: 'ready',     label: 'Ready',     mono: true },
    { key: 'available', label: 'Available', mono: true },
    { key: 'images',    label: 'Images',    mono: true },
  ],
  replicationcontrollers: [
    { key: 'namespace', label: 'Namespace', mono: true },
    { key: 'desired',   label: 'Desired',   mono: true },
    { key: 'ready',     label: 'Ready',     mono: true },
    { key: 'available', label: 'Available', mono: true },
  ],
  daemonsets: [
    { key: 'namespace', label: 'Namespace',   mono: true },
    { key: 'desired',   label: 'Desired',     mono: true },
    { key: 'ready',     label: 'Ready',       mono: true },
    { key: 'upToDate',  label: 'Up-To-Date',  mono: true },
    { key: 'available', label: 'Available',   mono: true },
    { key: 'images',    label: 'Images',      mono: true },
  ],
  statefulsets: [
    { key: 'namespace',   label: 'Namespace',    mono: true },
    { key: 'ready',       label: 'Ready',        mono: true },
    { key: 'serviceName', label: 'Service',      mono: true },
    { key: 'images',      label: 'Images',       mono: true },
  ],
  jobs: [
    { key: 'namespace',   label: 'Namespace',   mono: true },
    { key: 'status',      label: 'Status' },
    { key: 'completions', label: 'Completions', mono: true },
    { key: 'duration',    label: 'Duration',    mono: true },
    { key: 'active',      label: 'Active',      mono: true },
  ],
  cronjobs: [
    { key: 'namespace',  label: 'Namespace',  mono: true },
    { key: 'schedule',   label: 'Schedule',   mono: true },
    { key: 'suspended',  label: 'Suspended' },
    { key: 'active',     label: 'Active',     mono: true },
    { key: 'lastRun',    label: 'Last Run',   mono: true },
  ],
  services: [
    { key: 'namespace',   label: 'Namespace',    mono: true },
    { key: 'type',        label: 'Type' },
    { key: 'clusterIP',   label: 'Cluster IP',   mono: true },
    { key: 'externalIP',  label: 'External IP',  mono: true },
    { key: 'ports',       label: 'Ports',        mono: true },
  ],
  ingresses: [
    { key: 'namespace', label: 'Namespace', mono: true },
    { key: 'class',     label: 'Class',     mono: true },
    { key: 'hosts',     label: 'Hosts',     mono: true },
    { key: 'address',   label: 'Address',   mono: true },
    { key: 'tls',       label: 'TLS' },
  ],
  endpointslices: [
    { key: 'namespace',   label: 'Namespace',   mono: true },
    { key: 'addressType', label: 'Addr Type',   mono: true },
    { key: 'endpoints',   label: 'Endpoints',   mono: true },
    { key: 'ports',       label: 'Ports',       mono: true },
  ],
  endpoints: [
    { key: 'namespace', label: 'Namespace', mono: true },
    { key: 'endpoints', label: 'Endpoints', mono: true },
  ],
  ingressclasses: [
    { key: 'controller', label: 'Controller', mono: true },
    { key: 'default',    label: 'Default' },
  ],
  networkpolicies: [
    { key: 'namespace',   label: 'Namespace',    mono: true },
    { key: 'podSelector', label: 'Pod Selector', mono: true },
    { key: 'policyTypes', label: 'Policy Types' },
  ],
  persistentvolumes: [
    { key: 'capacity',      label: 'Capacity',       mono: true },
    { key: 'accessModes',   label: 'Access Modes',   mono: true },
    { key: 'reclaimPolicy', label: 'Reclaim Policy' },
    { key: 'status',        label: 'Status' },
    { key: 'storageClass',  label: 'Storage Class',  mono: true },
    { key: 'claim',         label: 'Claim',          mono: true },
  ],
  storageclasses: [
    { key: 'provisioner',    label: 'Provisioner',    mono: true },
    { key: 'reclaimPolicy',  label: 'Reclaim Policy' },
    { key: 'bindingMode',    label: 'Binding Mode' },
    { key: 'allowExpansion', label: 'Expandable' },
  ],
  persistentvolumeclaims: [
    { key: 'namespace',    label: 'Namespace',     mono: true },
    { key: 'status',       label: 'Status' },
    { key: 'capacity',     label: 'Capacity',      mono: true },
    { key: 'accessMode',   label: 'Access Mode',   mono: true },
    { key: 'storageClass', label: 'Storage Class', mono: true },
    { key: 'volume',       label: 'Volume',        mono: true },
  ],
  configmaps: [
    { key: 'namespace', label: 'Namespace', mono: true },
    { key: 'data',      label: 'Data',      mono: true },
  ],
  secrets: [
    { key: 'namespace', label: 'Namespace', mono: true },
    { key: 'type',      label: 'Type',      mono: true },
    { key: 'data',      label: 'Data',      mono: true },
  ],
  resourcequotas: [
    { key: 'namespace', label: 'Namespace', mono: true },
    { key: 'hard',      label: 'Limits',    mono: true },
    { key: 'used',      label: 'Used',      mono: true },
  ],
  limitranges: [
    { key: 'namespace', label: 'Namespace', mono: true },
    { key: 'limits',    label: 'Rules',     mono: true },
  ],
  horizontalpodautoscalers: [
    { key: 'namespace',   label: 'Namespace', mono: true },
    { key: 'reference',   label: 'Reference', mono: true },
    { key: 'metrics',     label: 'Metrics' },
    { key: 'minReplicas', label: 'Min',       mono: true },
    { key: 'maxReplicas', label: 'Max',       mono: true },
    { key: 'replicas',    label: 'Current',   mono: true },
  ],
  poddisruptionbudgets: [
    { key: 'namespace',          label: 'Namespace',   mono: true },
    { key: 'availability',       label: 'Availability', mono: true },
    { key: 'currentHealthy',     label: 'Healthy',     mono: true },
    { key: 'disruptionsAllowed', label: 'Disruptions', mono: true },
  ],
  priorityclasses: [
    { key: 'value',      label: 'Value',      mono: true },
    { key: 'global',     label: 'Global Default' },
    { key: 'preemption', label: 'Preemption' },
  ],
  runtimeclasses: [
    { key: 'handler', label: 'Handler', mono: true },
  ],
  leases: [
    { key: 'namespace', label: 'Namespace', mono: true },
    { key: 'holder',    label: 'Holder',    mono: true },
    { key: 'duration',  label: 'Duration',  mono: true },
  ],
  mutatingwebhookconfigurations: [
    { key: 'webhooks', label: 'Webhooks', mono: true },
  ],
  validatingwebhookconfigurations: [
    { key: 'webhooks', label: 'Webhooks', mono: true },
  ],
  serviceaccounts: [
    { key: 'namespace',       label: 'Namespace',          mono: true },
    { key: 'secrets',         label: 'Secrets',            mono: true },
    { key: 'imagePullSecret', label: 'Image Pull Secrets', mono: true },
  ],
  clusterroles: [
    { key: 'rules', label: 'Rules', mono: true },
  ],
  roles: [
    { key: 'namespace', label: 'Namespace', mono: true },
    { key: 'rules',     label: 'Rules',     mono: true },
  ],
  clusterrolebindings: [
    { key: 'role',     label: 'Role',     mono: true },
    { key: 'subjects', label: 'Subjects', mono: true },
  ],
  rolebindings: [
    { key: 'namespace', label: 'Namespace', mono: true },
    { key: 'role',      label: 'Role',      mono: true },
    { key: 'subjects',  label: 'Subjects',  mono: true },
  ],
  namespaces: [
    { key: 'status', label: 'Status' },
  ],
  events: [
    { key: 'namespace', label: 'Namespace', mono: true },
    { key: 'type',      label: 'Type' },
    { key: 'reason',    label: 'Reason',    mono: true },
    { key: 'object',    label: 'Object',    mono: true },
    { key: 'message',   label: 'Message' },
    { key: 'count',     label: 'Count',     mono: true },
  ],
  certificatesigningrequests: [
    { key: 'signerName', label: 'Signer',    mono: true },
    { key: 'username',   label: 'User',      mono: true },
    { key: 'condition',  label: 'Condition' },
  ],
  csidrivers: [
    { key: 'attachRequired',  label: 'Attach Required' },
    { key: 'podInfoOnMount',  label: 'Pod Info' },
  ],
  csinodes: [
    { key: 'drivers', label: 'Drivers', mono: true },
  ],
  volumeattachments: [
    { key: 'attacher', label: 'Attacher', mono: true },
    { key: 'nodeName', label: 'Node',     mono: true },
    { key: 'pvName',   label: 'PV',       mono: true },
    { key: 'attached', label: 'Attached' },
  ],
  csistoragecapacities: [
    { key: 'namespace',    label: 'Namespace',     mono: true },
    { key: 'storageClass', label: 'Storage Class', mono: true },
    { key: 'capacity',     label: 'Capacity',      mono: true },
  ],
  flowschemas: [
    { key: 'priorityLevel',         label: 'Priority Level',  mono: true },
    { key: 'matchingPrecedence',    label: 'Precedence',      mono: true },
    { key: 'distinguisherMethod',   label: 'Distinguisher' },
  ],
  prioritylevelconfigurations: [
    { key: 'type', label: 'Type' },
  ],
  validatingadmissionpolicies: [
    { key: 'failurePolicy', label: 'Failure Policy' },
    { key: 'paramKind',     label: 'Param Kind',   mono: true },
  ],
  validatingadmissionpolicybindings: [
    { key: 'policyName',        label: 'Policy',  mono: true },
    { key: 'validationActions', label: 'Actions', mono: true },
  ],
}
