import { useRef, useState } from 'react'
import { prefsGet, prefsSet } from '../lib/persistentStore'
import { notifyExecPanelResizeEnd, notifyExecPanelResizeStart } from '../lib/execTerminalResize'

export function useSidebarResize(onSidebarWidthChange?: (w: number) => void) {
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = prefsGet('sidebar-width')
    const n = saved ? Number(saved) : 220
    return Number.isFinite(n) ? Math.max(160, Math.min(420, n)) : 220
  })
  const isDraggingRef = useRef(false)

  function startResize(startX: number) {
    isDraggingRef.current = true
    notifyExecPanelResizeStart()
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    const startW = sidebarWidth

    function onMouseMove(ev: MouseEvent) {
      setSidebarWidth(Math.max(160, Math.min(420, startW + ev.clientX - startX)))
    }
    function onTouchMove(ev: TouchEvent) {
      ev.preventDefault()
      setSidebarWidth(Math.max(160, Math.min(420, startW + ev.touches[0].clientX - startX)))
    }
    function cleanup() {
      isDraggingRef.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', cleanup)
      document.removeEventListener('touchmove', onTouchMove)
      document.removeEventListener('touchend', cleanup)
      setSidebarWidth(w => { prefsSet('sidebar-width', String(w)); onSidebarWidthChange?.(w); return w })
      notifyExecPanelResizeEnd()
    }
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', cleanup)
    document.addEventListener('touchmove', onTouchMove, { passive: false })
    document.addEventListener('touchend', cleanup)
  }

  function onResizeStart(e: React.MouseEvent) {
    e.preventDefault()
    startResize(e.clientX)
  }

  function onResizeTouchStart(e: React.TouchEvent) {
    e.preventDefault()
    startResize(e.touches[0].clientX)
  }

  return { sidebarWidth, isDraggingRef, onResizeStart, onResizeTouchStart }
}
