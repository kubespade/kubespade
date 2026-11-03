import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { PodLogsView } from './PodLogsView'
import type { LogsTarget } from './PodLogsView'

export type { LogsTarget }

interface Props {
  profile: string
  target: LogsTarget
  onClose: () => void
  embedded?: boolean
}

export function PodLogsPanel({ profile, target, onClose, embedded = false }: Props) {
  useEffect(() => {
    if (embedded) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, embedded])

  const panel = (
    <div className={`logs-panel${embedded ? ' logs-panel-embedded' : ''}`} onMouseDown={embedded ? undefined : e => e.stopPropagation()}>
      <PodLogsView profile={profile} target={target} onClose={onClose} />
    </div>
  )

  if (embedded) return panel

  return createPortal(
    <>
      <div className="logs-backdrop" onMouseDown={onClose} />
      {panel}
    </>,
    document.body,
  )
}
