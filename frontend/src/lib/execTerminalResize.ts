/** Fired while the exec panel or sidebar is being dragged — pause remote SIGWINCH. */
export const EXEC_PANEL_RESIZE_START = 'k8s-exec-panel-resize-start'
/** Fired when layout drag ends — flush one terminal size to the pod. */
export const EXEC_PANEL_RESIZE_END = 'k8s-exec-panel-resize-end'

export function notifyExecPanelResizeStart(): void {
  window.dispatchEvent(new Event(EXEC_PANEL_RESIZE_START))
}

export function notifyExecPanelResizeEnd(): void {
  window.dispatchEvent(new Event(EXEC_PANEL_RESIZE_END))
}

/** Coalesce rapid xterm resizes so the remote shell is not spammed with SIGWINCH. */
export function createExecResizeSender(
  send: (cols: number, rows: number) => void,
  debounceMs = 500,
) {
  let lastW = 0
  let lastH = 0
  let timer = 0
  let pendingW = 0
  let pendingH = 0
  let paused = false

  function deliver(cols: number, rows: number) {
    if (cols <= 0 || rows <= 0) return
    if (cols === lastW && rows === lastH) return
    lastW = cols
    lastH = rows
    send(cols, rows)
  }

  function scheduleResize(cols: number, rows: number) {
    if (cols <= 0 || rows <= 0) return
    if (cols === lastW && rows === lastH) return
    pendingW = cols
    pendingH = rows
    if (paused) return
    window.clearTimeout(timer)
    timer = window.setTimeout(() => {
      deliver(pendingW, pendingH)
    }, debounceMs)
  }

  /** Send the first size immediately after the exec session opens. */
  function flush(cols: number, rows: number) {
    window.clearTimeout(timer)
    deliver(cols, rows)
  }

  function pause() {
    paused = true
    window.clearTimeout(timer)
  }

  function resume() {
    paused = false
  }

  function reset() {
    lastW = 0
    lastH = 0
    pendingW = 0
    pendingH = 0
    paused = false
    window.clearTimeout(timer)
  }

  /** Record the size already sent to the PTY so the next fit does not SIGWINCH. */
  function seed(cols: number, rows: number) {
    if (cols <= 0 || rows <= 0) return
    lastW = cols
    lastH = rows
    pendingW = cols
    pendingH = rows
  }

  return { scheduleResize, flush, pause, resume, reset, seed }
}

/** Run FitAddon.fit at most once per animation frame during layout churn. */
export function scheduleTerminalFit(fit: () => void): () => void {
  let raf = 0
  return () => {
    window.cancelAnimationFrame(raf)
    raf = window.requestAnimationFrame(() => fit())
  }
}

/** Wire panel/sidebar drag events to pause remote resize until drag ends. */
export function bindExecPanelResizeBridge(handlers: {
  pause: () => void
  resume: () => void
  flush: (cols: number, rows: number) => void
  fit: () => void
  cols: () => number
  rows: () => number
}): () => void {
  const onStart = () => handlers.pause()
  const onEnd = () => {
    handlers.fit()
    handlers.resume()
    handlers.flush(handlers.cols(), handlers.rows())
  }
  window.addEventListener(EXEC_PANEL_RESIZE_START, onStart)
  window.addEventListener(EXEC_PANEL_RESIZE_END, onEnd)
  return () => {
    window.removeEventListener(EXEC_PANEL_RESIZE_START, onStart)
    window.removeEventListener(EXEC_PANEL_RESIZE_END, onEnd)
  }
}
