import { CLUSTER_SCOPED_KINDS } from './resourceKinds'

export type PermissionKey =
  | 'create' | 'edit' | 'delete'
  | 'logs' | 'exec' | 'portForward' | 'evict'
  | 'restart' | 'scale'
  | 'suspend' | 'trigger' | 'undo'
  | 'approve' | 'deny'
  | 'cordon' | 'uncordon' | 'drain' | 'taint'

export type ResourcePermissions = Partial<Record<PermissionKey, boolean>>

export interface AccessCheck {
  id: string
  verb: string
  kind: string
  namespace?: string
  name?: string
  subresource?: string
}

// Nodes are cluster-scoped for RBAC/permission checks as well; the shared set
// omits them (handled by the dedicated Nodes view elsewhere) so add it here.
const CLUSTER_SCOPED = new Set<string>([...CLUSTER_SCOPED_KINDS, 'nodes'])

export function isClusterScopedKind(kind: string): boolean {
  return CLUSTER_SCOPED.has(kind)
}

function baseChecks(kind: string, namespace?: string): AccessCheck[] {
  const ns = CLUSTER_SCOPED.has(kind) ? undefined : namespace
  return [
    { id: 'create', verb: 'create', kind, namespace: ns },
    { id: 'delete', verb: 'delete', kind, namespace: ns },
    { id: 'update', verb: 'update', kind, namespace: ns },
    { id: 'patch', verb: 'patch', kind, namespace: ns },
  ]
}

/** Build SelfSubjectAccessReview checks for a resource kind in a namespace. */
export function buildPermissionChecks(kind: string, namespace?: string): AccessCheck[] {
  const checks = baseChecks(kind, namespace)

  if (kind === 'pods') {
    const ns = namespace
    checks.push(
      { id: 'logs', verb: 'get', kind, namespace: ns, subresource: 'log' },
      { id: 'exec', verb: 'create', kind, namespace: ns, subresource: 'exec' },
      { id: 'portForward', verb: 'create', kind, namespace: ns, subresource: 'portforward' },
      { id: 'evict', verb: 'create', kind, namespace: ns, subresource: 'eviction' },
    )
  }

  if (kind === 'services') {
    checks.push(
      { id: 'portForward', verb: 'create', kind: 'pods', namespace, subresource: 'portforward' },
    )
  }

  if (kind === 'cronjobs') {
    checks.push(
      { id: 'trigger', verb: 'create', kind: 'jobs', namespace },
    )
  }

  if (kind === 'nodes') {
    checks.push(
      { id: 'cordon', verb: 'patch', kind: 'nodes' },
      { id: 'uncordon', verb: 'patch', kind: 'nodes' },
      { id: 'drain', verb: 'patch', kind: 'nodes' },
      { id: 'taint', verb: 'patch', kind: 'nodes' },
      { id: 'exec', verb: 'create', kind: 'pods', subresource: 'exec' },
    )
  }

  if (kind === 'certificatesigningrequests') {
    checks.push(
      { id: 'approve', verb: 'update', kind, subresource: 'approval' },
    )
  }

  return checks
}

export function combinePermissionResults(raw: Record<string, boolean>): ResourcePermissions {
  const edit = !!(raw.update || raw.patch)
  return {
    create: raw.create,
    edit,
    delete: raw.delete,
    logs: raw.logs,
    exec: raw.exec,
    portForward: raw.portForward,
    evict: raw.evict,
    restart: edit,
    scale: edit,
    suspend: edit,
    undo: edit,
    trigger: raw.trigger ?? edit,
    approve: raw.approve,
    deny: raw.approve, // same RBAC: update on certificatesigningrequests/approval
    cordon: raw.cordon,
    uncordon: raw.uncordon,
    drain: raw.drain,
    taint: raw.taint ?? raw.cordon,
  }
}
