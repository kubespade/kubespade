import { useEffect, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'

const EXPAND_MS = 160

/** Case-insensitive substring match for resource name filters. */
export function matchesNameQuery(name: string | undefined | null, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return (name ?? '').toLowerCase().includes(q)
}

interface Props {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
}

/**
 * Compact loupe next to namespace — expands to a search field on click.
 */
export function NameFilterInput({
  value,
  onChange,
  placeholder = 'Filter by name…',
  className,
}: Props) {
  const [open, setOpen] = useState(() => value.trim() !== '')
  const [exiting, setExiting] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (value.trim() !== '') {
      if (exitTimerRef.current) {
        clearTimeout(exitTimerRef.current)
        exitTimerRef.current = null
      }
      setExiting(false)
      setOpen(true)
    }
  }, [value])

  useEffect(() => {
    if (open && !exiting) inputRef.current?.focus()
  }, [open, exiting])

  useEffect(() => () => {
    if (exitTimerRef.current) clearTimeout(exitTimerRef.current)
  }, [])

  function requestClose() {
    if (!open || exiting) return
    onChange('')
    setExiting(true)
    if (exitTimerRef.current) clearTimeout(exitTimerRef.current)
    exitTimerRef.current = setTimeout(() => {
      setOpen(false)
      setExiting(false)
      exitTimerRef.current = null
    }, EXPAND_MS)
  }

  useEffect(() => {
    if (!open || exiting) return
    function onDoc(e: MouseEvent) {
      if (value.trim() !== '') return
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        requestClose()
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      requestClose()
    }
    document.addEventListener('mousedown', onDoc)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      window.removeEventListener('keydown', onKey)
    }
  })

  const showField = open || exiting

  return (
    <div
      ref={wrapRef}
      className={`name-filter${showField ? ' name-filter-open' : ''}${value.trim() ? ' name-filter-active' : ''}${exiting ? ' name-filter-exiting' : ''}${className ? ` ${className}` : ''}`}
    >
      {!showField ? (
        <button
          type="button"
          className="name-filter-trigger"
          onClick={() => {
            setExiting(false)
            setOpen(true)
          }}
          title="Filter by name"
          aria-label="Filter by name"
          data-testid="name-filter-trigger"
        >
          <Search size={14} strokeWidth={1.75} aria-hidden />
        </button>
      ) : (
        <div className={`name-filter-field${exiting ? ' name-filter-field-exiting' : ''}`}>
          <Search size={13} strokeWidth={1.75} className="name-filter-ico" aria-hidden />
          <input
            ref={inputRef}
            type="text"
            className="name-filter-input"
            value={value}
            onChange={e => onChange(e.target.value)}
            placeholder={placeholder}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            data-testid="name-filter"
            aria-label="Filter by name"
            disabled={exiting}
          />
          <button
            type="button"
            className="name-filter-clear"
            onClick={requestClose}
            aria-label="Clear filter"
            title="Clear"
            disabled={exiting}
          >
            <X size={12} strokeWidth={2} aria-hidden />
          </button>
        </div>
      )}
    </div>
  )
}
