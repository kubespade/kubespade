import { useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowDownFromLine, Ban, Check, CheckCircle2, ChevronsUpDown, CirclePlay, Copy, FolderOpen, History, Lock, LockOpen, LogOut, Pause, Pencil, Play, Plug, RotateCcw, ScrollText, Tags, Terminal, Trash2, Undo2 } from 'lucide-react'
import type { PermissionKey, ResourcePermissions } from '../lib/k8sPermissions'
import { fixedAnchorCenterTop } from '../lib/uiZoom'

interface Props {
  onEdit: () => void
  onDelete: () => void
  onLogs?: () => void
  onExec?: () => void
  onFiles?: () => void
  onCopy?: () => void
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
  onPortForward?: () => void
  activePortForward?: { localPort: number; remotePort: number }
  onStopPortForward?: () => void
  onCordon?: () => void
  onUncordon?: () => void
  onDrain?: () => void
  onTaints?: () => void
  onEvict?: () => void
  permissions?: ResourcePermissions | null
}

interface TipState { text: string; x: number; y: number }

const DENIED_TIP = 'Permission denied'

function useRowTip() {
  const [tip, setTip] = useState<TipState | null>(null)
  function show(e: React.MouseEvent, text: string) {
    const { x, y } = fixedAnchorCenterTop(e.currentTarget as HTMLElement)
    setTip({ text, x, y })
  }
  function hide() { setTip(null) }
  return { tip, show, hide }
}

function allowed(perms: ResourcePermissions | null | undefined, key: PermissionKey): boolean {
  if (perms === undefined) return true
  if (perms === null) return false
  if (key in perms) return perms[key] === true
  return true
}

function tipFor(perms: ResourcePermissions | null | undefined, key: PermissionKey, label: string): string {
  if (!allowed(perms, key)) return DENIED_TIP
  return label
}

export function ActionButtons({
  onEdit, onDelete, onLogs, onExec, onFiles, onCopy, onRestart, onScale, onSuspend, onResume, onPause, onTrigger,
  onUndo, onHistory, onApprove, onDeny,
  onPortForward, activePortForward, onStopPortForward, onCordon, onUncordon, onDrain, onTaints, onEvict,
  permissions,
}: Props) {
  const [copied, setCopied] = useState(false)
  const { tip, show, hide } = useRowTip()

  function handleCopy() {
    onCopy?.()
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  function btn(
    key: PermissionKey | null,
    label: string,
    onClick: () => void,
    icon: React.ReactNode,
    extraClass = '',
  ) {
    const disabled = key !== null && !allowed(permissions, key)
    return (
      <button
        type="button"
        className={`row-action-btn${extraClass}${disabled ? ' row-action-disabled' : ''}`}
        disabled={disabled}
        aria-label={label}
        data-testid={key ? `row-action-${key}` : `row-action-${label.toLowerCase().replace(/\s+/g, '-')}`}
        onClick={e => { e.stopPropagation(); if (!disabled) onClick() }}
        onMouseEnter={e => show(e, key !== null ? tipFor(permissions, key, label) : label)}
        onMouseLeave={hide}
      >
        {icon}
      </button>
    )
  }

  return (
    <div className="row-actions">
      {onCopy && btn(null, copied ? 'Copied!' : 'Copy name', handleCopy, copied ? <Check size={11} /> : <Copy size={11} />)}
      {onLogs && btn('logs', 'Logs', onLogs, <ScrollText size={11} />)}
      {onExec && btn('exec', 'Terminal', onExec, <Terminal size={11} />)}
      {onFiles && btn('exec', 'Files', onFiles, <FolderOpen size={11} />)}
      {activePortForward && onStopPortForward ? (
        btn(null, `Stop :${activePortForward.localPort}`, onStopPortForward, <Plug size={11} />, ' row-action-active')
      ) : onPortForward ? (
        btn('portForward', 'Port Forward', onPortForward, <Plug size={11} />)
      ) : null}
      {onRestart && btn('restart', 'Restart', onRestart, <RotateCcw size={11} />)}
      {onScale && btn('scale', 'Scale', onScale, <ChevronsUpDown size={11} />)}
      {onTrigger && btn('trigger', 'Trigger now', onTrigger, <CirclePlay size={11} />)}
      {onPause && btn('suspend', 'Pause rollout', onPause, <Pause size={11} />)}
      {onSuspend && btn('suspend', 'Suspend', onSuspend, <Pause size={11} />)}
      {onResume && btn('suspend', 'Resume', onResume, <Play size={11} />, ' row-action-warn')}
      {onUndo && btn('undo', 'Undo rollout', onUndo, <Undo2 size={11} />)}
      {onHistory && btn(null, 'Rollout history', onHistory, <History size={11} />)}
      {onApprove && btn('approve', 'Approve CSR', onApprove, <CheckCircle2 size={11} />)}
      {onDeny && btn('deny', 'Deny CSR', onDeny, <Ban size={11} />, ' row-action-delete')}
      {onCordon && btn('cordon', 'Cordon', onCordon, <Lock size={11} />)}
      {onUncordon && btn('uncordon', 'Uncordon', onUncordon, <LockOpen size={11} />, ' row-action-warn')}
      {onDrain && btn('drain', 'Drain', onDrain, <ArrowDownFromLine size={11} />)}
      {onTaints && btn('taint', 'Edit taints', onTaints, <Tags size={11} />)}
      {onEvict && btn('evict', 'Evict', onEvict, <LogOut size={11} />)}
      {btn('edit', 'Edit YAML', onEdit, <Pencil size={11} />)}
      {btn('delete', 'Delete', onDelete, <Trash2 size={11} />, ' row-action-delete')}

      {tip && createPortal(
        <span className="row-action-tip" style={{ left: tip.x, top: tip.y }}>
          {tip.text}
        </span>,
        document.body
      )}
    </div>
  )
}
