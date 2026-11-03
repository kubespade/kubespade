export interface Profile {
  name: string
  type: string       // "aws" | "kubeconfig" | "gcp" | "azure"
  roleArn: string
  region: string
  clusterName: string
  displayName?: string
  sessionActive: boolean
  connected: boolean
  group?: string
  projectId?: string
  subscriptionId?: string
  resourceGroup?: string
  /** When set, kubeconfig is re-read from this path on every connect (not stored in vault). */
  kubeconfigPath?: string
  /** True when user pasted YAML — never auto-link to local files. */
  kubeconfigEmbedded?: boolean
}

export interface EKSCluster {
  name: string
  endpoint: string
  status: string
  version: string
  arn: string
  location?: string       // GKE / AKS
  resourceGroup?: string  // AKS only
}

export interface NodeInfo {
  name: string
  status: string
  role: string
  version: string
  internalIP: string
  os: string
  instanceType: string
  zone: string
  /** Spot / On-Demand / Preemptible from cloud labels; empty if unknown */
  lifecycle: string
  cpuCap: string
  memCap: string
  cpuAlloc: string
  memAlloc: string
  cpuAllocMilli: number
  memAllocBytes: number
  diskAlloc: string
  diskAllocBytes: number
  unschedulable: boolean
  workloadPods: number
  taints: number
  taintsDetail: string
  age: number
}

export interface EventInfo {
  message: string
  object: string
  reason: string
  type: string
  count: number
  lastTime: number  // Unix seconds
}

export interface ResourceStat {
  usage: number
  requests: number
  limits: number
  allocatable: number
}

export interface ClusterMetrics {
  cpu: ResourceStat
  memory: ResourceStat
  pods: ResourceStat
  hasMetrics: boolean
}

export interface ClusterInfo {
  name: string
  version: string
  nodeCount: number
  readyNodes: number
  nodes: NodeInfo[]
  namespaces: string[]
  events: EventInfo[]
  metrics?: ClusterMetrics
}

export interface Application {
  name: string
  namespace: string
  kind: 'Deployment' | 'StatefulSet'
  readyReplicas: number
  desiredReplicas: number
  age: number
  images: string[]
}

export interface ApplicationList {
  items: Application[]
}

export interface NetworkMapNode {
  id: string
  kind: string
  name: string
  namespace?: string
  labels?: Record<string, string>
  openIngress?: boolean
  openEgress?: boolean
}

export interface NetworkMapEdge {
  id: string
  from: string
  to: string
  dir: 'ingress' | 'egress' | string
  ports?: string
  policy: string
  policyNamespace: string
}

export interface NetworkMap {
  nodes: NetworkMapNode[]
  edges: NetworkMapEdge[]
  policies: number
  workloads: number
  namespace?: string
  note?: string
}

export interface HelmRelease {
  name: string
  namespace: string
  chart: string
  chartVersion: string
  appVersion: string
  status: string
  revision: number
  updated: number // Unix seconds
  description?: string
}

export interface HelmRevision {
  revision: number
  status: string
  chart: string
  chartVersion: string
  appVersion: string
  updated: number
  description?: string
  current: boolean
}

export interface HelmChart {
  name: string
  versions: string[]
  releases: number
  namespaces: string[]
}

export interface PortForwardSession {
  id: string
  profile: string
  namespace: string
  podName: string
  sourceKind: string
  sourceName: string
  localPort: number
  remotePort: number
  containerPort: number
  scheme: string // "http" | "https"
  startedAt: number // Unix seconds
}

export interface CRDVersion {
  name: string
  served: boolean
  storage: boolean
}

export interface CRDInfo {
  name: string    // full CRD name e.g. "certificates.cert-manager.io"
  group: string   // e.g. "cert-manager.io"
  kind: string    // e.g. "Certificate"
  plural: string  // e.g. "certificates"
  scope: string   // "Namespaced" or "Cluster"
  versions: CRDVersion[]
}

export interface CRDGroup {
  group: string
  crds: CRDInfo[]
}

export interface ResourceRow {
  name: string
  namespace?: string
  age: number  // Unix seconds of creation
  fields: Record<string, string>
}

/** Dynamic CRD table column from additionalPrinterColumns (or heuristic fallback). */
export interface ResourceColumn {
  key: string
  label: string
  /** >0 → hidden by default (kubectl-style priority). */
  priority?: number
}

export interface ResourceList {
  kind: string
  items: ResourceRow[]
  columns?: ResourceColumn[]
}
