import type { AccessCheck } from '../lib/k8sPermissions'
import type { ApplicationList, ClusterInfo, CRDGroup, EKSCluster, HelmChart, HelmRelease, HelmRevision, NetworkMap, PortForwardSession, Profile, ResourceList } from '../types'
import { authHeaders } from './token'

export { withAccessToken } from './token'

export interface ResourceEvent {
  type: string
  reason: string
  message: string
  count: number
  age: number
}

/** kubectl-style delete flags (grace / cascade / force). */
export interface DeleteResourceOpts {
  force?: boolean
  gracePeriod?: number
  propagation?: 'Foreground' | 'Background' | 'Orphan'
}

export interface ContainerMetric {
  name: string
  cpu: string
  memory: string
  cpuMilli: number
  memBytes: number
}

export interface PodMetrics {
  containers: ContainerMetric[]
}

export interface PodMetricsSummary {
  cpuMilli: number
  memBytes: number
}

export interface NodeMetricsSummary {
  cpuMilli: number
  memBytes: number
  diskUsedBytes?: number
  diskCapBytes?: number
}

export interface RolloutRevision {
  revision: number
  name: string
  replicas: number
  changeCause: string
  current: boolean
  age: number
  images: string
}

export interface NodeTaint {
  key: string
  value: string
  effect: string
}

export interface NodePodSummary {
  namespace: string
  name: string
  phase: string
  ownerKind?: string
}

export interface MetricPoint {
  ts: number
  cpuMilli: number
  memBytes: number
}

export type MetricsHistorySource = 'prometheus' | 'cluster' | 'local' | 'none'

export interface PrometheusRef {
  namespace: string
  name: string
  port: string
  score?: number
  healthy?: boolean
}

export interface MetricsSourceSettings {
  source: string
  prometheusNamespace?: string
  prometheusService?: string
  prometheusPort?: string
  prometheusURL?: string
  hasBearer?: boolean
  discovered?: PrometheusRef[]
  selected?: PrometheusRef | null
  resolvedExternalURL?: string
}

function normalizeMetricsHistorySource(source?: string): MetricsHistorySource {
  if (source === 'prometheus' || source === 'cluster' || source === 'local' || source === 'none') {
    return source
  }
  return 'none'
}

export class NeedsMFAError extends Error {
  constructor(msg?: string) { super(msg ?? 'MFA required') }
}

export class NeedsExecConfirmError extends Error {
  execCommands: string[]
  constructor(commands: string[], msg?: string) {
    super(msg ?? 'Exec plugin confirmation required')
    this.execCommands = commands
  }
}

export class NeedsInsecureTLSError extends Error {
  server: string
  constructor(server: string, msg?: string) {
    super(msg ?? 'Insecure TLS confirmation required')
    this.server = server
  }
}

function profileFromPath(path: string): string | null {
  const m = path.match(/\/api\/profiles\/([^/?]+)/)
  return m ? decodeURIComponent(m[1]!) : null
}

let mfaInFlight: Promise<void> | null = null

/** True when the caller is expected to collect MFA and pass mfaToken itself. */
function isConnectTimeMfa(path: string, body?: unknown): boolean {
  if (/\/clusters(\?|$)/.test(path) && !/[?&]mfaToken=/.test(path)) return true
  if (/\/auth(\?|$)/.test(path)) {
    const tok = body && typeof body === 'object' ? (body as { mfaToken?: string }).mfaToken : ''
    return !tok
  }
  return false
}

/** Prompt for MFA and seed the AWS credential cache (works before k8s connect). */
async function satisfyMfa(profile: string): Promise<void> {
  if (!mfaInFlight) {
    mfaInFlight = (async () => {
      const { promptMfa, isInvalidMfaMessage } = await import('../lib/mfaPrompt')
      let message = 'Enter MFA code to continue:'
      for (;;) {
        const code = await promptMfa(message)
        if (!code) throw new NeedsMFAError('MFA cancelled')
        const seed = await fetch(
          `${profilePath(profile)}/session`,
          {
            method: 'POST',
            headers: authHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ mfaToken: code }),
          },
        )
        const body = await seed.json().catch(() => ({})) as { needsMFA?: boolean; error?: string; message?: string }
        if (seed.ok) return
        const errMsg = body.error ?? body.message ?? 'MFA failed'
        if ((seed.status === 401 && body.needsMFA) || isInvalidMfaMessage(errMsg)) {
          message = 'Invalid MFA code — try again:'
          continue
        }
        throw new Error(errMsg)
      }
    })().finally(() => { mfaInFlight = null })
  }
  await mfaInFlight
}

async function request<T>(method: string, path: string, body?: unknown, retried = false): Promise<T> {
  const headers = authHeaders(body ? { 'Content-Type': 'application/json' } : undefined)
  const res = await fetch(path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({})) as Record<string, unknown>
  if (res.status === 401 && data.needsMFA) {
    if (retried) throw new NeedsMFAError(typeof data.message === 'string' ? data.message : undefined)
    // Connect overlay / Manage page collect MFA and pass it on the next call.
    if (isConnectTimeMfa(path, body)) throw new NeedsMFAError(typeof data.message === 'string' ? data.message : undefined)
    const profile = profileFromPath(path)
    if (!profile) throw new NeedsMFAError(typeof data.message === 'string' ? data.message : undefined)
    await satisfyMfa(profile)
    return request<T>(method, path, body, true)
  }
  if (res.status === 403 && data.needsExecConfirm) {
    const cmds = Array.isArray(data.execCommands) ? data.execCommands.map(String) : []
    throw new NeedsExecConfirmError(cmds, typeof data.error === 'string' ? data.error : undefined)
  }
  if (res.status === 403 && data.needsInsecureTLS) {
    throw new NeedsInsecureTLSError(
      typeof data.server === 'string' ? data.server : '',
      typeof data.error === 'string' ? data.error : undefined,
    )
  }
  if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Request failed')
  return data as T
}

/** Authenticated fetch for non-JSON / custom-header endpoints (YAML, DELETE, etc.). */
async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(path, {
    ...init,
    headers: authHeaders(init?.headers),
  })
}

/** `/api/profiles/{profile}` + optional suffix (`/k8s/...`). Encodes profile once. */
function profilePath(profile: string, suffix = ''): string {
  const base = '/api/profiles/' + encodeURIComponent(profile)
  if (!suffix) return base
  return suffix.startsWith('/') || suffix.startsWith('?') ? base + suffix : `${base}/${suffix}`
}

async function apiFetchJson<T>(path: string, init?: RequestInit, fallback = 'Request failed'): Promise<T> {
  const res = await apiFetch(path, init)
  const data = await res.json().catch(() => ({})) as T & { error?: string }
  if (!res.ok) throw new Error((data as { error?: string }).error ?? fallback)
  return data as T
}

async function apiFetchText(path: string, init?: RequestInit, fallback = 'Request failed'): Promise<string> {
  const res = await apiFetch(path, init)
  if (!res.ok) {
    const d = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(d.error ?? fallback)
  }
  return res.text()
}

async function apiFetchOk(path: string, init?: RequestInit, fallback = 'Request failed'): Promise<void> {
  const res = await apiFetch(path, init)
  if (!res.ok) {
    const d = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(d.error ?? fallback)
  }
}

export interface AddAWSProfileParams {
  type: 'aws'
  /** Opaque id; omitted → server generates UUID. */
  name?: string
  accessKeyId: string
  secretAccessKey: string
  region: string
  roleArn?: string
}

export interface AddKubeconfigProfileParams {
  type: 'kubeconfig'
  /** Opaque id; omitted → server generates UUID. */
  name?: string
  kubeconfigData?: string    // raw YAML (manual upload / paste)
  kubeconfigPath?: string    // server-side file path (e.g. ~/.kube/config)
  kubeconfigContext?: string // pin to a specific context
  kubeconfigEmbedded?: boolean // true = pasted YAML, never live-link
}

export interface KubeContextEntry {
  contextName: string
  clusterName: string
  displayName?: string
  endpoint: string
}

export interface AddGCPProfileParams {
  type: 'gcp'
  /** Opaque id; omitted → server generates UUID. */
  name?: string
  serviceAccountJson: string
  projectId: string
}

export interface AddAzureProfileParams {
  type: 'azure'
  /** Opaque id; omitted → server generates UUID. */
  name?: string
  serviceAccountJson: string
  subscriptionId: string
}

export const api = {
  listProfiles() {
    return request<{ profiles: Profile[] }>('GET', '/api/profiles')
  },

  addProfile(params: AddAWSProfileParams | AddKubeconfigProfileParams | AddGCPProfileParams | AddAzureProfileParams) {
    return request<{ ok: boolean; name: string }>('POST', '/api/profiles', params)
  },

  deleteProfile(name: string) {
    return request<{ ok: boolean }>('DELETE', `/api/profiles/${encodeURIComponent(name)}`)
  },

  unlinkKubeconfig(path: string) {
    return request<{ ok: boolean; removed: string[] }>('POST', '/api/kubeconfig/unlink', { path })
  },

  disconnectProfile(name: string) {
    return request<{ ok: boolean }>('POST', `/api/profiles/${encodeURIComponent(name)}/disconnect`)
  },

  listClusters(profile: string, mfaToken = '') {
    return request<{ clusters: EKSCluster[] }>('GET', `${profilePath(profile)}/clusters?mfaToken=${encodeURIComponent(mfaToken)}`)
  },

  authProfile(
    profile: string,
    clusterName: string,
    mfaToken = '',
    resourceGroup?: string,
    opts?: { allowExec?: boolean; allowInsecureTLS?: boolean },
  ) {
    return request<{ ok: boolean }>('POST', `${profilePath(profile)}/auth`, {
      clusterName,
      mfaToken,
      resourceGroup,
      allowExec: opts?.allowExec === true,
      allowInsecureTLS: opts?.allowInsecureTLS === true,
    })
  },

  getClusterInfo(profile: string, mfaToken = '') {
    return request<ClusterInfo>('GET', `${profilePath(profile)}/k8s/info?mfaToken=${encodeURIComponent(mfaToken)}`)
  },

  listResources(profile: string, kind: string, namespace = '') {
    const qs = namespace ? `?namespace=${encodeURIComponent(namespace)}` : ''
    return request<ResourceList>('GET', `${profilePath(profile)}/k8s/resources/${kind}${qs}`)
  },

  listApplications(profile: string) {
    return request<ApplicationList>('GET', `${profilePath(profile)}/k8s/applications`)
  },

  listNetworkMap(profile: string, namespace?: string) {
    const qs = namespace ? `?namespace=${encodeURIComponent(namespace)}` : ''
    return request<NetworkMap>('GET', `${profilePath(profile)}/k8s/network-map${qs}`)
  },

  getPodContainers(profile: string, podName: string, namespace?: string) {
    const qs = namespace ? `?namespace=${encodeURIComponent(namespace)}` : ''
    return request<{ init?: string[]; containers?: string[]; current?: string; running?: string[] }>(
      'GET', `${profilePath(profile)}/k8s/pods/${encodeURIComponent(podName)}/containers${qs}`)
  },

  statPodFile(profile: string, podName: string, body: {
    namespace?: string
    container: string
    remotePath: string
  }) {
    return request<{ kind: 'file' | 'dir' | 'missing' }>(
      'POST',
      `${profilePath(profile)}/k8s/pods/${encodeURIComponent(podName)}/files/stat`,
      body,
    )
  },

  pullPodFile(profile: string, podName: string, body: {
    namespace?: string
    container: string
    remotePath: string
    localPath: string
  }) {
    return request<{ ok: boolean }>(
      'POST',
      `${profilePath(profile)}/k8s/pods/${encodeURIComponent(podName)}/files/pull`,
      body,
    )
  },

  pushPodFile(profile: string, podName: string, body: {
    namespace?: string
    container: string
    remotePath: string
    localPath: string
  }) {
    return request<{ ok: boolean }>(
      'POST',
      `${profilePath(profile)}/k8s/pods/${encodeURIComponent(podName)}/files/push`,
      body,
    )
  },

  listPodFiles(profile: string, podName: string, body: {
    namespace?: string
    container: string
    remotePath: string
    nameFilter?: string
  }) {
    return request<{ entries: { name: string; kind: 'file' | 'dir'; size: number }[]; truncated?: boolean }>(
      'POST',
      `${profilePath(profile)}/k8s/pods/${encodeURIComponent(podName)}/files/list`,
      body,
    )
  },

  listCRDGroups(profile: string) {
    return request<{ groups: CRDGroup[] }>('GET', `${profilePath(profile)}/k8s/crd/groups`)
  },

  listHelmReleases(profile: string) {
    return request<{ releases: HelmRelease[] }>('GET', `${profilePath(profile)}/k8s/helm/releases`)
  },

  listHelmCharts(profile: string) {
    return request<{ charts: HelmChart[] }>('GET', `${profilePath(profile)}/k8s/helm/charts`)
  },

  listHelmRepos(profile: string) {
    return request<{ repos: { name: string; url: string }[] }>(
      'GET',
      `${profilePath(profile)}/k8s/helm/repos`,
    )
  },

  listHelmRepoCharts(profile: string, opts: { url?: string; repo?: string }) {
    const qs = new URLSearchParams()
    if (opts.url) qs.set('url', opts.url)
    if (opts.repo) qs.set('repo', opts.repo)
    return request<{ charts: { name: string; description?: string; latestVersion?: string }[] }>(
      'GET',
      `${profilePath(profile)}/k8s/helm/repo-charts?${qs}`,
    )
  },

  listHelmRepoChartVersions(profile: string, opts: { url?: string; repo?: string; chart: string }) {
    const qs = new URLSearchParams()
    if (opts.url) qs.set('url', opts.url)
    if (opts.repo) qs.set('repo', opts.repo)
    qs.set('chart', opts.chart)
    return request<{ versions: string[] }>(
      'GET',
      `${profilePath(profile)}/k8s/helm/repo-charts?${qs}`,
    )
  },

  getHelmChartValues(
    profile: string,
    opts: { chart: string; url?: string; repo?: string; version?: string },
  ) {
    const qs = new URLSearchParams()
    qs.set('chart', opts.chart)
    if (opts.url) qs.set('url', opts.url)
    if (opts.repo) qs.set('repo', opts.repo)
    if (opts.version) qs.set('version', opts.version)
    return request<{ valuesYaml: string; version: string }>(
      'GET',
      `${profilePath(profile)}/k8s/helm/chart-values?${qs}`,
    )
  },

  listHelmReleaseHistory(profile: string, namespace: string, name: string) {
    return request<{ revisions: HelmRevision[] }>(
      'GET',
      `${profilePath(profile)}/k8s/helm/releases/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/history`,
    )
  },

  getHelmReleaseValues(profile: string, namespace: string, name: string, all = false) {
    const qs = all ? '?all=1' : ''
    return request<{ valuesYaml: string }>(
      'GET',
      `${profilePath(profile)}/k8s/helm/releases/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/values${qs}`,
    )
  },

  installHelmRelease(
    profile: string,
    body: { name: string; namespace: string; chart: string; repo?: string; version?: string; valuesYaml?: string },
  ) {
    return request<{ ok: boolean }>('POST', `${profilePath(profile)}/k8s/helm/releases`, body)
  },

  upgradeHelmRelease(
    profile: string,
    namespace: string,
    name: string,
    body: { chart?: string; repo?: string; version?: string; valuesYaml?: string; reuseValues?: boolean },
  ) {
    return request<{ ok: boolean }>(
      'PUT',
      `${profilePath(profile)}/k8s/helm/releases/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`,
      body,
    )
  },

  uninstallHelmRelease(profile: string, namespace: string, name: string, keepHistory = false) {
    const qs = keepHistory ? '?keepHistory=1' : ''
    return request<{ ok: boolean }>(
      'DELETE',
      `${profilePath(profile)}/k8s/helm/releases/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}${qs}`,
    )
  },

  rollbackHelmRelease(profile: string, namespace: string, name: string, revision: number) {
    return request<{ ok: boolean }>(
      'POST',
      `${profilePath(profile)}/k8s/helm/releases/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/rollback`,
      { revision },
    )
  },

  listPortForwards(profile: string) {
    return request<{ sessions: PortForwardSession[] }>('GET', `${profilePath(profile)}/k8s/portforwards`)
  },

  startPortForward(profile: string, namespace: string, podName: string, localPort: number, remotePort: number) {
    return request<PortForwardSession>('POST', `${profilePath(profile)}/k8s/portforwards`, { namespace, podName, localPort, remotePort })
  },

  startServicePortForward(profile: string, namespace: string, serviceName: string, localPort: number, remotePort: number) {
    return request<PortForwardSession>('POST', `${profilePath(profile)}/k8s/services/${encodeURIComponent(serviceName)}/portforward`, { namespace, localPort, remotePort })
  },

  stopPortForward(profile: string, id: string) {
    return request<{ ok: boolean }>('DELETE', `${profilePath(profile)}/k8s/portforwards/${id}`)
  },

  restartWorkload(profile: string, kind: string, name: string, namespace?: string) {
    const qs = namespace ? `?namespace=${encodeURIComponent(namespace)}` : ''
    return request<{ ok: boolean }>('POST', `${profilePath(profile)}/k8s/resources/${kind}/${encodeURIComponent(name)}/restart${qs}`)
  },

  scaleWorkload(profile: string, kind: string, name: string, replicas: number, namespace?: string) {
    const qs = namespace ? `?namespace=${encodeURIComponent(namespace)}` : ''
    return request<{ ok: boolean }>('POST', `${profilePath(profile)}/k8s/resources/${kind}/${encodeURIComponent(name)}/scale${qs}`, { replicas })
  },

  suspendCronJob(profile: string, name: string, namespace?: string) {
    const qs = namespace ? `?namespace=${encodeURIComponent(namespace)}` : ''
    return request<{ ok: boolean }>('POST', `${profilePath(profile)}/k8s/resources/cronjobs/${encodeURIComponent(name)}/suspend${qs}`)
  },

  resumeCronJob(profile: string, name: string, namespace?: string) {
    const qs = namespace ? `?namespace=${encodeURIComponent(namespace)}` : ''
    return request<{ ok: boolean }>('POST', `${profilePath(profile)}/k8s/resources/cronjobs/${encodeURIComponent(name)}/resume${qs}`)
  },

  triggerCronJob(profile: string, name: string, namespace?: string) {
    const qs = namespace ? `?namespace=${encodeURIComponent(namespace)}` : ''
    return request<{ ok: boolean; jobName: string }>('POST', `${profilePath(profile)}/k8s/resources/cronjobs/${encodeURIComponent(name)}/trigger${qs}`)
  },

  pauseDeployment(profile: string, name: string, namespace?: string) {
    const qs = namespace ? `?namespace=${encodeURIComponent(namespace)}` : ''
    return request<{ ok: boolean }>('POST', `${profilePath(profile)}/k8s/resources/deployments/${encodeURIComponent(name)}/pause${qs}`)
  },

  resumeDeployment(profile: string, name: string, namespace?: string) {
    const qs = namespace ? `?namespace=${encodeURIComponent(namespace)}` : ''
    return request<{ ok: boolean }>('POST', `${profilePath(profile)}/k8s/resources/deployments/${encodeURIComponent(name)}/resume${qs}`)
  },

  undoDeployment(profile: string, name: string, namespace?: string, toRevision?: number) {
    const qs = namespace ? `?namespace=${encodeURIComponent(namespace)}` : ''
    return request<{ ok: boolean }>('POST', `${profilePath(profile)}/k8s/resources/deployments/${encodeURIComponent(name)}/undo${qs}`, toRevision ? { toRevision } : {})
  },

  listDeploymentRevisions(profile: string, name: string, namespace?: string) {
    const qs = namespace ? `?namespace=${encodeURIComponent(namespace)}` : ''
    return request<{ revisions: RolloutRevision[] }>('GET', `${profilePath(profile)}/k8s/resources/deployments/${encodeURIComponent(name)}/revisions${qs}`)
  },

  approveCSR(profile: string, name: string) {
    return request<{ ok: boolean }>('POST', `${profilePath(profile)}/k8s/resources/certificatesigningrequests/${encodeURIComponent(name)}/approve`)
  },

  denyCSR(profile: string, name: string) {
    return request<{ ok: boolean }>('POST', `${profilePath(profile)}/k8s/resources/certificatesigningrequests/${encodeURIComponent(name)}/deny`)
  },

  evictPod(profile: string, name: string, namespace?: string) {
    const qs = namespace ? `?namespace=${encodeURIComponent(namespace)}` : ''
    return request<{ ok: boolean }>('POST', `${profilePath(profile)}/k8s/resources/pods/${encodeURIComponent(name)}/evict${qs}`)
  },

  async getResourceYaml(profile: string, kind: string, name: string, namespace?: string): Promise<string> {
    const qs = namespace ? `?namespace=${encodeURIComponent(namespace)}` : ''
    return apiFetchText(`${profilePath(profile)}/k8s/resources/${kind}/${encodeURIComponent(name)}${qs}`)

  },

  async applyResourceYaml(profile: string, kind: string, name: string, yaml: string, namespace?: string): Promise<void> {
    const qs = namespace ? `?namespace=${encodeURIComponent(namespace)}` : ''
    await apiFetchOk(`${profilePath(profile)}/k8s/resources/${kind}/${encodeURIComponent(name)}${qs}`, {
      method: 'PUT', headers: { 'Content-Type': 'text/plain' }, body: yaml,
    })

  },

  async createResourceYaml(profile: string, kind: string, yaml: string, namespace?: string): Promise<string> {
    const qs = namespace ? `?namespace=${encodeURIComponent(namespace)}` : ''
    const d = await apiFetchJson<{ name?: string }>(`${profilePath(profile)}/k8s/resources/${kind}${qs}`, {
      method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: yaml,
    })
    return d.name ?? ''

  },

  async applyManifestYaml(profile: string, yaml: string): Promise<{ applied: { kind: string; name: string; namespace?: string; action: string }[] }> {
    const d = await apiFetchJson<{ applied?: { kind: string; name: string; namespace?: string; action: string }[] }>(
      `${profilePath(profile)}/k8s/apply`,
      { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: yaml },
      'Apply failed',
    )
    return { applied: d.applied ?? [] }
  },

  async getResourceDetail(profile: string, kind: string, name: string, namespace?: string): Promise<Record<string, unknown>> {
    const qs = namespace ? `?namespace=${encodeURIComponent(namespace)}` : ''
    return apiFetchJson(`${profilePath(profile)}/k8s/resources/${kind}/${encodeURIComponent(name)}/detail${qs}`)

  },

  async getResourceEvents(profile: string, kind: string, name: string, namespace?: string): Promise<ResourceEvent[]> {
    const qs = namespace ? `?namespace=${encodeURIComponent(namespace)}` : ''
    return apiFetchJson(`${profilePath(profile)}/k8s/resources/${kind}/${encodeURIComponent(name)}/events${qs}`)

  },

  async getCRDResourceDetail(profile: string, group: string, version: string, plural: string, name: string, namespace?: string): Promise<Record<string, unknown>> {
    const qs = namespace ? `?namespace=${encodeURIComponent(namespace)}` : ''
    return apiFetchJson(`${profilePath(profile)}/k8s/crd/${encodeURIComponent(group)}/${version}/${plural}/${encodeURIComponent(name)}/detail${qs}`)

  },

  async getCRDResourceEvents(profile: string, group: string, version: string, plural: string, name: string, namespace?: string, kind?: string): Promise<ResourceEvent[]> {
    const params = new URLSearchParams()
    if (namespace) params.set('namespace', namespace)
    if (kind) params.set('kind', kind)
    const qs = params.toString() ? `?${params.toString()}` : ''
    return apiFetchJson(`${profilePath(profile)}/k8s/crd/${encodeURIComponent(group)}/${version}/${plural}/${encodeURIComponent(name)}/events${qs}`)

  },

  async deleteResource(
    profile: string,
    kind: string,
    name: string,
    namespace?: string,
    opts?: DeleteResourceOpts,
  ): Promise<void> {
    const params = new URLSearchParams()
    if (namespace) params.set('namespace', namespace)
    if (opts?.force) params.set('force', 'true')
    if (opts?.gracePeriod != null && Number.isFinite(opts.gracePeriod)) {
      params.set('gracePeriod', String(opts.gracePeriod))
    }
    if (opts?.propagation) params.set('propagation', opts.propagation)
    const qs = params.toString() ? `?${params.toString()}` : ''
    await apiFetchOk(`${profilePath(profile)}/k8s/resources/${kind}/${encodeURIComponent(name)}${qs}`, {
      method: 'DELETE',
    })

  },

  async getCRDResourceYaml(profile: string, group: string, version: string, plural: string, name: string, namespace?: string): Promise<string> {
    const qs = namespace ? `?namespace=${encodeURIComponent(namespace)}` : ''
    return apiFetchText(`${profilePath(profile)}/k8s/crd/${encodeURIComponent(group)}/${version}/${plural}/${encodeURIComponent(name)}${qs}`)

  },

  async applyCRDResourceYaml(profile: string, group: string, version: string, plural: string, name: string, yaml: string, namespace?: string): Promise<void> {
    const qs = namespace ? `?namespace=${encodeURIComponent(namespace)}` : ''
    await apiFetchOk(`${profilePath(profile)}/k8s/crd/${encodeURIComponent(group)}/${version}/${plural}/${encodeURIComponent(name)}${qs}`, {
      method: 'PUT', headers: { 'Content-Type': 'text/plain' }, body: yaml,
    })

  },

  async deleteCRDResource(
    profile: string,
    group: string,
    version: string,
    plural: string,
    name: string,
    namespace?: string,
    opts?: DeleteResourceOpts,
  ): Promise<void> {
    const params = new URLSearchParams()
    if (namespace) params.set('namespace', namespace)
    if (opts?.force) params.set('force', 'true')
    if (opts?.gracePeriod != null && Number.isFinite(opts.gracePeriod)) {
      params.set('gracePeriod', String(opts.gracePeriod))
    }
    if (opts?.propagation) params.set('propagation', opts.propagation)
    const qs = params.toString() ? `?${params.toString()}` : ''
    await apiFetchOk(`${profilePath(profile)}/k8s/crd/${encodeURIComponent(group)}/${version}/${plural}/${encodeURIComponent(name)}${qs}`, {
      method: 'DELETE',
    })

  },

  async getPodMetrics(profile: string, podName: string, namespace?: string): Promise<PodMetrics> {
    const qs = namespace ? `?namespace=${encodeURIComponent(namespace)}` : ''
    return apiFetchJson(`${profilePath(profile)}/k8s/pods/${encodeURIComponent(podName)}/metrics${qs}`)

  },

  async getPodMetricsHistory(profile: string, podName: string, namespace?: string): Promise<{ points: MetricPoint[]; source: MetricsHistorySource }> {
    const qs = namespace ? `?namespace=${encodeURIComponent(namespace)}` : ''
    const body = await apiFetchJson<{ points: MetricPoint[]; source?: string }>(
      `${profilePath(profile)}/k8s/pods/${encodeURIComponent(podName)}/metrics/history${qs}`,
      { signal: AbortSignal.timeout(90_000) },
    )
    return { points: body.points ?? [], source: normalizeMetricsHistorySource(body.source) }
  },

  async getAllPodMetrics(profile: string, namespace?: string): Promise<Record<string, PodMetricsSummary>> {
    const qs = namespace ? `?namespace=${encodeURIComponent(namespace)}` : ''
    const body = await apiFetchJson<{ items: Record<string, PodMetricsSummary> }>(
      `${profilePath(profile)}/k8s/pod-metrics${qs}`,
    )
    return body.items

  },

  async getAllNodeMetrics(profile: string): Promise<Record<string, NodeMetricsSummary>> {
    const body = await apiFetchJson<{ items: Record<string, NodeMetricsSummary> }>(
      `${profilePath(profile)}/k8s/node-metrics`,
    )
    return body.items

  },

  async getNodeMetrics(profile: string, nodeName: string): Promise<NodeMetricsSummary> {
    return apiFetchJson(`${profilePath(profile)}/k8s/nodes/${encodeURIComponent(nodeName)}/metrics`)

  },

  async getNodeMetricsHistory(profile: string, nodeName: string): Promise<{ points: MetricPoint[]; source: MetricsHistorySource }> {
    const body = await apiFetchJson<{ points: MetricPoint[]; source?: string }>(
      `${profilePath(profile)}/k8s/nodes/${encodeURIComponent(nodeName)}/metrics/history`,
      { signal: AbortSignal.timeout(90_000) },
    )
    return { points: body.points ?? [], source: normalizeMetricsHistorySource(body.source) }
  },

  async getClusterMetricsHistory(profile: string): Promise<{ points: MetricPoint[]; source: MetricsHistorySource }> {
    const body = await apiFetchJson<{ points: MetricPoint[]; source?: string }>(
      `${profilePath(profile)}/k8s/cluster-metrics-collector/history/cluster`,
      { signal: AbortSignal.timeout(90_000) },
    )
    return {
      points: body.points ?? [],
      source: normalizeMetricsHistorySource(body.source),
    }
  },

  getMetricsSource(profile: string) {
    return request<MetricsSourceSettings>(
      'GET',
      `${profilePath(profile)}/k8s/metrics-source`,
    )
  },

  setMetricsSource(profile: string, body: {
    source?: string
    prometheusNamespace?: string
    prometheusService?: string
    prometheusPort?: string
    prometheusURL?: string
    prometheusBearer?: string
    clearBearer?: boolean
  }) {
    return request<MetricsSourceSettings>(
      'PUT',
      `${profilePath(profile)}/k8s/metrics-source`,
      body,
    )
  },

  discoverPrometheus(profile: string) {
    return request<{ items: PrometheusRef[] }>(
      'GET',
      `${profilePath(profile)}/k8s/prometheus/discover`,
    )
  },

  getClusterMetricsCollector(profile: string) {
    return request<{
      state: 'disabled' | 'missing' | 'pending' | 'running' | 'error'
      retentionDays?: number
      readyReplicas?: number
      message?: string
      manifestVersion?: number
      updateAvailable?: boolean
      meta?: { version?: number; retentionDays?: number; nodeIntervalSec?: number; podIntervalSec?: number }
    }>('GET', `${profilePath(profile)}/k8s/cluster-metrics-collector`)
  },

  setClusterMetricsCollector(profile: string, body: { enabled: boolean; retentionDays?: number }) {
    return request<{
      state: 'disabled' | 'missing' | 'pending' | 'running' | 'error'
      retentionDays?: number
      readyReplicas?: number
      message?: string
      manifestVersion?: number
      updateAvailable?: boolean
    }>('PUT', `${profilePath(profile)}/k8s/cluster-metrics-collector`, body)
  },

  async listNodePods(profile: string, nodeName: string): Promise<NodePodSummary[]> {
    const body = await apiFetchJson<{ pods: NodePodSummary[] }>(
      `${profilePath(profile)}/k8s/nodes/${encodeURIComponent(nodeName)}/pods`,
    )
    return body.pods

  },

  async cordonNode(profile: string, nodeName: string): Promise<void> {
    await apiFetchOk(`${profilePath(profile)}/k8s/nodes/${encodeURIComponent(nodeName)}/cordon`, { method: 'POST' })

  },

  async uncordonNode(profile: string, nodeName: string): Promise<void> {
    await apiFetchOk(`${profilePath(profile)}/k8s/nodes/${encodeURIComponent(nodeName)}/uncordon`, { method: 'POST' })

  },

  drainNodeUrl(profile: string, nodeName: string): string {
    return `${profilePath(profile)}/k8s/nodes/${encodeURIComponent(nodeName)}/drain`
  },

  listNodeTaints(profile: string, nodeName: string) {
    return request<{ taints: NodeTaint[] }>('GET', `${profilePath(profile)}/k8s/nodes/${encodeURIComponent(nodeName)}/taints`)
  },

  addNodeTaint(profile: string, nodeName: string, key: string, value: string, effect: string) {
    return request<{ ok: boolean }>('POST', `${profilePath(profile)}/k8s/nodes/${encodeURIComponent(nodeName)}/taints`, { key, value, effect })
  },

  removeNodeTaint(profile: string, nodeName: string, key: string, effect: string) {
    const qs = `?key=${encodeURIComponent(key)}&effect=${encodeURIComponent(effect)}`
    return request<{ ok: boolean }>('DELETE', `${profilePath(profile)}/k8s/nodes/${encodeURIComponent(nodeName)}/taints${qs}`)
  },

  async listGroups(): Promise<string[]> {
    const res = await apiFetch('/api/groups')
    if (!res.ok) return []
    const body = await res.json() as { groups: string[] }
    return body.groups ?? []
  },

  async createGroup(name: string): Promise<string[]> {
    const body = await apiFetchJson<{ groups: string[] }>('/api/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    return body.groups ?? []

  },

  async checkAccess(profile: string, checks: AccessCheck[]): Promise<Record<string, boolean>> {
    const d = await apiFetchJson<{ results?: Record<string, boolean> }>(`${profilePath(profile)}/k8s/auth/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ checks }),
    })
    return d.results ?? {}

  },

  async deleteGroup(name: string): Promise<{ groups: string[]; removedProfiles: string[] }> {
    const body = await apiFetchJson<{ groups: string[]; removedProfiles?: string[] }>(
      `/api/groups/${encodeURIComponent(name)}`,
      { method: 'DELETE' },
    )
    return { groups: body.groups ?? [], removedProfiles: body.removedProfiles ?? [] }
  },

  async renameGroup(oldName: string, newName: string): Promise<string[]> {
    const body = await apiFetchJson<{ groups: string[] }>(`/api/groups/${encodeURIComponent(oldName)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName }),
    })
    return body.groups ?? []

  },

  async setProfileGroup(profileName: string, group: string): Promise<void> {
    await apiFetchOk(`${profilePath(profileName)}/group`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ group }),
    })

  },

  async setProfileDisplayName(profileName: string, displayName: string): Promise<void> {
    await apiFetchOk(`${profilePath(profileName)}/display-name`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName }),
    })

  },

  async previewKubeconfig(kubeconfigData: string): Promise<KubeContextEntry[]> {
    const res = await request<{ contexts: KubeContextEntry[] }>('POST', '/api/kubeconfig/preview', { kubeconfigData })
    return res.contexts
  },

  async getDefaultKubeconfig(): Promise<{ path: string; contexts: KubeContextEntry[] } | null> {
    const res = await apiFetch('/api/kubeconfig/default')
    if (!res.ok) return null
    return res.json()
  },

  async getDebugState(): Promise<boolean> {
    const res = await apiFetch('/api/debug')
    if (!res.ok) return false
    const d = await res.json() as { enabled: boolean }
    return d.enabled
  },

  async setDebugEnabled(enabled: boolean): Promise<void> {
    await request<unknown>('POST', '/api/debug', { enabled })
  },

  async getDebugLogs(): Promise<string> {
    const res = await apiFetch('/api/debug/logs')
    if (!res.ok) return ''
    return res.text()
  },
}
