import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useEventSource } from '../hooks/useEventSource'

interface Props {
  title: string
  url: string
  onClose: () => void
  /** Open a stuck / listed pod (ns/name) from the drain log. */
  onPodClick?: (namespace: string, name: string) => void
}

function parsePodRefLine(line: string): { ns: string; name: string } | null {
  const m = line.match(/^\s{2,4}([^/\s]+)\/([^\s/]+)\s*$/)
  if (!m) return null
  return { ns: m[1]!, name: m[2]! }
}

function lineClass(l: string) {
  if (l.startsWith('ERROR')) return 'nal-error'
  if (l.startsWith('  Skipping') || l.startsWith('    Evicted') || l.startsWith('    Still')) return 'nal-muted'
  if (l.startsWith('Drain complete')) return 'nal-success'
  return ''
}

function renderLine(l: string, onPodClick?: Props['onPodClick']): ReactNode {
  const ref = onPodClick ? parsePodRefLine(l) : null
  if (!ref) return l
  const indent = l.match(/^\s*/)?.[0] ?? ''
  return (
    <>
      {indent}
      <button
        type="button"
        className="nal-pod-link"
        onClick={() => onPodClick!(ref.ns, ref.name)}
        title={`Open ${ref.ns}/${ref.name}`}
      >
        {ref.ns}/{ref.name}
      </button>
    </>
  )
}

export function NodeActionLog({ title, url, onClose, onPodClick }: Props) {
  const [lines, setLines] = useState<string[]>([])
  const [done, setDone] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setLines([])
    setDone(false)
  }, [url])

  useEventSource(url, {
    onMessage: (e, es) => {
      if (e.data === '__done__') {
        setDone(true)
        es.close()
        return
      }
      setLines(prev => [...prev, e.data])
    },
    onError: (_e, es) => {
      setLines(prev => [...prev, 'Connection lost.'])
      setDone(true)
      es.close()
    },
  })

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [lines])

  return createPortal(
    <div className="nal-overlay">
      <div className="nal-panel">
        <div className="nal-header">
          <span className="nal-title">{title}</span>
          <button className="nal-close-btn" onClick={onClose}><X size={14} /></button>
        </div>
        <div className="nal-body">
          {lines.map((l, i) => (
            <div key={i} className={`nal-line ${lineClass(l)}`}>{renderLine(l, onPodClick)}</div>
          ))}
          {!done && <span className="nal-cursor">▋</span>}
          <div ref={bottomRef} />
        </div>
        {done && (
          <div className="nal-footer">
            <button className="confirm-btn confirm-btn-primary" onClick={onClose}>Close</button>
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}
