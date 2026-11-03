import { useState } from 'react'
import { createPortal } from 'react-dom'
import { fixedAnchorCenterTop } from '../lib/uiZoom'

interface Props {
  tip: string
  children: React.ReactNode
}

export function HoverTip({ tip, children }: Props) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)

  function show(e: React.MouseEvent) {
    setPos(fixedAnchorCenterTop(e.currentTarget as HTMLElement))
  }

  return (
    <span
      className="hovertip-anchor"
      onMouseEnter={show}
      onMouseLeave={() => setPos(null)}
    >
      {children}
      {pos && createPortal(
        <span
          className="row-action-tip"
          style={{ left: pos.x, top: pos.y, whiteSpace: 'pre', textAlign: 'left' }}
        >
          {tip}
        </span>,
        document.body
      )}
    </span>
  )
}
