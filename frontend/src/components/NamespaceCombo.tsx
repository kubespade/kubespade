import { Fragment, useEffect, useRef, useState } from 'react'

export function NamespaceCombo({ namespaces, value, onChange }: {
  namespaces: string[]
  value: string[] | null   // null = placeholder, [] = all namespaces, string[] = specific selection
  onChange: (v: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  /** Only filter after the user has typed. */
  const [filterActive, setFilterActive] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  function close() {
    setOpen(false)
    setQuery('')
    setFilterActive(false)
  }

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        close()
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  function displayLabel(): string {
    if (value === null) return ''
    if (value.length === 0) return 'All namespaces'
    if (value.length === 1) return value[0]
    return `${value.length} selected`
  }

  function toggleNsInList(ns: string) {
    if (!value || value.length === 0) {
      onChange([ns])
      return
    }
    const set = new Set(value)
    if (set.has(ns)) {
      set.delete(ns)
      onChange(set.size === 0 ? [] : [...set])
    } else {
      set.add(ns)
      onChange([...set])
    }
  }

  function selectOnlyNs(ns: string) {
    onChange([ns])
    close()
  }

  function selectAllNs() {
    onChange([])
    close()
  }

  function onCheckPointer(e: React.MouseEvent | React.TouchEvent, ns: string) {
    e.preventDefault()
    e.stopPropagation()
    toggleNsInList(ns)
  }

  const list = namespaces.filter((ns): ns is string => typeof ns === 'string' && ns.length > 0)
  const q = filterActive ? query.toLowerCase().trim() : ''
  const showAll = !q || 'all namespaces'.includes(q)
  let filtered = q
    ? list.filter(ns => ns.toLowerCase().includes(q))
    : list
  if (filtered.length === 0 && list.length > 0) {
    filtered = list
  }
  const selectedSet = new Set(value ?? [])
  const isAll = value !== null && value.length === 0

  return (
    <Fragment>
      <div ref={wrapRef} className={`ns-combo${open ? ' ns-combo-open' : ''}`}>
        <input
          ref={inputRef}
          className={`ns-combo-input${value === null && !open ? ' ns-combo-placeholder' : ''}`}
          value={open ? (filterActive ? query : '') : displayLabel()}
          placeholder="Select namespace…"
          autoComplete="off"
          onChange={e => {
            setQuery(e.target.value)
            setFilterActive(true)
            setOpen(true)
          }}
          onFocus={() => { setQuery(''); setFilterActive(false); setOpen(true) }}
          onClick={() => setOpen(true)}
          onKeyDown={e => { if (e.key === 'Escape') close() }}
        />
        <span className="ns-combo-chevron" onMouseDown={e => {
          e.preventDefault()
          if (open) close()
          else inputRef.current?.focus()
        }}>▾</span>
        {open && (
          <div className="ns-combo-dropdown">
            {showAll && (
              <div
                className={`ns-combo-item${isAll ? ' ns-combo-item-active' : ''}`}
                onMouseDown={e => { e.preventDefault(); selectAllNs() }}
              >
                <span
                  className="ns-check-hit"
                  onMouseDown={e => { e.preventDefault(); e.stopPropagation(); onChange([]) }}
                >
                  <span className={`ns-check${isAll ? ' ns-check-on' : ''}`} />
                </span>
                <span className="ns-combo-item-label">All namespaces</span>
              </div>
            )}
            {filtered.map(ns => {
              const checked = !isAll && selectedSet.has(ns)
              return (
                <div
                  key={ns}
                  className={`ns-combo-item${checked ? ' ns-combo-item-active' : ''}`}
                  onMouseDown={e => { e.preventDefault(); selectOnlyNs(ns) }}
                >
                  <span
                    className="ns-check-hit"
                    onMouseDown={e => onCheckPointer(e, ns)}
                  >
                    <span className={`ns-check${checked ? ' ns-check-on' : ''}`} />
                  </span>
                  <span className="ns-combo-item-label">{ns}</span>
                </div>
              )
            })}
            {list.length === 0 && (
              <div className="ns-combo-empty">No namespaces</div>
            )}
          </div>
        )}
      </div>

      {value && value.length >= 2 && value.map(ns => (
        <span key={ns} className="ns-tag">
          <span className="ns-tag-label">{ns}</span>
          <button
            className="ns-tag-remove"
            onMouseDown={e => { e.preventDefault(); toggleNsInList(ns) }}
            title={`Remove ${ns}`}
          >×</button>
        </span>
      ))}
    </Fragment>
  )
}
