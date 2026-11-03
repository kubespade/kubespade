import React, { useEffect, useRef, useState } from 'react'
import { Settings } from 'lucide-react'
import { EmptyState } from './EmptyState'
import { TableScrollWrap } from './TableScrollWrap'
import { beginColumnResize, loadColWidths, saveColWidths, type ResizeSession } from '../lib/columnResize'
import { prefsGet, prefsSet } from '../lib/persistentStore'

export interface ColDef<T> {
  key: string
  label: string
  mono?: boolean
  render: (row: T) => React.ReactNode
  sortValue?: (row: T) => string | number
  /** Extra class on the cell `<td>` (in addition to `mono`). */
  cellClassName?: string | ((row: T) => string | undefined)
  cellStyle?: React.CSSProperties | ((row: T) => React.CSSProperties | undefined)
}

interface Props<T> {
  columns: ColDef<T>[]
  rows: T[]
  rowKey: (row: T) => string
  defaultSortKey?: string
  defaultSortDir?: 'asc' | 'desc'
  emptyMessage?: React.ReactNode
  actions?: (row: T) => React.ReactNode
  onRowClick?: (row: T) => void
  settingsKey?: string          // prefs key for persisting hidden cols (disk via ui-prefs.json)
  defaultHidden?: Set<string>   // columns hidden by default (used only when no saved state)
  /** Columns that cannot be hidden (e.g. `name`). Omitted from the settings checklist. */
  lockedColumns?: Set<string>
  /** Left side of the column-settings toolbar (count, live indicator, etc.). */
  toolbarLeft?: React.ReactNode
  /** Extra controls before the column-settings button (e.g. create/apply). */
  toolbarRight?: React.ReactNode
}

function resolveCellClass<T>(col: ColDef<T>, row: T): string {
  const parts: string[] = []
  if (col.mono) parts.push('monospace')
  const extra = typeof col.cellClassName === 'function' ? col.cellClassName(row) : col.cellClassName
  if (extra) parts.push(extra)
  return parts.join(' ')
}

function resolveCellStyle<T>(col: ColDef<T>, row: T): React.CSSProperties | undefined {
  return typeof col.cellStyle === 'function' ? col.cellStyle(row) : col.cellStyle
}

function columnsSignature(columns: { key: string }[]): string {
  return columns.map(c => c.key).join('\0')
}

/** Columns added later as default-hidden — merge into existing prefs once. */
const NEW_DEFAULT_HIDDEN_MIGRATIONS: Record<string, string[]> = {
  nodes: ['lifecycle'],
}

function loadHiddenCols(settingsKey: string, defaultHidden: Set<string>): Set<string> {
  const markMigrated = (key: string) => {
    try { prefsSet(`k8s-col-new-default::${settingsKey}::${key}`, '1') } catch { /* ignore */ }
  }
  const pending = (NEW_DEFAULT_HIDDEN_MIGRATIONS[settingsKey] ?? []).filter(k => defaultHidden.has(k))
  try {
    const saved = prefsGet(`k8s-col-hidden::${settingsKey}`)
    if (saved !== null) {
      const hidden = new Set(JSON.parse(saved) as string[])
      for (const key of pending) {
        if (prefsGet(`k8s-col-new-default::${settingsKey}::${key}`) === '1') continue
        hidden.add(key)
        markMigrated(key)
      }
      return hidden
    }
  } catch { /* ignore */ }
  for (const key of pending) markMigrated(key)
  return new Set(defaultHidden)
}

export function SortableTable<T,>({
  columns, rows, rowKey, defaultSortKey, defaultSortDir = 'asc', emptyMessage = 'No items found', actions, onRowClick,
  settingsKey, defaultHidden = new Set(), lockedColumns = new Set(), toolbarLeft, toolbarRight,
}: Props<T>) {
  const [sortKey, setSortKey] = useState(defaultSortKey ?? columns[0]?.key ?? '')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(defaultSortDir)
  const [colOrder, setColOrder] = useState<string[]>(() => columns.map(c => c.key))
  const [colWidths, setColWidths] = useState<Record<string, number>>(() =>
    settingsKey ? loadColWidths(settingsKey) : {},
  )
  const [widthsForKey, setWidthsForKey] = useState(settingsKey ?? '')
  const [dragOver, setDragOver] = useState<string | null>(null)
  const [hiddenCols, setHiddenCols] = useState<Set<string>>(() =>
    settingsKey ? loadHiddenCols(settingsKey, defaultHidden) : new Set(defaultHidden)
  )
  const [colSettingsOpen, setColSettingsOpen] = useState(false)
  const tableRef = useRef<HTMLTableElement>(null)
  const dragColRef = useRef<string | null>(null)
  const dragJustEndedRef = useRef(false)
  const resizingRef = useRef<ResizeSession | null>(null)
  const colSettingsRef = useRef<HTMLDivElement>(null)
  const colSigRef = useRef(columnsSignature(columns))
  const colDragEnabled = useRef(
    typeof window !== 'undefined' && !window.matchMedia('(pointer: coarse)').matches,
  ).current

  const colMap = Object.fromEntries(columns.map(c => [c.key, c]))
  // Locked columns stay visible even if somehow present in hidden prefs.
  const visibleOrder = colOrder.filter(k => lockedColumns.has(k) || !hiddenCols.has(k))

  if (settingsKey && widthsForKey !== settingsKey) {
    setWidthsForKey(settingsKey)
    setColWidths(loadColWidths(settingsKey))
  }

  const colSig = columnsSignature(columns)
  // When the column set changes (e.g. resource kind), reset order/hidden; keep sort if still valid.
  useEffect(() => {
    if (colSig === colSigRef.current) return
    colSigRef.current = colSig
    setColOrder(columns.map(c => c.key))
    setHiddenCols(settingsKey ? loadHiddenCols(settingsKey, defaultHidden) : new Set(defaultHidden))
    setSortKey(prev => {
      if (columns.some(c => c.key === prev)) return prev
      return defaultSortKey ?? columns[0]?.key ?? ''
    })
    // defaultHidden only applied when the column set itself changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colSig, settingsKey, defaultSortKey])

  useEffect(() => {
    if (!settingsKey) return
    try {
      prefsSet(`k8s-col-hidden::${settingsKey}`, JSON.stringify([...hiddenCols]))
    } catch { /* ignore */ }
  }, [hiddenCols, settingsKey])

  useEffect(() => {
    if (!settingsKey) return
    saveColWidths(settingsKey, colWidths)
  }, [settingsKey, colWidths])

  useEffect(() => {
    if (!colSettingsOpen) return
    function handle(e: MouseEvent) {
      if (colSettingsRef.current && !colSettingsRef.current.contains(e.target as Node)) {
        setColSettingsOpen(false)
      }
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [colSettingsOpen])

  function toggleCol(key: string) {
    if (lockedColumns.has(key)) return
    setHiddenCols(prev => {
      const s = new Set(prev)
      s.has(key) ? s.delete(key) : s.add(key)
      return s
    })
  }

  function handleSort(key: string) {
    if (!colMap[key]?.sortValue) return
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }

  function sortedRows(): T[] {
    const col = colMap[sortKey]
    if (!col?.sortValue) return rows
    return [...rows].sort((a, b) => {
      const va = col.sortValue!(a)
      const vb = col.sortValue!(b)
      const cmp = typeof va === 'number' && typeof vb === 'number'
        ? va - vb
        : String(va).localeCompare(String(vb), undefined, { numeric: true })
      return sortDir === 'asc' ? cmp : -cmp
    })
  }

  function startResize(key: string, e: React.PointerEvent) {
    beginColumnResize({
      key,
      e,
      colWidths,
      setColWidths,
      tableRef,
      visibleOrder,
      snapshotActions: Boolean(actions),
      storageKey: settingsKey,
      resizingRef,
    })
  }

  function onDragStart(key: string) { dragColRef.current = key }
  function onDragOver(key: string, e: React.DragEvent) {
    e.preventDefault()
    if (key !== dragColRef.current) setDragOver(key)
  }
  function onDrop(key: string) {
    const from = dragColRef.current
    if (from && from !== key) {
      setColOrder(prev => {
        const arr = [...prev]
        const fi = arr.indexOf(from), ti = arr.indexOf(key)
        if (fi < 0 || ti < 0) return prev
        arr.splice(fi, 1)
        arr.splice(ti, 0, from)
        return arr
      })
    }
    endDrag()
  }
  function endDrag() {
    setDragOver(null)
    dragColRef.current = null
    dragJustEndedRef.current = true
    setTimeout(() => { dragJustEndedRef.current = false }, 150)
  }

  const hasWidths = Object.keys(colWidths).length > 0
  const actionsColWidth = colWidths['__actions'] ?? 130
  const dataWidth = hasWidths ? visibleOrder.reduce((s, k) => s + (colWidths[k] ?? 120), 0) : undefined
  const totalWidth = dataWidth != null ? dataWidth + (actions ? actionsColWidth : 0) : undefined
  const sorted = sortedRows()
  const showToolbar = !!(settingsKey || toolbarLeft || toolbarRight)
  const toggleableColumns = columns.filter(col => !lockedColumns.has(col.key))

  return (
    <div>
      {showToolbar && (
        <div className="res-table-toolbar">
          <div className="res-toolbar-left">{toolbarLeft}</div>
          <div className="res-toolbar-right">
            {toolbarRight}
            {settingsKey && (
              <div className="col-settings-wrap" ref={colSettingsRef}>
                <button
                  className={`col-settings-btn${colSettingsOpen ? ' col-settings-btn-active' : ''}`}
                  onClick={() => setColSettingsOpen(o => !o)}
                  data-tooltip="Column settings"
                >
                  <Settings size={15} />
                </button>
                {colSettingsOpen && (
                  <div className="col-settings-popup">
                    <div className="col-settings-title">Columns</div>
                    {toggleableColumns.map(col => (
                      <label key={col.key} className="col-settings-row">
                        <input
                          type="checkbox"
                          checked={!hiddenCols.has(col.key)}
                          onChange={() => toggleCol(col.key)}
                        />
                        <span>{col.label}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
      <TableScrollWrap>
        <table
          ref={tableRef}
          className={`data-table${hasWidths ? ' data-table-fixed' : ''}`}
          style={totalWidth ? { width: totalWidth } : {}}
        >
          {hasWidths && (
            <colgroup>
              {visibleOrder.map(key => <col key={key} style={{ width: colWidths[key] ?? 120 }} />)}
              {actions && <col style={{ width: actionsColWidth }} />}
            </colgroup>
          )}
          <thead>
            <tr>
              {visibleOrder.map(key => {
                const col = colMap[key]
                if (!col) return null
                const sortable = !!col.sortValue
                const active = sortable && sortKey === key
                const w = colWidths[key]
                return (
                  <th
                    key={key}
                    className={`${sortable ? 'th-sortable ' : ''}th-col${dragOver === key ? ' th-drag-over' : ''}`}
                    style={w ? { width: w, minWidth: w } : {}}
                    draggable={colDragEnabled}
                    onDragStart={e => { if (!colDragEnabled || resizingRef.current) { e.preventDefault(); return } onDragStart(key) }}
                    onDragOver={e => onDragOver(key, e)}
                    onDrop={() => onDrop(key)}
                    onDragEnd={endDrag}
                    onClick={() => { if (!dragJustEndedRef.current) handleSort(key) }}
                  >
                    <span className="th-label">
                      {col.label}
                      {sortable && (
                        <span className={`sort-arrow ${active ? 'sort-arrow-active' : ''}`}>
                          {active ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ' ↕'}
                        </span>
                      )}
                    </span>
                    <div
                      className="col-resize-handle"
                      draggable={false}
                      onPointerDown={e => startResize(key, e)}
                      onClick={e => e.stopPropagation()}
                    />
                  </th>
                )
              })}
              {actions && <th className="th-actions">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={visibleOrder.length + (actions ? 1 : 0)} className="res-empty">
                  {typeof emptyMessage === 'string'
                    ? <EmptyState compact title={emptyMessage} />
                    : emptyMessage}
                </td>
              </tr>
            ) : sorted.map(row => (
              <tr
                key={rowKey(row)}
                className={onRowClick ? 'res-row-clickable' : ''}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
              >
                {visibleOrder.map(key => {
                  const col = colMap[key]
                  if (!col) return null
                  const className = resolveCellClass(col, row)
                  const style = resolveCellStyle(col, row)
                  return (
                    <td key={key} className={className || undefined} style={style}>
                      {col.render(row)}
                    </td>
                  )
                })}
                {actions && (
                  <td className="td-actions">
                    {actions(row)}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </TableScrollWrap>
    </div>
  )
}
