import type { PortForwardSession } from '../types'
import type { ResourcePermissions } from './k8sPermissions'
import type { ExecTarget } from '../components/ExecPanel'
import type { LogsTarget } from '../components/PodLogsView'
import type { FilesTarget } from '../components/PodFilesPanel'
import type { ResourceInfoPanelProps } from '../components/resourceInfo/types'

/** True while logs can still grow: running (ready or not) or waiting. Gray/red = finished. */
export function isLogFollowableColor(color: string): boolean {
  return color === 'g' || color === 'y'
}

/** Build LogsTarget with follow disabled for finished containers. */
export function logsTargetForPod(
  podName: string,
  namespace: string | undefined,
  containersField: string,
  preferredContainer?: string,
): LogsTarget {
  const dots = containersField.split(',').filter(Boolean).map(item => {
    const [rawName, color] = item.split(':')
    const isInit = rawName.startsWith('!')
    return { name: isInit ? rawName.slice(1) : rawName, isInit, active: isLogFollowableColor(color) }
  })
  const activeContainers = dots.filter(d => d.active).map(d => d.name)
  const container = preferredContainer
    ?? dots.find(d => !d.isInit)?.name
    ?? dots[0]?.name
  const follow = !!container && activeContainers.includes(container)
  return { podName, namespace, container, follow, activeContainers }
}

export type ResourceActionItem = {
  name: string
  namespace?: string
  fields?: Record<string, string>
}

export type PortForwardTarget = {
  kind: 'pod' | 'service'
  name: string
  ns: string
  suggestedPorts: number[]
}

export function parseSuggestedPorts(resource: string, fields: Record<string, string>): number[] {
  if (resource === 'pods') {
    const portsStr = fields.ports ?? ''
    return portsStr ? portsStr.split(',').map(s => parseInt(s)).filter(n => n > 0) : []
  }
  if (resource === 'services') {
    const portsStr = fields.ports ?? ''
    return portsStr && portsStr !== '<none>'
      ? portsStr.split(',').map(s => parseInt(s.trim())).filter(n => n > 0)
      : []
  }
  return []
}

export function findPortForwardSession(
  resource: string,
  sessions: PortForwardSession[],
  name: string,
  namespace: string,
): PortForwardSession | undefined {
  if (resource !== 'pods' && resource !== 'services') return undefined
  const sourceKind = resource === 'pods' ? 'pod' : 'service'
  return sessions.find(s =>
    s.sourceKind === sourceKind &&
    s.sourceName === name &&
    s.namespace === namespace,
  )
}

export type ResourceActionSetters = {
  setPfError: (v: string) => void
  setPfTarget: (t: PortForwardTarget | null) => void
  setRestartTarget: (t: { name: string; ns?: string } | null) => void
  setEvictTarget: (t: { name: string; ns?: string } | null) => void
  setScaleTarget: (t: { name: string; ns?: string; current: number } | null) => void
  setScaleError: (v: string) => void
  setTriggerTarget: (t: { name: string; ns?: string } | null) => void
  setSuspendTarget: (t: { name: string; ns?: string; resume: boolean } | null) => void
  setPauseTarget: (t: { name: string; ns?: string; resume: boolean } | null) => void
  setUndoTarget: (t: { name: string; ns?: string } | null) => void
  setHistoryTarget: (t: { name: string; ns?: string } | null) => void
  setCsrTarget: (t: { name: string; deny: boolean } | null) => void
}

export type ResourceActionCallbacks = {
  openLogs: (target: LogsTarget) => void
  openExec: (target: ExecTarget) => void
  openFiles: (target: FilesTarget) => void
  handleStopPortForward: (sessionId: string) => void
}

type ResourceSharedActionHandlers = Pick<
  ResourceInfoPanelProps,
  | 'onLogs'
  | 'onExec'
  | 'onFiles'
  | 'activePortForward'
  | 'onStopPortForward'
  | 'onRestart'
  | 'onEvict'
  | 'onScale'
  | 'onTrigger'
  | 'onSuspend'
  | 'onResume'
  | 'onPause'
  | 'onUndo'
  | 'onHistory'
  | 'onApprove'
  | 'onDeny'
>

export type ResourceInfoPanelActionProps = ResourceSharedActionHandlers & {
  onPortForward?: ResourceInfoPanelProps['onPortForward']
}

export type ResourceActionButtonsProps = ResourceSharedActionHandlers & {
  onPortForward?: () => void
  onCopy?: () => void
  onEdit: () => void
  onDelete: () => void
  permissions?: ResourcePermissions | null
}

function nsOpt(item: ResourceActionItem): string | undefined {
  return item.namespace ?? undefined
}

function nsStr(item: ResourceActionItem): string {
  return item.namespace ?? ''
}

function fields(item: ResourceActionItem): Record<string, string> {
  return item.fields ?? {}
}

type BuildArgs = {
  resource: string
  item: ResourceActionItem
  /** Overrides `item.fields.containers` for pod logs (info panel uses namespace-matched row). */
  containersField?: string
  /** Info panel scale when list row is missing (default replica count). */
  scaleCurrent?: number
  pfSessions: PortForwardSession[]
  getCurrentReplicas: (row: { fields: Record<string, string> }) => number
  setters: ResourceActionSetters
  callbacks: ResourceActionCallbacks
  /** When set (info panel), close after actions that did so before refactor. */
  closeInfoPanel?: () => void
}

function buildSharedResourceActions({
  resource,
  item,
  containersField,
  scaleCurrent,
  pfSessions,
  getCurrentReplicas,
  setters,
  callbacks,
  closeInfoPanel,
}: BuildArgs) {
  const name = item.name
  const ns = nsOpt(item)
  const nsForPf = nsStr(item)
  const f = fields(item)
  const close = closeInfoPanel

  const activePfSession = findPortForwardSession(resource, pfSessions, name, nsForPf)

  const onLogs = resource === 'pods'
    ? () => {
        callbacks.openLogs(logsTargetForPod(name, ns, containersField ?? f.containers ?? ''))
        close?.()
      }
    : undefined

  const onExecPod = resource === 'pods'
    ? (container?: string) => {
        callbacks.openExec({ podName: name, namespace: ns, container })
        close?.()
      }
    : undefined

  const onExecNode = resource === 'nodes'
    ? () => {
        callbacks.openExec({ nodeName: name })
        close?.()
      }
    : undefined

  const onExec = onExecPod ?? (onExecNode ? () => onExecNode() : undefined)

  const onFiles = resource === 'pods'
    ? (container?: string) => {
        callbacks.openFiles({ podName: name, namespace: ns, container })
        close?.()
      }
    : undefined

  const pfKind = resource === 'pods' ? 'pod' as const : resource === 'services' ? 'service' as const : null

  const onPortForwardForPanel = !activePfSession && pfKind
    ? (suggestedPorts: number[]) => {
        setters.setPfError('')
        close?.()
        setters.setPfTarget({ kind: pfKind, name, ns: nsForPf, suggestedPorts })
      }
    : undefined

  const onPortForwardForRow = !activePfSession && pfKind
    ? () => {
        setters.setPfError('')
        setters.setPfTarget({
          kind: pfKind,
          name,
          ns: nsForPf,
          suggestedPorts: parseSuggestedPorts(resource, f),
        })
      }
    : undefined

  const activePortForward = activePfSession
    ? { localPort: activePfSession.localPort, remotePort: activePfSession.remotePort }
    : undefined

  const onStopPortForward = activePfSession
    ? () => callbacks.handleStopPortForward(activePfSession.id)
    : undefined

  const onRestart = ['deployments', 'statefulsets', 'daemonsets'].includes(resource)
    ? () => setters.setRestartTarget({ name, ns })
    : undefined

  const onEvict = resource === 'pods'
    ? () => setters.setEvictTarget({ name, ns })
    : undefined

  const onScale = ['deployments', 'statefulsets', 'daemonsets', 'replicasets'].includes(resource)
    ? () => {
        setters.setScaleError('')
        const current = scaleCurrent ?? getCurrentReplicas({ fields: f })
        setters.setScaleTarget({ name, ns, current })
        close?.()
      }
    : undefined

  const onTrigger = resource === 'cronjobs'
    ? () => {
        setters.setTriggerTarget({ name, ns })
        close?.()
      }
    : undefined

  const onSuspend = resource === 'cronjobs' && f.suspended !== 'True'
    ? () => {
        setters.setSuspendTarget({ name, ns, resume: false })
        close?.()
      }
    : undefined

  const onResume =
    resource === 'cronjobs' && f.suspended === 'True'
      ? () => {
          setters.setSuspendTarget({ name, ns, resume: true })
          close?.()
        }
      : resource === 'deployments' && f.paused === 'True'
        ? () => {
            setters.setPauseTarget({ name, ns, resume: true })
            close?.()
          }
        : undefined

  const onPause = resource === 'deployments' && f.paused !== 'True'
    ? () => {
        setters.setPauseTarget({ name, ns, resume: false })
        close?.()
      }
    : undefined

  const onUndo = resource === 'deployments'
    ? () => {
        setters.setUndoTarget({ name, ns })
        close?.()
      }
    : undefined

  const onHistory = resource === 'deployments'
    ? () => {
        setters.setHistoryTarget({ name, ns })
        close?.()
      }
    : undefined

  const onApprove = resource === 'certificatesigningrequests' && f.condition === 'Pending'
    ? () => {
        setters.setCsrTarget({ name, deny: false })
        close?.()
      }
    : undefined

  const onDeny = resource === 'certificatesigningrequests' && f.condition === 'Pending'
    ? () => {
        setters.setCsrTarget({ name, deny: true })
        close?.()
      }
    : undefined

  return {
    onLogs,
    onExec,
    onFiles,
    onPortForwardForPanel,
    onPortForwardForRow,
    activePortForward,
    onStopPortForward,
    onRestart,
    onEvict,
    onScale,
    onTrigger,
    onSuspend,
    onResume,
    onPause,
    onUndo,
    onHistory,
    onApprove,
    onDeny,
  }
}

export function getResourceActionButtonsProps(args: BuildArgs & {
  onCopy: () => void
  onEdit: () => void
  onDelete: () => void
  permissions?: ResourcePermissions | null
}): ResourceActionButtonsProps {
  const core = buildSharedResourceActions(args)
  const { onPortForwardForPanel: _pfPanel, onPortForwardForRow, ...rest } = core
  return {
    ...rest,
    onPortForward: onPortForwardForRow,
    onCopy: args.onCopy,
    onEdit: args.onEdit,
    onDelete: args.onDelete,
    permissions: args.permissions,
  }
}

export function getResourceInfoPanelActionProps(args: BuildArgs & { closeInfoPanel: () => void }): ResourceInfoPanelActionProps {
  const core = buildSharedResourceActions(args)
  const { onPortForwardForRow: _pfRow, onPortForwardForPanel, ...rest } = core
  return {
    ...rest,
    onPortForward: onPortForwardForPanel,
  }
}
