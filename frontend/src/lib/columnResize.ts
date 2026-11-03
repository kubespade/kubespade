/** Shared column-resize logic for resource / sortable tables (mouse + touch). */

import type { Dispatch, MutableRefObject, PointerEvent as ReactPointerEvent, RefObject, SetStateAction } from 'react'
import { prefsGet, prefsSet } from './persistentStore'

export type ColWidths = Record<string, number>

export type ResizeSession = {
  key: string
  startX: number
  startW: number
}

const MIN_COL = 40
/** Prevent pathological widths that OOM / crash WKWebView drag bitmaps on iPad. */
const MAX_COL = 720
const WIDTHS_STORAGE_PREFIX = 'k8s-col-widths::'

function clampWidth(n: number): number {
  return Math.min(MAX_COL, Math.max(MIN_COL, Math.round(n)))
}

/** Restore persisted column widths for a resource / settings key. */
export function loadColWidths(storageKey: string): ColWidths {
  try {
    const raw = prefsGet(WIDTHS_STORAGE_PREFIX + storageKey)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const out: ColWidths = {}
    for (const [k, v] of Object.entries(parsed)) {
      const n = Number(v)
      if (Number.isFinite(n) && n > 0) out[k] = clampWidth(n)
    }
    return out
  } catch {
    return {}
  }
}

/** Persist column widths (no-op if empty). */
export function saveColWidths(storageKey: string, widths: ColWidths): void {
  if (Object.keys(widths).length === 0) return
  try {
    prefsSet(WIDTHS_STORAGE_PREFIX + storageKey, JSON.stringify(widths))
  } catch {
    /* quota / private mode */
  }
}

export type BeginColumnResizeArgs = {
  key: string
  e: ReactPointerEvent
  colWidths: ColWidths
  setColWidths: Dispatch<SetStateAction<ColWidths>>
  tableRef: RefObject<HTMLTableElement | null>
  visibleOrder: string[]
  /** When true, also snapshot the trailing Actions column as `__actions`. */
  snapshotActions?: boolean
  /** Persist on every resize tick (survives unmount before React effects flush). */
  storageKey?: string
  resizingRef: MutableRefObject<ResizeSession | null>
}

/**
 * Start a column resize. Uses document-level pointer listeners so React
 * re-renders (table-layout:fixed snapshot) cannot drop the gesture.
 * Temporarily disables HTML5 draggable on the parent <th> — on iPad, native
 * DnD of a widening table has been observed to blank the whole WKWebView.
 */
export function beginColumnResize({
  key,
  e,
  colWidths,
  setColWidths,
  tableRef,
  visibleOrder,
  snapshotActions = true,
  storageKey,
  resizingRef,
}: BeginColumnResizeArgs): void {
  e.preventDefault()
  e.stopPropagation()

  const handle = e.currentTarget as HTMLElement
  const th = handle.closest('th') as HTMLTableCellElement | null
  if (!th) return

  const pointerId = e.pointerId
  const wasDraggable = th.getAttribute('draggable')
  th.setAttribute('draggable', 'false')

  try {
    handle.setPointerCapture(pointerId)
  } catch {
    /* some WebViews throw if capture is unsupported */
  }

  const commit = (next: ColWidths) => {
    setColWidths(next)
    if (storageKey) saveColWidths(storageKey, next)
  }

  // First resize: snapshot DOM widths before switching to table-layout:fixed.
  let base = colWidths
  if (Object.keys(colWidths).length === 0 && tableRef.current) {
    const ths = tableRef.current.querySelectorAll<HTMLTableCellElement>('thead th')
    const snapshot: ColWidths = {}
    visibleOrder.forEach((k, i) => {
      if (ths[i]) snapshot[k] = clampWidth(ths[i]!.offsetWidth)
    })
    if (snapshotActions) {
      const actTh = ths[visibleOrder.length]
      snapshot['__actions'] = actTh ? clampWidth(actTh.offsetWidth) : 130
    }
    base = snapshot
    commit(snapshot)
  }

  const startX = Number.isFinite(e.clientX) ? e.clientX : 0
  const startW = Math.max(MIN_COL, th.offsetWidth || MIN_COL)
  resizingRef.current = { key, startX, startW }
  document.body.classList.add('col-resizing')

  // Mutable copy so rapid pointermoves don't read a stale React state snapshot.
  let current = { ...base }

  const move = (ev: PointerEvent) => {
    if (!resizingRef.current) return
    if (ev.pointerId !== pointerId) return
    if (!Number.isFinite(ev.clientX)) return
    const raw = resizingRef.current.startW + ev.clientX - resizingRef.current.startX
    const w = clampWidth(raw)
    const colKey = resizingRef.current.key
    if (current[colKey] === w) return
    current = { ...current, [colKey]: w }
    commit(current)
  }

  const finished = { current: false }
  const up = (ev?: Event) => {
    if (finished.current) return
    if (ev && 'pointerId' in ev && (ev as PointerEvent).pointerId !== pointerId) return
    finished.current = true
    resizingRef.current = null
    document.body.classList.remove('col-resizing')
    document.removeEventListener('pointermove', move)
    document.removeEventListener('pointerup', up)
    document.removeEventListener('pointercancel', up)
    handle.removeEventListener('lostpointercapture', up)
    try {
      if (handle.hasPointerCapture?.(pointerId)) handle.releasePointerCapture(pointerId)
    } catch {
      /* ignore */
    }
    if (wasDraggable == null) th.removeAttribute('draggable')
    else th.setAttribute('draggable', wasDraggable)
    if (storageKey) saveColWidths(storageKey, current)
  }

  document.addEventListener('pointermove', move)
  document.addEventListener('pointerup', up)
  document.addEventListener('pointercancel', up)
  handle.addEventListener('lostpointercapture', up)
}
