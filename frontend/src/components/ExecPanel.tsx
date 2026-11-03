import { useEffect, useRef, useState } from 'react'
import { useEscapeKey } from '../hooks/useEscapeKey'
import { createPortal } from 'react-dom'
import { ArrowDownToLine, ArrowUpFromLine, ChevronDown, ChevronUp, FolderOpen, Terminal, X } from 'lucide-react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { withAccessToken } from '../api/token'
import { api } from '../api/client'
import { buildContainerTabs, ContainerTabs } from './ContainerTabs'
import { usePodContainers } from '../hooks/usePodContainers'
import { pickLocalPullPath, usePodFileTransfer } from '../hooks/usePodFileTransfer'
import { createExecResizeSender, scheduleTerminalFit, bindExecPanelResizeBridge } from '../lib/execTerminalResize'
import {
  consumeCwdOsc,
  remoteBasename,
  shortenPodPath,
  type CwdOscCarry,
} from '../lib/execCwd'
import { bindXtermClipboard } from '../lib/xtermClipboard'
import { getXtermTheme } from '../lib/xtermTheme'
import { useXtermThemeSync } from '../hooks/useXtermThemeSync'

export interface ExecTarget {
  podName?: string
  nodeName?: string
  namespace?: string
  container?: string
}

interface Session {
  id: string
  target: ExecTarget
}

const SHELLS = ['/bin/bash', '/bin/sh', '/bin/ash']

// ── Single session terminal ───────────────────────────────────────────────────

interface SessionProps {
  profile: string
  target: ExecTarget
  active: boolean
  onSessionEnd: () => void
}

export function SessionTerminal({ profile, target, active, onSessionEnd }: SessionProps) {
  const isNodeExec = !!target.nodeName
  const {
    containerList,
    activeContainer,
    setActiveContainer,
    error: containersError,
  } = usePodContainers(
    profile,
    target.podName,
    target.namespace,
    target.container,
    !isNodeExec,
  )
  const [shell, setShell] = useState('/bin/bash')
  const [connected, setConnected] = useState(false)
  const [sessionError, setSessionError] = useState('')
  const [podCwd, setPodCwd] = useState('/')
  const [cwdKnown, setCwdKnown] = useState(false)
  const [dropArmed, setDropArmed] = useState(false)
  const [pullOpen, setPullOpen] = useState(false)
  const [pullPath, setPullPath] = useState('/')

  const activeContainerRef = useRef(activeContainer)
  activeContainerRef.current = activeContainer
  const podCwdRef = useRef(podCwd)
  podCwdRef.current = podCwd

  const transfer = usePodFileTransfer({
    profile,
    podName: target.podName,
    namespace: target.namespace,
    getContainer: () => activeContainerRef.current,
    getRemoteDir: () => podCwdRef.current || '/',
  })
  const transferBusy = transfer.busy
  const transferMsg = transfer.message
  const error = transfer.error || sessionError

  const termRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<XTerm | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const resizeSenderRef = useRef<ReturnType<typeof createExecResizeSender> | null>(null)
  const onSessionEndRef = useRef(onSessionEnd)
  const sessionEndedRef = useRef(false)
  const cwdCarryRef = useRef<CwdOscCarry>('')
  const textDecoderRef = useRef(new TextDecoder())
  useEffect(() => { onSessionEndRef.current = onSessionEnd }, [onSessionEnd])
  useXtermThemeSync(xtermRef)

  function handleSessionClosed(msg: string) {
    if (sessionEndedRef.current) return
    sessionEndedRef.current = true
    setConnected(false)
    if (msg && msg !== 'context canceled') setSessionError(msg)
    else onSessionEndRef.current()
  }

  // Init xterm once on mount
  useEffect(() => {
    if (!termRef.current) return
    const mono = getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim()
      || 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace'
    const term = new XTerm({
      theme: getXtermTheme(),
      fontFamily: mono,
      fontSize: 13,
      lineHeight: 1.5,
      cursorBlink: true,
      allowProposedApi: true, // OSC 52 clipboard (tmux / nvim / AI CLIs)
    })
    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(termRef.current)
    fitAddon.fit()
    bindXtermClipboard(term)
    xtermRef.current = term
    fitRef.current = fitAddon

    function sendResizePacket(cols: number, rows: number) {
      const ws = wsRef.current
      if (!ws || ws.readyState !== WebSocket.OPEN) return
      const payload = new TextEncoder().encode(JSON.stringify({ w: cols, h: rows }))
      const pkt = new Uint8Array(1 + payload.length)
      pkt[0] = 2
      pkt.set(payload, 1)
      ws.send(pkt)
    }
    resizeSenderRef.current = createExecResizeSender(sendResizePacket)

    term.onData((data: string) => {
      const ws = wsRef.current
      if (!ws || ws.readyState !== WebSocket.OPEN) return
      const encoded = new TextEncoder().encode(data)
      const pkt = new Uint8Array(1 + encoded.length)
      pkt[0] = 0
      pkt.set(encoded, 1)
      ws.send(pkt)
    })

    // Local fit only — remote SIGWINCH synced on connect + panel drag end (see bindExecPanelResizeBridge).

    const fitSoon = scheduleTerminalFit(() => fitAddon.fit())
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        if (entry.contentRect.width > 0 && entry.contentRect.height > 0) fitSoon()
      }
    })
    observer.observe(termRef.current)

    const unbindPanelResize = bindExecPanelResizeBridge({
      pause: () => resizeSenderRef.current?.pause(),
      resume: () => resizeSenderRef.current?.resume(),
      flush: (cols, rows) => resizeSenderRef.current?.flush(cols, rows),
      fit: () => fitAddon.fit(),
      cols: () => term.cols,
      rows: () => term.rows,
    })

    return () => {
      unbindPanelResize()
      observer.disconnect()
      // Mark ended + drop handlers before close so a late onclose (code 1000)
      // cannot re-enter closeTab with a stale activeId and crash the UI.
      sessionEndedRef.current = true
      const ws = wsRef.current
      if (ws) {
        ws.onopen = null
        ws.onmessage = null
        ws.onerror = null
        ws.onclose = null
        try { ws.close() } catch { /* ignore */ }
      }
      term.dispose()
      xtermRef.current = null
      fitRef.current = null
      wsRef.current = null
    }
  }, [])

  // Refit when this tab becomes visible after being hidden
  useEffect(() => {
    if (active) requestAnimationFrame(() => fitRef.current?.fit())
  }, [active])

  useEffect(() => {
    if (containersError) setSessionError(containersError)
  }, [containersError])

  // Node exec: connect immediately on mount
  useEffect(() => {
    if (isNodeExec) connectNode()
  }, [isNodeExec])

  function buildWsUrl(container: string, sh: string): string {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const base = `${proto}//${window.location.host}/api/profiles/${encodeURIComponent(profile)}`
    if (isNodeExec) {
      return `${base}/k8s/nodes/${encodeURIComponent(target.nodeName!)}/exec`
    }
    const qs = new URLSearchParams()
    if (target.namespace) qs.set('namespace', target.namespace)
    qs.set('container', container)
    qs.set('shell', sh)
    return `${base}/k8s/pods/${encodeURIComponent(target.podName!)}/exec?${qs}`
  }

  function connectNode() { connectWs('', shell) }

  function connect(container: string, sh: string) {
    if (!container && !isNodeExec) return
    connectWs(container, sh)
  }

  function connectWs(container: string, sh: string) {
    const prev = wsRef.current
    if (prev) {
      prev.onopen = null
      prev.onmessage = null
      prev.onerror = null
      prev.onclose = null
      try { prev.close() } catch { /* ignore */ }
    }
    wsRef.current = null
    sessionEndedRef.current = false
    cwdCarryRef.current = ''
    setConnected(false)
    setSessionError('')
    transfer.setError('')
    setPodCwd('/')
    setCwdKnown(false)
    setPullOpen(false)
    transfer.setMessage('')
    if (!xtermRef.current) return
    xtermRef.current.clear()

    const url = withAccessToken(buildWsUrl(container, sh))

    const ws = new WebSocket(url)
    ws.binaryType = 'arraybuffer'
    wsRef.current = ws

    const term = xtermRef.current

    ws.onopen = () => {
      setConnected(true)
      setSessionError('')
      transfer.setError('')
      resizeSenderRef.current?.reset()
      resizeSenderRef.current?.flush(term.cols, term.rows)
    }

    ws.onmessage = evt => {
      if (sessionEndedRef.current || xtermRef.current !== term) return
      const data = new Uint8Array(evt.data as ArrayBuffer)
      if (data[0] === 1) {
        const raw = textDecoderRef.current.decode(data.slice(1), { stream: true })
        const parsed = consumeCwdOsc(raw, cwdCarryRef.current)
        cwdCarryRef.current = parsed.carry
        if (parsed.cwd) {
          setPodCwd(parsed.cwd)
          setCwdKnown(true)
        }
        if (parsed.text) term.write(parsed.text)
      } else if (data[0] === 3) {
        handleSessionClosed(new TextDecoder().decode(data.slice(1)).trim())
      }
    }

    ws.onerror = () => {
      // Prefer onclose reason when present; keep a readable fallback.
      setSessionError(prev => prev || 'WebSocket connection failed')
    }
    ws.onclose = (ev) => {
      if (sessionEndedRef.current) return
      const reason = (ev.reason || '').trim()
      if (ev.code === 1000 && !reason) handleSessionClosed('')
      else {
        setConnected(false)
        if (reason) setSessionError(reason)
      }
    }
  }

  useEffect(() => {
    if (!activeContainer) return
    if (!isNodeExec) {
      if (!containerList) return
      if (!(containerList.running ?? []).includes(activeContainer)) return
    }
    connect(activeContainer, shell)
  }, [activeContainer, containerList])

  function openPull() {
    setPullPath(podCwd || '/')
    setPullOpen(true)
  }

  async function confirmPull() {
    if (isNodeExec || !activeContainer || !target.podName || transferBusy) return
    const remotePath = (pullPath || podCwd || '/').trim() || '/'
    setPullOpen(false)
    transfer.setBusy(true)
    transfer.setMessage('')
    transfer.setError('')
    setSessionError('')
    try {
      const st = await api.statPodFile(profile, target.podName, {
        namespace: target.namespace,
        container: activeContainer,
        remotePath,
      })
      if (st.kind === 'missing') throw new Error(`Not found: ${remotePath}`)
      const kind = st.kind === 'file' ? 'file' : 'dir'
      const picked = await pickLocalPullPath(kind, remoteBasename(remotePath))
      if (!picked.ok) {
        if (picked.reason === 'unavailable') transfer.setError('Native dialogs unavailable')
        return
      }
      // Only show Pulling after the user picked a destination.
      transfer.setMessage('Pulling…')
      await api.pullPodFile(profile, target.podName, {
        namespace: target.namespace,
        container: activeContainer,
        remotePath,
        localPath: picked.path,
      })
      transfer.setMessage('Done')
      setTimeout(() => transfer.setMessage(''), 1600)
    } catch (e: unknown) {
      transfer.setError(e instanceof Error ? e.message : 'Transfer failed')
      transfer.setMessage('')
    } finally {
      transfer.setBusy(false)
    }
  }

  function remoteDirLabel() {
    return cwdKnown ? podCwd : (podCwd || '/')
  }

  const allTabs = buildContainerTabs(containerList)
  const fileTransferReady = !isNodeExec && connected && !!activeContainer && !!target.podName

  return (
    <div className={`exec-session${active ? ' exec-session-active' : ''}`}>
      <div className="exec-session-bar">
        <ContainerTabs
          tabs={allTabs}
          active={activeContainer}
          variant="exec"
          onSelect={name => {
            setActiveContainer(name)
            connect(name, shell)
          }}
        />
        {fileTransferReady && (
          <div className="exec-cwd-group">
            <span
              className={`exec-cwd-chip${cwdKnown ? '' : ' exec-cwd-chip-guess'}`}
              title={cwdKnown ? podCwd : 'Working directory (updates after each prompt)'}
            >
              <FolderOpen size={12} strokeWidth={2} aria-hidden />
              <span className="exec-cwd-path">{shortenPodPath(podCwd || '/')}</span>
            </span>
            <button
              type="button"
              className="exec-xfer-btn"
              disabled={transferBusy}
              onClick={openPull}
              data-tooltip="Pull from pod"
              title="Pull from pod"
            >
              <ArrowDownToLine size={13} strokeWidth={2} />
              <span>Pull</span>
            </button>
            <button
              type="button"
              className="exec-xfer-btn"
              disabled={transferBusy}
              onClick={() => {
                if (isNodeExec || !activeContainer || transferBusy) return
                void transfer.openPushDialog(remoteDirLabel())
              }}
              data-tooltip={`Push into ${remoteDirLabel()}`}
              title={`Push into ${remoteDirLabel()}`}
            >
              <ArrowUpFromLine size={13} strokeWidth={2} />
              <span>Push</span>
            </button>
            {transferMsg && <span className="exec-xfer-status">{transferMsg}</span>}
          </div>
        )}
        <div className="exec-session-right">
          {!isNodeExec && (
            <select className="exec-select" value={shell} onChange={e => { setShell(e.target.value); connect(activeContainer, e.target.value) }} title="Shell">
              {SHELLS.map(s => <option key={s} value={s}>{s.split('/').pop()}</option>)}
            </select>
          )}
          {connected && <span className="exec-live-dot" />}
          {error && (
            <span className="exec-error-text" data-tooltip={error} title={error}>{error}</span>
          )}
          {!connected && (
            <button className="exec-btn" onClick={() => isNodeExec ? connectNode() : connect(activeContainer, shell)} data-tooltip="Reconnect">↺</button>
          )}
        </div>
      </div>
      {pullOpen && (
        <div className="exec-pull-bar">
          <label className="exec-pull-label">
            Remote path
            <input
              className="exec-pull-input"
              value={pullPath}
              autoFocus
              onChange={e => setPullPath(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') void confirmPull()
                if (e.key === 'Escape') setPullOpen(false)
              }}
            />
          </label>
          <button type="button" className="exec-xfer-btn exec-xfer-btn-primary" disabled={transferBusy} onClick={() => void confirmPull()}>
            Pull
          </button>
          <button type="button" className="exec-btn" onClick={() => setPullOpen(false)} aria-label="Cancel pull">
            <X size={14} />
          </button>
        </div>
      )}
      <div
        className={`exec-term-wrap${dropArmed ? ' exec-term-wrap-drop' : ''}`}
        onDragEnter={e => {
          if (isNodeExec || !connected) return
          e.preventDefault()
          setDropArmed(true)
        }}
        onDragOver={e => {
          if (isNodeExec || !connected) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
          setDropArmed(true)
        }}
        onDragLeave={e => {
          if (e.currentTarget.contains(e.relatedTarget as Node)) return
          setDropArmed(false)
        }}
        onDrop={e => {
          setDropArmed(false)
          if (isNodeExec || !connected) return
          void transfer.handleFileDrop(e)
        }}
      >
        <div ref={termRef} className="exec-term" />
        {dropArmed && fileTransferReady && (
          <div className="exec-drop-hint" aria-hidden>
            Drop to upload into <code>{remoteDirLabel()}</code>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Tab panel ─────────────────────────────────────────────────────────────────

interface Props {
  profile: string
  openTarget: ExecTarget | null
  onClose: () => void
  embedded?: boolean
  showMinimize?: boolean
  minimized?: boolean
  onMinimizedChange?: (minimized: boolean) => void
}

export function ExecPanel({
  profile,
  openTarget,
  onClose,
  embedded = false,
  showMinimize = true,
  minimized: minimizedProp,
  onMinimizedChange,
}: Props) {
  const [sessions, setSessions] = useState<Session[]>([])
  const [activeId, setActiveId] = useState('')
  const [minimizedLocal, setMinimizedLocal] = useState(false)
  const minimized = minimizedProp ?? minimizedLocal
  const toggleMinimized = () => {
    const next = !minimized
    if (onMinimizedChange) onMinimizedChange(next)
    else setMinimizedLocal(next)
  }
  const restoreFromMinimized = () => {
    if (minimized) {
      if (onMinimizedChange) onMinimizedChange(false)
      else setMinimizedLocal(false)
    }
  }
  const prevTargetRef = useRef<ExecTarget | null>(null)

  useEscapeKey(onClose, !embedded)

  useEffect(() => {
    if (!openTarget || openTarget === prevTargetRef.current) return
    prevTargetRef.current = openTarget
    const id = `s${Date.now()}`
    setSessions(prev => [...prev, { id, target: openTarget }])
    setActiveId(id)
    restoreFromMinimized()
  }, [openTarget])

  function closeTab(id: string) {
    setSessions(prev => {
      const idx = prev.findIndex(s => s.id === id)
      if (idx < 0) return prev
      const next = prev.filter(s => s.id !== id)
      if (next.length === 0) {
        // Defer parent unmount — never call setState of a parent inside this updater.
        queueMicrotask(() => onClose())
        return []
      }
      const fallback = next[Math.min(idx, next.length - 1)]!.id
      setActiveId(cur => (cur === id ? fallback : cur))
      return next
    })
  }

  function tabLabel(t: ExecTarget) {
    if (t.nodeName) return t.nodeName
    return t.container ? `${t.podName} / ${t.container}` : (t.podName ?? '')
  }

  if (sessions.length === 0) return null

  const panel = (
    <div className={`exec-panel${minimized ? ' exec-panel-minimized' : ''}${embedded ? ' exec-panel-embedded' : ''}`}>
      <div className="exec-header">
        <div className="exec-header-left">
          <Terminal size={13} className="exec-icon" />
          <div className="exec-tabs">
            {sessions.map(s => (
              <button
                key={s.id}
                className={`exec-tab${s.id === activeId ? ' exec-tab-active' : ''}`}
                onClick={() => { setActiveId(s.id); restoreFromMinimized() }}
              >
                <span className="exec-tab-label">{tabLabel(s.target)}</span>
                <span className="exec-tab-close" onMouseDown={e => { e.stopPropagation(); closeTab(s.id) }}>×</span>
              </button>
            ))}
          </div>
        </div>
        <div className="exec-header-right">
          {showMinimize && (
            <button className="exec-btn" onClick={toggleMinimized} data-tooltip={minimized ? 'Restore' : 'Minimize'}>
              {minimized ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
          )}
          <button className="exec-btn exec-btn-close" onClick={onClose} data-tooltip="Close all">
            <X size={14} />
          </button>
        </div>
      </div>

      <div className="exec-sessions">
        {sessions.map(s => (
          <SessionTerminal key={s.id} profile={profile} target={s.target} active={s.id === activeId} onSessionEnd={() => closeTab(s.id)} />
        ))}
      </div>
    </div>
  )

  if (embedded) return panel

  return createPortal(panel, document.body)
}
