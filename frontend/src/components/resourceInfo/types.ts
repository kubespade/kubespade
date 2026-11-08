export type InfoTarget =
  | { type: 'k8s'; kind: string; name: string; namespace?: string; focusEnvContainer?: string }
  | { type: 'crd'; group: string; version: string; plural: string; kind: string; name: string; namespace?: string }

export interface ResourceInfoPanelProps {
  profile: string
  target: InfoTarget
  onEdit: () => void
  onClose: () => void
  onDelete?: () => void
  onCopy?: () => void
  onLogs?: () => void
  onExec?: (container?: string) => void
  onFiles?: (container?: string) => void
  onRestart?: () => void
  onScale?: () => void
  onSuspend?: () => void
  onResume?: () => void
  onPause?: () => void
  onTrigger?: () => void
  onUndo?: () => void
  onHistory?: () => void
  onApprove?: () => void
  onDeny?: () => void
  onPortForward?: (suggestedPorts: number[]) => void
  activePortForward?: { localPort: number; remotePort: number }
  onStopPortForward?: () => void
  onCordon?: () => void
  onUncordon?: () => void
  onDrain?: () => void
  onTaints?: () => void
  onEvict?: () => void
  /** Navigate to Pods table for this pod (e.g. from Drain overlay). */
  onOpenInPods?: () => void
  /** Stack above NodeActionLog (drain) so the log stays open underneath. */
  aboveActionLog?: boolean
}
