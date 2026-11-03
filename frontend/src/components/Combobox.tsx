import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'

export interface ComboboxOption {
  /** Stored / submitted value */
  value: string
  /** Primary line in the list */
  label: string
  /** Optional secondary line */
  detail?: string
}

interface Props {
  value: string
  onChange: (value: string) => void
  options: ComboboxOption[]
  placeholder?: string
  disabled?: boolean
  autoFocus?: boolean
  className?: string
  /** Called when the user picks an option from the list (not free-typed). */
  onPick?: (option: ComboboxOption) => void
  /** Called on blur after commit. */
  onCommit?: (value: string) => void
  emptyMessage?: string
  maxVisible?: number
  /** Marks the input as invalid (required / validation). */
  invalid?: boolean
}

export function Combobox({
  value,
  onChange,
  options,
  placeholder,
  disabled,
  autoFocus,
  className = '',
  onPick,
  onCommit,
  emptyMessage = 'No matches',
  maxVisible = 80,
  invalid = false,
}: Props) {
  const listId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(0)
  /** Only filter after the user types — otherwise show the full list on open. */
  const [filterActive, setFilterActive] = useState(false)

  const filtered = useMemo(() => {
    const q = filterActive ? value.trim().toLowerCase() : ''
    const list = !q
      ? options
      : options.filter(o =>
          o.label.toLowerCase().includes(q)
          || o.value.toLowerCase().includes(q)
          || (o.detail?.toLowerCase().includes(q) ?? false),
        )
    return list.slice(0, maxVisible)
  }, [options, value, maxVisible, filterActive])

  useEffect(() => {
    setHighlight(0)
  }, [value, open, filterActive])

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false)
        setFilterActive(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  function pick(opt: ComboboxOption) {
    onChange(opt.value)
    onPick?.(opt)
    setOpen(false)
    setFilterActive(false)
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!open) { setOpen(true); setFilterActive(false); return }
      setHighlight(h => Math.min(h + 1, Math.max(filtered.length - 1, 0)))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight(h => Math.max(h - 1, 0))
    } else if (e.key === 'Enter' && open && filtered[highlight]) {
      e.preventDefault()
      pick(filtered[highlight])
    } else if (e.key === 'Escape') {
      if (open) {
        e.preventDefault()
        e.stopPropagation()
        setOpen(false)
        setFilterActive(false)
      }
    }
  }

  let listBody: ReactNode = null
  if (open && !disabled) {
    if (filtered.length === 0) {
      listBody = <div className="combobox-empty">{emptyMessage}</div>
    } else {
      listBody = filtered.map((opt, i) => (
        <button
          key={`${opt.value}::${opt.label}`}
          type="button"
          className={`combobox-option${i === highlight ? ' combobox-option-active' : ''}`}
          onMouseDown={e => e.preventDefault()}
          onClick={() => pick(opt)}
          onMouseEnter={() => setHighlight(i)}
        >
          <span className="combobox-option-label">{opt.label}</span>
          {opt.detail && <span className="combobox-option-detail">{opt.detail}</span>}
        </button>
      ))
    }
  }

  return (
    <div className={`combobox ${className}`.trim()} ref={rootRef}>
      <input
        className={`helm-write-input combobox-input${invalid ? ' helm-write-input-invalid' : ''}`}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-invalid={invalid || undefined}
        value={value}
        disabled={disabled}
        autoFocus={autoFocus}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        onChange={e => {
          onChange(e.target.value)
          setFilterActive(true)
          setOpen(true)
        }}
        onFocus={() => {
          setFilterActive(false)
          setOpen(true)
        }}
        onBlur={() => onCommit?.(value)}
        onKeyDown={onKeyDown}
      />
      {open && !disabled && (
        <div id={listId} className="combobox-list" role="listbox">
          {listBody}
        </div>
      )}
    </div>
  )
}
