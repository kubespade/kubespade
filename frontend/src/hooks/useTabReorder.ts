import { useRef, useState } from 'react'

export interface TabDropHint {
  insertIndex: number
  indicatorX: number
}

/**
 * Drag-and-drop reorder math for a horizontal tab strip.
 * `reorder` applies the insert; the hook owns drag/drop-hint UI state.
 */
export function useTabReorder<T extends { id: string }>(
  tabs: T[],
  reorder: (fromId: string, insertIndex: number) => void,
) {
  const [dragTabId, setDragTabId] = useState<string | null>(null)
  const [dropHint, setDropHint] = useState<TabDropHint | null>(null)
  const tabsRef = useRef<HTMLDivElement>(null)

  function setDropHintFromTab(e: React.DragEvent, tabIndex: number) {
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
    if (!dragTabId || tabs[tabIndex]?.id === dragTabId) {
      setDropHint(null)
      return
    }
    const tabEl = e.currentTarget as HTMLElement
    const container = tabsRef.current
    if (!container) return
    const tabRect = tabEl.getBoundingClientRect()
    const containerRect = container.getBoundingClientRect()
    const after = e.clientX >= tabRect.left + tabRect.width / 2
    const insertIndex = after ? tabIndex + 1 : tabIndex
    const indicatorX = (after ? tabRect.right : tabRect.left) - containerRect.left
    setDropHint(prev => (
      prev?.insertIndex === insertIndex && prev.indicatorX === indicatorX
        ? prev
        : { insertIndex, indicatorX }
    ))
  }

  function setDropHintAtEnd(e: React.DragEvent) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (!dragTabId || tabs.length === 0) {
      setDropHint(null)
      return
    }
    const container = tabsRef.current
    if (!container) return
    const tabEls = container.querySelectorAll<HTMLElement>('.workbench-tab')
    const lastTab = tabEls[tabEls.length - 1]
    if (!lastTab) return
    const lastRect = lastTab.getBoundingClientRect()
    const containerRect = container.getBoundingClientRect()
    if (e.clientX <= lastRect.right) return
    const insertIndex = tabs.length
    const indicatorX = lastRect.right - containerRect.left
    setDropHint(prev => (
      prev?.insertIndex === insertIndex && prev.indicatorX === indicatorX
        ? prev
        : { insertIndex, indicatorX }
    ))
  }

  function handleTabDrop(e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    const fromId = e.dataTransfer.getData('text/plain') || dragTabId
    if (!fromId || dropHint == null) {
      setDropHint(null)
      setDragTabId(null)
      return
    }
    reorder(fromId, dropHint.insertIndex)
    setDropHint(null)
    setDragTabId(null)
  }

  function clearDragState() {
    setDragTabId(null)
    setDropHint(null)
  }

  function clearDropHint() {
    setDropHint(null)
  }

  function beginDrag(e: React.DragEvent, tabId: string) {
    e.dataTransfer.setData('text/plain', tabId)
    e.dataTransfer.effectAllowed = 'move'
    setDragTabId(tabId)
    setDropHint(null)
  }

  return {
    tabsRef,
    dragTabId,
    dropHint,
    setDropHintFromTab,
    setDropHintAtEnd,
    handleTabDrop,
    clearDragState,
    clearDropHint,
    beginDrag,
  }
}
