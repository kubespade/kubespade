import { useEffect, useRef, useState } from 'react'
import { Copy, PanelBottomOpen, PanelTopOpen, RefreshCw, ScrollText, WrapText, X } from 'lucide-react'
import { withAccessToken } from '../api/token'
import { ErrorReconnectBanner } from './ErrorReconnectBanner'
import { useAutoReconnect } from '../hooks/useAutoReconnect'

export interface LogsTarget {
  podName: string
  namespace?: string
  container?: string
  follow?: boolean
  activeContainers?: string[]
}

interface ContainerList {
  init: string[]
  containers: string[]
}

const TAIL_OPTIONS = [100, 200, 500, 1000, 5000] as const

function LogLine({ text }: { text: string }) {
  const m = text.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)\s(.*)$/)
  if (!m) return <div className="logs-line"><span className="logs-msg">{text}</span></div>
  const d = new Date(m[1])
  const ts = isNaN(d.getTime())
    ? m[1]
    : `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`
  return (
    <div className="logs-line">
      <span className="logs-ts">{ts}</span>
      <span className="logs-msg">{m[2]}</span>
    </div>
  )
}

export interface PodLogsViewProps {
  profile: string
  target: LogsTarget
  active?: boolean
  detached?: boolean
  onClose?: () => void
  onPopOut?: () => void
  onDock?: () => void
}

export function PodLogsView({
  profile,
  target,
  active = true,
  detached = false,
  onClose,
  onPopOut,
  onDock,
}: PodLogsViewProps) {
  const [containerList, setContainerList] = useState<ContainerList | null>(null)
  const [activeContainer, setActiveContainer] = useState(target.container ?? '')
  const [tail, setTail] = useState<number>(200)
  const [follow, setFollow] = useState(() => {
    if (target.follow === false) return false
    if (target.follow === true) return true
    if (target.activeContainers) {
      const c = target.container
      return !c || target.activeContainers.includes(c)
    }
    return true
  })
  const [previous, setPrevious] = useState(false)
  const [userOverride, setUserOverride] = useState(false)

  const isFollowable = !previous && (target.activeContainers
    ? target.activeContainers.includes(activeContainer || (target.container ?? ''))
    : true)
  const effectiveFollow = isFollowable && follow
  const [lines, setLines] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const [wrapLines, setWrapLines] = useState(false)

  const esRef = useRef<EventSource | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const autoScrollRef = useRef(true)
  const bufRef = useRef<string[]>([])
  const flushTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const reconnectParamsRef = useRef({ container: '', tail: 200, follow: false, previous: false })
  const { clear: clearAutoReconnect, schedule: scheduleAutoReconnect, onFailure: onWatchFailure, resetAttempts } =
    useAutoReconnect(() => {
      const p = reconnectParamsRef.current
      connect(p.container, p.tail, p.follow, p.previous)
    }, {
      onExhausted: () => {
        setError('Could not stream logs — stopped retrying.')
        setLoading(false)
      },
    })

  function connect(container: string, tailVal: number, followVal: boolean, previousVal: boolean) {
    clearAutoReconnect()
    reconnectParamsRef.current = { container, tail: tailVal, follow: followVal, previous: previousVal }
    esRef.current?.close()
    esRef.current = null
    if (flushTimer.current) clearInterval(flushTimer.current)
    bufRef.current = []
    setLines([])
    setLoading(true)
    setError('')
    setDone(false)
    autoScrollRef.current = true

    const qs = new URLSearchParams()
    if (target.namespace) qs.set('namespace', target.namespace)
    if (container) qs.set('container', container)
    qs.set('tail', String(tailVal))
    if (followVal && !previousVal) qs.set('follow', 'true')
    if (previousVal) qs.set('previous', 'true')

    const url = `/api/profiles/${encodeURIComponent(profile)}/k8s/pods/${encodeURIComponent(target.podName)}/logs?${qs}`
    const es = new EventSource(withAccessToken(url))
    esRef.current = es

    flushTimer.current = setInterval(() => {
      if (bufRef.current.length === 0) return
      const batch = bufRef.current.splice(0)
      setLines(prev => {
        const next = [...prev, ...batch]
        return next.length > 10_000 ? next.slice(next.length - 10_000) : next
      })
    }, 120)

    es.onmessage = e => {
      const msg = JSON.parse(e.data) as Record<string, unknown>
      if (msg.type === 'containers') {
        setContainerList({
          init: (msg.init as string[]) ?? [],
          containers: (msg.containers as string[]) ?? [],
        })
        if (!container && msg.current) setActiveContainer(msg.current as string)
      } else if (msg.type === 'line') {
        setLoading(false)
        setError('')
        resetAttempts()
        clearAutoReconnect()
        bufRef.current.push(msg.text as string)
      } else if (msg.type === 'done') {
        setLoading(false)
        setDone(true)
        es.close()
      } else if (msg.type === 'error') {
        setLoading(false)
        const message = (msg.message as string) ?? 'Error'
        setError(message)
        es.close()
        if (followVal) onWatchFailure(message)
      }
    }
    es.onerror = () => {
      setLoading(false)
      setError('Connection lost')
      if (followVal) scheduleAutoReconnect()
    }
  }

  useEffect(() => {
    const initialContainer = target.container ?? ''
    const initialFollowable = target.activeContainers
      ? (!initialContainer || target.activeContainers.includes(initialContainer))
      : follow
    connect(initialContainer, tail, initialFollowable && follow, false)
    return () => {
      esRef.current?.close()
      if (flushTimer.current) clearInterval(flushTimer.current)
    }
  }, [])

  useEffect(() => {
    if (autoScrollRef.current && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight
    }
  }, [lines])

  function handleScroll() {
    if (!bodyRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = bodyRef.current
    autoScrollRef.current = scrollHeight - scrollTop - clientHeight < 60
  }

  function switchContainer(name: string) {
    setActiveContainer(name)
    const isActive = !target.activeContainers || target.activeContainers.includes(name)
    if (!isActive || previous) {
      if (!isActive) {
        setFollow(false)
        setUserOverride(false)
      }
      connect(name, tail, false, previous)
      return
    }
    const newFollow = userOverride ? follow : true
    if (!userOverride) setFollow(true)
    connect(name, tail, newFollow, previous)
  }

  function reload() {
    connect(activeContainer, tail, effectiveFollow, previous)
  }

  function copyLogs() {
    navigator.clipboard.writeText(lines.join('\n'))
  }

  const allTabs = containerList
    ? [
        ...containerList.init.map(n => ({ name: n, init: true })),
        ...containerList.containers.map(n => ({ name: n, init: false })),
      ]
    : []

  return (
    <div className={`logs-view${active ? ' logs-view-active' : ''}${detached ? ' logs-view-detached' : ''}`}>
      <div className="logs-header">
        <div className="logs-header-left">
          <ScrollText size={13} className="logs-icon" />
          <span className="logs-pod" title={target.podName}>{target.podName}</span>
          {previous && <span className="logs-previous-badge">previous</span>}

          {allTabs.length > 1 && (
            <div className="logs-tabs">
              {allTabs.map(t => (
                <button
                  key={t.name}
                  type="button"
                  className={`logs-tab${activeContainer === t.name ? ' logs-tab-active' : ''}`}
                  onClick={() => switchContainer(t.name)}
                >
                  {t.init && <span className="logs-tab-init">init</span>}
                  {t.name}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="logs-header-right">
          <select
            className="logs-select"
            value={tail}
            onChange={e => {
              const val = Number(e.target.value)
              setTail(val)
              connect(activeContainer, val, effectiveFollow, previous)
            }}
          >
            {TAIL_OPTIONS.map(n => (
              <option key={n} value={n}>{n} lines</option>
            ))}
          </select>

          <label className="logs-toggle-label" data-tooltip="Logs from previous terminated container instance">
            <input
              type="checkbox"
              checked={previous}
              onChange={e => {
                const val = e.target.checked
                setPrevious(val)
                if (val) {
                  setFollow(false)
                  setUserOverride(true)
                  connect(activeContainer, tail, false, true)
                } else {
                  const canFollow = !target.activeContainers
                    || target.activeContainers.includes(activeContainer)
                  connect(activeContainer, tail, canFollow && follow, false)
                }
              }}
            />
            <span>Previous</span>
          </label>

          <label
            className={`logs-follow-label${!isFollowable ? ' logs-follow-disabled' : ''}`}
            data-tooltip={
              previous ? 'Unavailable with previous logs'
                : !isFollowable ? 'Container not running'
                : effectiveFollow ? 'Following' : 'Follow'
            }
          >
            <input
              type="checkbox"
              checked={effectiveFollow}
              disabled={!isFollowable}
              onChange={e => {
                const val = e.target.checked
                setUserOverride(true)
                setFollow(val)
                if (val) setPrevious(false)
                connect(activeContainer, tail, val, false)
              }}
            />
            {effectiveFollow && !done && !error && <span className="logs-live-dot" />}
          </label>

          <button
            type="button"
            className={`logs-btn${wrapLines ? ' logs-btn-active' : ''}`}
            onClick={() => setWrapLines(w => !w)}
            data-tooltip={wrapLines ? 'Disable word wrap' : 'Word wrap'}
            aria-pressed={wrapLines}
          >
            <WrapText size={14} />
          </button>
          <button type="button" className="logs-btn" onClick={reload} data-tooltip="Reload">
            <RefreshCw size={14} />
          </button>
          <button type="button" className="logs-btn" onClick={copyLogs} data-tooltip="Copy">
            <Copy size={14} />
          </button>
          {detached && onDock && (
            <button type="button" className="logs-btn" onClick={onDock} data-tooltip="Dock back">
              <PanelBottomOpen size={14} />
            </button>
          )}
          {!detached && onPopOut && (
            <button type="button" className="logs-btn" onClick={onPopOut} data-tooltip="Open above terminal">
              <PanelTopOpen size={14} />
            </button>
          )}
          {onClose && (
            <button type="button" className="logs-btn logs-btn-close" onClick={onClose} data-tooltip="Close">
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      <div
        className={`logs-body${wrapLines ? ' logs-body-wrap' : ''}`}
        ref={bodyRef}
        onScroll={handleScroll}
      >
        {loading && lines.length === 0 && (
          <div className="logs-status">Loading…</div>
        )}
        {error && (
          <ErrorReconnectBanner
            error={error}
            onReconnect={() => {
              clearAutoReconnect()
              reload()
            }}
          />
        )}
        {lines.map((line, i) => <LogLine key={i} text={line} />)}
        {done && !loading && lines.length === 0 && !error && (
          <div className="logs-status">No logs found</div>
        )}
        {done && lines.length > 0 && (
          <div className="logs-done">— end of {lines.length} lines —</div>
        )}
      </div>
    </div>
  )
}
