import { useEffect, useRef, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { scheduleTerminalFit, createExecResizeSender, bindExecPanelResizeBridge } from '../lib/execTerminalResize'
import { bindXtermClipboard } from '../lib/xtermClipboard'
import { getXtermTheme, termColors } from '../lib/xtermTheme'
import { AiClientMark, isAiClientId, type AiClientId } from '../lib/aiClient'
import { useXtermThemeSync } from '../hooks/useXtermThemeSync'
import { ConfirmDialog } from './ConfirmDialog'

export interface AiClusterInfo {
  context: string
  profile: string
  label: string
}

export interface AiAgentInfo {
  id: string
  name: string
  path: string
  mcp: string
}

type Phase = 'idle' | 'detecting' | 'missing' | 'starting' | 'running' | 'ended' | 'error'

const AI_SCROLLBACK = 10_000

interface ApprovalRequest {
  id: string
  tool: string
  summary: string
  detail: string
}

function aiApi() {
  return window.kubespade?.ai
}

export interface AiSessionStatus {
  agentName: string
  agentId: AiClientId | null
  statusLabel: string
  path?: string
  clusterTitle?: string
}

interface Props {
  /** Preferred AI CLI from Settings / first-run picker. */
  clientId: AiClientId | null
  /** False while another workbench tab is focused — session stays alive. */
  active: boolean
  onStatus?: (status: AiSessionStatus) => void
  /** Called when the user should be shown the dock (e.g. approval). */
  onNeedsAttention?: () => void
}

/** AI PTY session body for the shared workbench dock (no own chrome). */
export function AiTerminalSession({ clientId, active, onStatus, onNeedsAttention }: Props) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState('')
  const [activeAgent, setActiveAgent] = useState<AiAgentInfo | null>(null)
  const [clusterCount, setClusterCount] = useState(0)
  const [clusters, setClusters] = useState<AiClusterInfo[]>([])
  const [approval, setApproval] = useState<ApprovalRequest | null>(null)

  const [sessionKey, setSessionKey] = useState(0)
  const termRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<XTerm | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const resizeSenderRef = useRef<ReturnType<typeof createExecResizeSender> | null>(null)
  const unsubRef = useRef<Array<() => void>>([])
  const activeRef = useRef(active)
  const phaseRef = useRef<Phase>('idle')
  activeRef.current = active
  phaseRef.current = phase

  const fitSoon = useRef(scheduleTerminalFit(() => {
    try { fitRef.current?.fit() } catch { /* ignore */ }
    const t = xtermRef.current
    if (t) resizeSenderRef.current?.scheduleResize(t.cols, t.rows)
  }))

  function dropListeners() {
    for (const u of unsubRef.current) {
      try { u() } catch { /* ignore */ }
    }
    unsubRef.current = []
  }

  function resetTerminal() {
    const t = xtermRef.current
    if (!t) return
    try { t.reset() } catch { /* ignore */ }
    try { t.clear() } catch { /* ignore */ }
  }

  useXtermThemeSync(xtermRef)

  useEffect(() => {
    let cancelled = false
    let bootGen = 0

    async function launch(preferred: AiClientId | null) {
      const api = aiApi()
      if (!api) {
        setPhase('error')
        setError('AI terminal is only available in the KubeSpade desktop app.')
        return
      }
      if (!preferred) {
        setPhase('error')
        setError('No AI client selected. Choose one in Settings → AI assistant.')
        return
      }

      const gen = ++bootGen
      setPhase('starting')
      setError('')

      for (let i = 0; i < 20; i++) {
        await new Promise<void>(r => requestAnimationFrame(() => r()))
        if (cancelled || gen !== bootGen) return
        if (termRef.current) break
      }
      if (!termRef.current) {
        setPhase('error')
        setError('Terminal view failed to mount. Close and reopen the AI tab.')
        return
      }

      if (!xtermRef.current) {
        const term = new XTerm({
          cursorBlink: true,
          fontSize: 13,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
          theme: getXtermTheme(),
          allowProposedApi: true,
          scrollback: AI_SCROLLBACK,
          // Cursor Agent / Ink do not speak bracketed paste — send raw clipboard text.
          ignoreBracketedPasteMode: true,
        })
        const fit = new FitAddon()
        term.loadAddon(fit)
        term.open(termRef.current)
        fit.fit()
        bindXtermClipboard(term)
        xtermRef.current = term
        fitRef.current = fit
        resizeSenderRef.current = createExecResizeSender((c, r) => {
          void aiApi()?.resize(c, r)
        }, 500)
        term.onData(data => {
          if (phaseRef.current !== 'running') return
          api.input(data)
        })
      } else {
        resetTerminal()
      }

      dropListeners()
      unsubRef.current.push(
        api.onOutput(data => {
          xtermRef.current?.write(typeof data === 'string' ? data : String(data))
        }),
        api.onExit(() => setPhase('ended')),
        api.onApprovalNeeded?.(req => {
          setApproval(req as ApprovalRequest)
          onNeedsAttention?.()
        }) ?? (() => {}),
      )

      const cols = xtermRef.current?.cols ?? 120
      const rows = xtermRef.current?.rows ?? 30
      const result = await api.start({ cols, rows, clientId: preferred })
      if (cancelled || gen !== bootGen) return

      if (result?.needsChoice || !result?.ok) {
        const agents = result?.detect?.agents ?? []
        const stillThere = agents.some(a => a.id === preferred)
        setPhase(!agents.length ? 'missing' : 'error')
        setError(
          stillThere
            ? (result?.error || 'Failed to start AI client')
            : `${preferred} is not installed on PATH anymore. Pick another client in Settings → AI assistant.`,
        )
        return
      }

      setActiveAgent(result.agent ?? null)
      setClusterCount(result.clusterCount ?? 0)
      setClusters(result.clusters ?? [])
      setPhase('running')
      if (activeRef.current) {
        try { xtermRef.current?.focus() } catch { /* ignore */ }
      }
    }

    void launch(clientId)

    return () => {
      cancelled = true
      bootGen += 1
      dropListeners()
      void aiApi()?.stop?.()
      if (xtermRef.current) {
        xtermRef.current.dispose()
        xtermRef.current = null
        fitRef.current = null
        resizeSenderRef.current?.reset()
        resizeSenderRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionKey])

  useEffect(() => {
    const t = xtermRef.current
    if (!t) return
    const live = phase === 'running' || phase === 'starting' || phase === 'detecting'
    t.options.disableStdin = !live
    t.options.cursorBlink = live
    if (!live) {
      try { t.blur() } catch { /* ignore */ }
    } else if (active) {
      try { t.focus() } catch { /* ignore */ }
    }
  }, [phase, active])

  useEffect(() => {
    if (!active || phase !== 'running') return
    const el = termRef.current
    const term = xtermRef.current
    if (!el || !term) return
    const sender = resizeSenderRef.current
    try { fitRef.current?.fit() } catch { /* ignore */ }
    // Seed without SIGWINCH — Cursor Agent on Windows drops stdin after a ConPTY redraw.
    sender?.seed(term.cols, term.rows)
    const unbind = bindExecPanelResizeBridge({
      pause: () => sender?.pause(),
      resume: () => sender?.resume(),
      flush: (c, r) => sender?.flush(c, r),
      fit: () => { try { fitRef.current?.fit() } catch { /* ignore */ } },
      cols: () => xtermRef.current?.cols ?? 0,
      rows: () => xtermRef.current?.rows ?? 0,
    })
    const ro = new ResizeObserver(() => fitSoon.current())
    ro.observe(el)
    try { term.focus() } catch { /* ignore */ }
    return () => {
      unbind()
      ro.disconnect()
    }
  }, [active, phase])

  useEffect(() => {
    const agentId = isAiClientId(activeAgent?.id) ? activeAgent.id : clientId
    const statusLabel =
      phase === 'missing' ? 'No AI CLI found'
        : phase === 'detecting' || phase === 'starting' ? 'Starting…'
          : phase === 'error' ? 'Error'
            : phase === 'ended' ? 'Session ended'
              : clusterCount === 0
                ? 'No clusters connected'
                : `${clusterCount} cluster${clusterCount === 1 ? '' : 's'} in context`
    onStatus?.({
      agentName: activeAgent?.name || 'AI',
      agentId,
      statusLabel,
      path: activeAgent?.path,
      clusterTitle: clusters.map(c => c.context).join(', ') || undefined,
    })
  }, [phase, activeAgent, clusterCount, clusters, clientId, onStatus])

  function respondApproval(approved: boolean) {
    if (!approval) return
    void aiApi()?.respondApproval?.({ id: approval.id, approved })
    setApproval(null)
  }

  return (
    <div
      className={`ai-terminal-session${active ? ' ai-terminal-session-active' : ''}`}
    >
      <div className="ai-terminal-session-bar">
        {isAiClientId(activeAgent?.id) || clientId
          ? <AiClientMark id={(isAiClientId(activeAgent?.id) ? activeAgent!.id : clientId)!} size={12} />
          : <Sparkles size={12} />}
        <span className="ai-terminal-session-name">{activeAgent?.name || 'AI'}</span>
        <span
          className="ai-status-pill"
          title={clusters.map(c => c.context).join(', ') || undefined}
        >
          {phase === 'missing' ? 'No AI CLI found'
            : phase === 'detecting' || phase === 'starting' ? 'Starting…'
              : phase === 'error' ? 'Error'
                : phase === 'ended' ? 'Session ended'
                  : clusterCount === 0
                    ? 'No clusters connected'
                    : `${clusterCount} cluster${clusterCount === 1 ? '' : 's'} in context`}
        </span>
        {activeAgent?.path && phase === 'running' && (
          <span className="ai-claude-path" title={activeAgent.path}>{activeAgent.path}</span>
        )}
      </div>

      <div className="ai-terminal-body">
        {phase === 'missing' && (
          <div className="ai-terminal-message">
            <p><strong>No supported AI CLI found on this system</strong></p>
            <p>
              Install one of: <strong>Claude Code</strong> (<code>claude</code>),{' '}
              <strong>Gemini CLI</strong> (<code>gemini</code>),{' '}
              <strong>Codex CLI</strong> (<code>codex</code>),{' '}
              <strong>GitHub Copilot</strong> (<code>copilot</code>), or{' '}
              <strong>Cursor Agent</strong> (<code>agent</code>) on your PATH, then reopen this tab.
            </p>
            <p className="ai-terminal-hint">
              Works on macOS, Windows, and Linux. Common locations: Homebrew, npm global,{' '}
              <code>~/.local/bin</code>.
            </p>
          </div>
        )}
        {phase === 'error' && (
          <div className="ai-terminal-message">
            <p><strong>Could not start AI session</strong></p>
            <p>{error || 'Unknown error'}</p>
          </div>
        )}
        <div
          ref={termRef}
          className="exec-term"
          onMouseDown={() => {
            try { xtermRef.current?.focus() } catch { /* ignore */ }
          }}
          style={{
            display: phase === 'missing' || phase === 'error' ? 'none' : undefined,
            background: termColors().background,
            pointerEvents: phase === 'ended' ? 'none' : undefined,
          }}
        />
        {(phase === 'detecting' || phase === 'starting') && (
          <div className="ai-terminal-message ai-terminal-overlay">
            <p>Preparing cluster tools and launching…</p>
          </div>
        )}
        {phase === 'ended' && (
          <div className="ai-terminal-ended">
            Session ended.
            <button
              type="button"
              className="ai-terminal-restart"
              onClick={() => {
                setPhase('idle')
                setError('')
                setSessionKey(k => k + 1)
              }}
            >
              Restart
            </button>
          </div>
        )}
      </div>

      {approval && (
        <ConfirmDialog
          title="Allow AI write?"
          message={`${approval.summary}\n\n${approval.detail}`}
          confirmLabel="Approve"
          danger
          wide
          onConfirm={() => respondApproval(true)}
          onCancel={() => respondApproval(false)}
        />
      )}
    </div>
  )
}
