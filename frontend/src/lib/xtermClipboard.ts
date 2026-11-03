import type { IDisposable, Terminal } from '@xterm/xterm'

function isMac(): boolean {
  return typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform || '')
}

/** Linux/Windows Electron has no Edit menu, so Ctrl+V never becomes a paste event. */
function interceptOsKeys(): boolean {
  return !isMac()
}

function readClipboard(): string {
  try {
    const text = window.kubespade?.clipboard?.readText?.()
    if (text) return text
  } catch { /* ignore */ }
  return ''
}

function writeClipboard(text: string): boolean {
  try {
    if (window.kubespade?.clipboard?.writeText) {
      window.kubespade.clipboard.writeText(text)
      return true
    }
  } catch { /* ignore */ }
  try {
    void navigator.clipboard?.writeText?.(text)
    return true
  } catch { /* ignore */ }
  return false
}

/**
 * Same technique xterm uses for context-menu copy: put selection in the helper
 * textarea and run a native copy. Critical on Windows where canvas selection
 * never becomes a browser clipboard action by itself.
 */
function copyViaHelperTextarea(term: Terminal, text: string): boolean {
  const ta = term.element?.querySelector('textarea.xterm-helper-textarea') as HTMLTextAreaElement | null
  if (!ta) return false
  const prev = ta.value
  const prevReadOnly = ta.readOnly
  try {
    ta.readOnly = false
    ta.value = text
    ta.focus()
    ta.select()
    ta.setSelectionRange(0, text.length)
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    try {
      ta.value = prev
      ta.readOnly = prevReadOnly
    } catch { /* ignore */ }
  }
}

function copySelection(term: Terminal): boolean {
  const text = term.getSelection()
  if (!text) return false
  // OS clipboard via main-process IPC (preload), then native copy as backup.
  const electronOk = writeClipboard(text)
  const nativeOk = copyViaHelperTextarea(term, text)
  return electronOk || nativeOk
}

function isMod(ev: KeyboardEvent): boolean {
  return !!(ev.ctrlKey || ev.metaKey)
}

/** Physical key C — works with Russian layout (`key` is «с», not «c»). */
function isKeyC(ev: KeyboardEvent): boolean {
  if (ev.code === 'KeyC') return true
  const k = (ev.key || '').toLowerCase()
  if (k === 'c' || k === 'с') return true
  return ev.keyCode === 67 || ev.which === 67
}

function isKeyV(ev: KeyboardEvent): boolean {
  if (ev.code === 'KeyV') return true
  const k = (ev.key || '').toLowerCase()
  if (k === 'v' || k === 'м') return true
  return ev.keyCode === 86 || ev.which === 86
}

/** Use `code` so Ctrl+V works on Russian/other layouts (`key` is «м», not «v»). */
function isPasteKey(ev: KeyboardEvent): boolean {
  if (ev.type !== 'keydown' || ev.altKey || ev.repeat) return false
  if ((ev.key === 'Insert' || ev.code === 'Insert') && ev.shiftKey && !ev.ctrlKey && !ev.metaKey) return true
  if (!isMod(ev)) return false
  return isKeyV(ev)
}

/**
 * Copy: Mac ⌘C (via `copy` event). Win/Linux: Ctrl+C / Ctrl+Insert with selection.
 */
function isCopyKey(ev: KeyboardEvent, hasSelection: boolean): boolean {
  if (ev.type !== 'keydown' || ev.altKey || ev.repeat || !hasSelection) return false
  if ((ev.key === 'Insert' || ev.code === 'Insert') && ev.ctrlKey && !ev.shiftKey && !ev.metaKey) return true
  if (!isKeyC(ev)) return false
  if (isMac()) return !!ev.metaKey && !ev.ctrlKey
  return isMod(ev)
}

function pasteIntoTerm(term: Terminal) {
  const text = readClipboard()
  if (text) {
    term.paste(text)
    return
  }
  void navigator.clipboard?.readText?.().then((t) => {
    if (t) term.paste(t)
  }).catch(() => {})
}

/**
 * OSC 52 payload is base64(UTF-8). `atob` alone yields a Latin-1 binary string
 * (one code unit per byte) — that is the classic Cyrillic/CJK mojibake paste bug.
 */
export function decodeOsc52Payload(b64: string): string {
  const cleaned = b64.replace(/\s+/g, '')
  if (!cleaned || cleaned === '?') return ''
  const bin = atob(cleaned)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder('utf-8').decode(bytes)
}

/** Claude Code / tmux / neovim copy via OSC 52. Needs allowProposedApi on the Terminal. */
function bindOsc52Clipboard(term: Terminal): IDisposable | null {
  try {
    return term.parser.registerOscHandler(52, (data) => {
      const sep = data.indexOf(';')
      if (sep < 0) return false
      const payload = data.slice(sep + 1)
      if (!payload || payload === '?') return false
      try {
        const text = decodeOsc52Payload(payload)
        if (text) writeClipboard(text)
      } catch { /* ignore malformed base64 */ }
      return true
    })
  } catch {
    return null
  }
}

function eventInTerminal(term: Terminal, ev: Event): boolean {
  const host = term.element
  const t = ev.target
  if (!host || !(t instanceof Node)) return false
  return host === t || host.contains(t)
}

/**
 * Copy/paste for xterm in the desktop app. Returns a disposer.
 *
 * Win/Linux: intercept Ctrl+C (with selection) / Ctrl+V — no app Edit menu.
 * Also run native textarea copy (xterm context-menu technique) so Windows
 * actually receives CF_UNICODETEXT. Clipboard writes go through main-process IPC.
 */
export function bindXtermClipboard(term: Terminal): () => void {
  const osc = bindOsc52Clipboard(term)
  const interceptKeys = interceptOsKeys()

  const tryHandleKey = (ev: KeyboardEvent): boolean => {
    // true = leave to terminal; false = we handled (caller should preventDefault)
    if (!interceptKeys) return true
    if (!eventInTerminal(term, ev)) return true
    const selected = term.getSelection()
    if (isCopyKey(ev, !!selected)) {
      if (selected) copySelection(term)
      return false
    }
    if (isPasteKey(ev)) {
      pasteIntoTerm(term)
      return false
    }
    return true
  }

  const onCustom = (ev: KeyboardEvent | { type?: string }): boolean => {
    return tryHandleKey(ev as KeyboardEvent)
  }

  term.attachCustomKeyEventHandler(onCustom)

  const host = term.element

  // Capture on the terminal host (parent of textarea).
  const onDomKey = (ev: KeyboardEvent) => {
    if (tryHandleKey(ev)) return
    ev.preventDefault()
    ev.stopPropagation()
  }

  // Window capture: Windows IME / focus quirks sometimes skip the host listener.
  const onWinKey = (ev: KeyboardEvent) => {
    if (tryHandleKey(ev)) return
    ev.preventDefault()
    ev.stopPropagation()
  }

  const onCopy = (ev: ClipboardEvent) => {
    const text = term.getSelection()
    if (!text) return
    writeClipboard(text)
    // Mac: force plain text (avoid HTML mojibake in TextEdit). Win/Linux: don't
    // cancel — a cancelled copy transaction can clear what we just wrote.
    if (!isMac()) return
    try { ev.clipboardData?.setData('text/plain', text) } catch { /* ignore */ }
    ev.preventDefault()
  }

  host?.addEventListener('keydown', onDomKey, true)
  host?.addEventListener('copy', onCopy, true)
  if (interceptKeys) {
    window.addEventListener('keydown', onWinKey, true)
  }

  return () => {
    host?.removeEventListener('keydown', onDomKey, true)
    host?.removeEventListener('copy', onCopy, true)
    if (interceptKeys) {
      window.removeEventListener('keydown', onWinKey, true)
    }
    osc?.dispose()
  }
}
