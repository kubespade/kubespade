/** Resource kinds shown in the main cluster pane / sidebar. */
export type Resource =
  | 'overview' | 'applications' | 'namespaces' | 'nodes'
  | 'pods' | 'deployments' | 'replicasets' | 'replicationcontrollers' | 'daemonsets' | 'statefulsets' | 'jobs' | 'cronjobs' | 'events'
  | 'services' | 'ingresses' | 'endpointslices' | 'endpoints' | 'ingressclasses' | 'networkpolicies' | 'network-map' | 'portforwards'
  | 'persistentvolumeclaims' | 'persistentvolumes' | 'storageclasses' | 'volumeattachments' | 'csidrivers' | 'csinodes' | 'csistoragecapacities'
  | 'configmaps' | 'secrets'
  | 'resourcequotas' | 'limitranges' | 'horizontalpodautoscalers' | 'poddisruptionbudgets'
  | 'priorityclasses' | 'runtimeclasses' | 'leases'
  | 'mutatingwebhookconfigurations' | 'validatingwebhookconfigurations'
  | 'flowschemas' | 'prioritylevelconfigurations'
  | 'validatingadmissionpolicies' | 'validatingadmissionpolicybindings'
  | 'serviceaccounts' | 'clusterroles' | 'roles' | 'clusterrolebindings' | 'rolebindings' | 'certificatesigningrequests'
  | 'helm-releases' | 'helm-charts'
  | `crd::${string}`

/**
 * Cluster-scoped resource kinds (have no namespace). Single source of truth —
 * import from here instead of redeclaring. Note `nodes` is cluster-scoped too,
 * but is deliberately excluded here: the table/template code treats it via the
 * dedicated Nodes view; the permission layer adds it back explicitly.
 */
export const CLUSTER_SCOPED_KINDS = new Set<string>([
  'namespaces',
  'ingressclasses', 'persistentvolumes', 'storageclasses',
  'priorityclasses', 'runtimeclasses',
  'mutatingwebhookconfigurations', 'validatingwebhookconfigurations',
  'clusterroles', 'clusterrolebindings',
  'certificatesigningrequests',
  'csidrivers', 'csinodes', 'volumeattachments',
  'flowschemas', 'prioritylevelconfigurations',
  'validatingadmissionpolicies', 'validatingadmissionpolicybindings',
])

export function isClusterScopedKind(kind: string): boolean {
  return CLUSTER_SCOPED_KINDS.has(kind)
}
