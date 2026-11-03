import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, ChevronUp, FolderOpen, ScrollText, Sparkles, Terminal, X } from 'lucide-react'
import { SessionTerminal } from './ExecPanel'
import type { ExecTarget } from './ExecPanel'
import { PodLogsView } from './PodLogsView'
import type { LogsTarget } from './PodLogsView'
import { PodFilesPanel, filesTabLabel } from './PodFilesPanel'
import type { FilesTarget } from './PodFilesPanel'
import { AiTerminalSession } from './AiTerminalPanel'
import { AiClientMark, type AiClientId } from '../lib/aiClient'
import type { WorkbenchExecRequest, WorkbenchLogsRequest, WorkbenchFilesRequest } from '../lib/workbenchContext'
import {
  notifyExecPanelResizeEnd,
  notifyExecPanelResizeStart,
} from '../lib/execTerminalResize'
import { useEscapeKey } from '../hooks/useEscapeKey'
import { useWorkbenchRequest } from '../hooks/useWorkbenchRequest'
import { useTabReorder } from '../hooks/useTabReorder'
import { Modal } from './Modal'

const AI_TAB_ID = 'ai'

type WorkbenchTab =
  | { id: string; kind: 'exec'; profile: string; target: ExecTarget }
  | { id: string; kind: 'logs'; profile: string; target: LogsTarget; detached: boolean }
  | { id: string; kind: 'files'; profile: string; target: FilesTarget }
  | { id: typeof AI_TAB_ID; kind: 'ai' }

interface Props {
  resourceKey: string
  execRequest: WorkbenchExecRequest | null
  logsRequest: WorkbenchLogsRequest | null
  filesRequest: WorkbenchFilesRequest | null
  aiOpen: boolean
  aiClientId: AiClientId | null
  onAiClose: () => void
}

const DOCK_HEIGHT_KEY = 'ks-workbench-h'
const DEFAULT_DOCK_HEIGHT = 45

function tabLabel(tab: WorkbenchTab): string {
  if (tab.kind === 'ai') return 'AI'
  if (tab.kind === 'exec') {
    const t = tab.target
    if (t.nodeName) return t.nodeName
    return t.container ? `${t.podName} / ${t.container}` : (t.podName ?? 'Terminal')
  }
  if (tab.kind === 'files') return filesTabLabel(tab.target)
  return tab.target.podName
}

function readDockHeight(): number {
  const raw = localStorage.getItem(DOCK_HEIGHT_KEY)
    ?? localStorage.getItem('ks-ai-dock-h')
  const n = raw ? Number(raw) : DEFAULT_DOCK_HEIGHT
  return Number.isFinite(n) ? Math.min(80, Math.max(20, n)) : DEFAULT_DOCK_HEIGHT
}

function reorderList<T extends { id: string }>(prev: T[], fromId: string, insertIndex: number): T[] {
  const from = prev.findIndex(t => t.id === fromId)
  if (from < 0) return prev
  let to = Math.max(0, Math.min(insertIndex, prev.length))
  const next = [...prev]
  const [item] = next.splice(from, 1)
  if (from < to) to -= 1
  if (to === from) return prev
  next.splice(to, 0, item!)
  return next
}

export function WorkbenchDock({
  resourceKey,
  execRequest,
  logsRequest,
  filesRequest,
  aiOpen,
  aiClientId,
  onAiClose,
}: Props) {
  const [tabs, setTabs] = useState<WorkbenchTab[]>([])
  const [activeId, setActiveId] = useState('')
  const [minimized, setMinimized] = useState(false)
  const [dockHeightPct, setDockHeightPct] = useState(readDockHeight)
  const [aiTabLabel, setAiTabLabel] = useState('AI')
  const [aiTabClientId, setAiTabClientId] = useState<AiClientId | null>(aiClientId)

  const reorderTabs = useCallback((fromId: string, insertIndex: number) => {
    setTabs(prev => reorderList(prev, fromId, insertIndex))
  }, [])

  const {
    tabsRef,
    dragTabId,
    dropHint,
    setDropHintFromTab,
    setDropHintAtEnd,
    handleTabDrop,
    clearDragState,
    clearDropHint,
    beginDrag,
  } = useTabReorder(tabs, reorderTabs)

  useEffect(() => {
    document.documentElement.style.setProperty('--workbench-dock-h', `${dockHeightPct}%`)
    document.documentElement.style.setProperty('--ai-dock-h', `${dockHeightPct}%`)
    localStorage.setItem(DOCK_HEIGHT_KEY, String(dockHeightPct))
  }, [dockHeightPct])

  useWorkbenchRequest(execRequest, req => {
    const id = `e${req.seq}`
    setTabs(prev => [...prev, {
      id,
      kind: 'exec',
      profile: req.profile,
      target: req.target,
    }])
    setActiveId(id)
    setMinimized(false)
  })

  useWorkbenchRequest(logsRequest, req => {
    const id = `l${req.seq}`
    setTabs(prev => [...prev, {
      id,
      kind: 'logs',
      profile: req.profile,
      target: req.target,
      detached: false,
    }])
    setActiveId(id)
    setMinimized(false)
  })

  useWorkbenchRequest(filesRequest, req => {
    const id = `f${req.seq}`
    setTabs(prev => [...prev, {
      id,
      kind: 'files',
      profile: req.profile,
      target: req.target,
    }])
    setActiveId(id)
    setMinimized(false)
  })

  // Sync AI tab with App sidebar toggle.
  useEffect(() => {
    if (aiOpen) {
      setTabs(prev => {
        if (prev.some(t => t.kind === 'ai')) return prev
        return [...prev, { id: AI_TAB_ID, kind: 'ai' }]
      })
      setActiveId(AI_TAB_ID)
      setMinimized(false)
      return
    }
    setTabs(prev => {
      if (!prev.some(t => t.kind === 'ai')) return prev
      return prev.filter(t => t.kind !== 'ai')
    })
    setActiveId(cur => (cur === AI_TAB_ID ? '' : cur))
  }, [aiOpen])

  // Navigating away: keep sessions, dock floating logs back into the terminal bar.
  useEffect(() => {
    setTabs(prev => prev.map(t => (
      t.kind === 'logs' && t.detached ? { ...t, detached: false } : t
    )))
  }, [resourceKey])

  const closeTab = useCallback((id: string) => {
    setTabs(prev => {
      const idx = prev.findIndex(t => t.id === id)
      if (idx < 0) return prev
      const closing = prev[idx]
      if (closing?.kind === 'ai') onAiClose()
      const next = prev.filter(t => t.id !== id)
      if (next.length === 0) {
        setActiveId('')
        return []
      }
      const fallback = next[Math.min(idx, next.length - 1)]!.id
      setActiveId(cur => (cur === id ? fallback : cur))
      return next
    })
  }, [onAiClose])

  // If AI tab was removed via aiOpen=false, pick another active tab.
  useEffect(() => {
    if (!activeId && tabs.length > 0) {
      setActiveId(tabs[tabs.length - 1]!.id)
    } else if (activeId && !tabs.some(t => t.id === activeId)) {
      setActiveId(tabs[tabs.length - 1]?.id ?? '')
    }
  }, [tabs, activeId])

  const closeActiveTab = useCallback(() => {
    if (activeId) closeTab(activeId)
  }, [activeId, closeTab])
  useEscapeKey(closeActiveTab, tabs.length > 0)

  function closeAll() {
    if (tabs.some(t => t.kind === 'ai')) onAiClose()
    setTabs([])
    setActiveId('')
  }

  function popOutLogs(id: string) {
    setTabs(prev => {
      const execTab = prev.find(t => t.kind === 'exec' || t.kind === 'ai')
      setActiveId(cur => {
        if (cur !== id) return cur
        return execTab?.id ?? cur
      })
      return prev.map(t => (
        t.id === id && t.kind === 'logs' ? { ...t, detached: true } : t
      ))
    })
  }

  function dockLogs(id: string) {
    setTabs(prev => prev.map(t => (
      t.id === id && t.kind === 'logs' ? { ...t, detached: false } : t
    )))
    setActiveId(id)
    setMinimized(false)
  }

  function startResize(e: React.MouseEvent) {
    e.preventDefault()
    notifyExecPanelResizeStart()
    const startY = e.clientY
    const startH = dockHeightPct
    document.body.classList.add('workbench-resizing')

    function onMove(ev: MouseEvent) {
      const dy = startY - ev.clientY
      const next = startH + (dy / window.innerHeight) * 100
      setDockHeightPct(Math.min(80, Math.max(20, next)))
    }

    function onUp() {
      document.body.classList.remove('workbench-resizing')
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      notifyExecPanelResizeEnd()
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  if (tabs.length === 0) return null

  const dockedTabs = tabs.filter(t =>
    t.kind === 'exec' || t.kind === 'ai' || t.kind === 'files' || (t.kind === 'logs' && !t.detached),
  )
  const detachedLogs = tabs.filter((t): t is Extract<WorkbenchTab, { kind: 'logs' }> =>
    t.kind === 'logs' && t.detached,
  )

  return createPortal(
    <>
      {detachedLogs.map(tab => (
        <Modal
          key={tab.id}
          onClose={() => dockLogs(tab.id)}
          wrapperClassName="workbench-logs-modal"
          backdropClassName="logs-backdrop logs-backdrop-above-dock"
          className="logs-panel logs-panel-floating"
          dismissTrigger="mousedown"
          closeOnEscape={false}
        >
          <PodLogsView
            profile={tab.profile}
            target={tab.target}
            active
            detached
            onDock={() => dockLogs(tab.id)}
            onClose={() => closeTab(tab.id)}
          />
        </Modal>
      ))}

      <div
        className={`workbench-dock${minimized ? ' workbench-dock-minimized' : ''}${detachedLogs.length ? ' workbench-dock-has-float' : ''}`}
        style={{ ['--workbench-dock-h' as string]: `${dockHeightPct}%` }}
      >
        {!minimized && (
          <div
            className="workbench-resize-handle"
            onMouseDown={startResize}
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize terminal panel"
          />
        )}

        <div className="workbench-header">
          <div
            ref={tabsRef}
            className={`workbench-tabs${dragTabId ? ' workbench-tabs-dragging' : ''}`}
            onDragOver={e => {
              setDropHintAtEnd(e)
            }}
            onDragLeave={e => {
              if (!tabsRef.current?.contains(e.relatedTarget as Node)) clearDropHint()
            }}
            onDrop={handleTabDrop}
          >
            {dropHint != null && (
              <div
                className="workbench-tab-drop-indicator"
                style={{ left: dropHint.indicatorX }}
                aria-hidden
              />
            )}
            {tabs.map((tab, tabIndex) => {
              const label = tab.kind === 'ai' ? aiTabLabel : tabLabel(tab)
              return (
              <button
                key={tab.id}
                type="button"
                className={`workbench-tab workbench-tab-${tab.kind}${tab.id === activeId ? ' workbench-tab-active' : ''}${tab.kind === 'logs' && tab.detached ? ' workbench-tab-detached' : ''}${dragTabId === tab.id ? ' workbench-tab-dragging' : ''}`}
                onClick={() => { setActiveId(tab.id); setMinimized(false) }}
                onDragOver={e => setDropHintFromTab(e, tabIndex)}
                onDrop={handleTabDrop}
              >
                <span
                  className="workbench-tab-drag"
                  draggable
                  title={label}
                  onDragStart={e => beginDrag(e, tab.id)}
                  onDragEnd={clearDragState}
                >
                  {tab.kind === 'exec'
                    ? <Terminal size={12} className="workbench-tab-icon" />
                    : tab.kind === 'logs'
                      ? <ScrollText size={12} className="workbench-tab-icon" />
                      : tab.kind === 'files'
                        ? <FolderOpen size={12} className="workbench-tab-icon" />
                        : (
                        <span className="workbench-tab-icon">
                          {aiTabClientId
                            ? <AiClientMark id={aiTabClientId} size={12} />
                            : <Sparkles size={12} />}
                        </span>
                      )}
                  <span className="workbench-tab-label">{label}</span>
                </span>
                <span
                  className="workbench-tab-close"
                  title="Close tab"
                  onMouseDown={e => { e.stopPropagation(); closeTab(tab.id) }}
                >
                  ×
                </span>
              </button>
            )})}
          </div>
          <div className="workbench-actions">
            <button
              type="button"
              className="workbench-btn"
              onClick={() => setMinimized(m => !m)}
              data-tooltip={minimized ? 'Restore' : 'Minimize'}
            >
              {minimized ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
            <button type="button" className="workbench-btn workbench-btn-close" onClick={closeAll} data-tooltip="Close all">
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Keep sessions mounted while minimized — unmounting killed AI/exec PTYs. */}
        <div className="workbench-body" aria-hidden={minimized || undefined}>
          {dockedTabs.map(tab => {
            if (tab.kind === 'ai') {
              return (
                <AiTerminalSession
                  key={tab.id}
                  clientId={aiClientId}
                  active={tab.id === activeId}
                  onNeedsAttention={() => { setActiveId(AI_TAB_ID); setMinimized(false) }}
                  onStatus={s => {
                    setAiTabLabel(s.agentName)
                    setAiTabClientId(s.agentId)
                  }}
                />
              )
            }
            if (tab.kind === 'exec') {
              return (
                <SessionTerminal
                  key={tab.id}
                  profile={tab.profile}
                  target={tab.target}
                  active={tab.id === activeId}
                  onSessionEnd={() => closeTab(tab.id)}
                />
              )
            }
            if (tab.kind === 'files') {
              return (
                <PodFilesPanel
                  key={tab.id}
                  profile={tab.profile}
                  target={tab.target}
                  active={tab.id === activeId}
                />
              )
            }
            return (
              <PodLogsView
                key={tab.id}
                profile={tab.profile}
                target={tab.target}
                active={tab.id === activeId}
                onPopOut={() => popOutLogs(tab.id)}
              />
            )
          })}
        </div>
      </div>
    </>,
    document.body,
  )
}
