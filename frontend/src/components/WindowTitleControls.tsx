import { useEffect, useState } from 'react'
import { Minus, Square, X, Copy } from 'lucide-react'

/**
 * Linux frameless window controls — Yaru / GNOME style (circular).
 * Mac uses native traffic lights; Windows uses titleBarOverlay caption buttons.
 */
export function WindowTitleControls() {
  const [maximized, setMaximized] = useState(false)
  const api = window.kubespade?.windowControls

  useEffect(() => {
    if (!api) return
    void api.isMaximized().then(r => setMaximized(!!r.maximized))
    return api.onMaximized(setMaximized)
  }, [api])

  if (!api) return null

  return (
    <div className="window-title-controls" aria-label="Window">
      <button
        type="button"
        className="window-title-btn"
        title="Minimize"
        onClick={() => { void api.minimize() }}
      >
        <Minus size={12} strokeWidth={2.5} />
      </button>
      <button
        type="button"
        className="window-title-btn"
        title={maximized ? 'Restore' : 'Maximize'}
        onClick={() => { void api.maximizeToggle().then(r => setMaximized(!!r.maximized)) }}
      >
        {maximized
          ? <Copy size={10} strokeWidth={2.5} />
          : <Square size={10} strokeWidth={2.5} />}
      </button>
      <button
        type="button"
        className="window-title-btn window-title-btn-close"
        title="Close"
        onClick={() => { void api.close() }}
      >
        <X size={12} strokeWidth={2.5} />
      </button>
    </div>
  )
}
