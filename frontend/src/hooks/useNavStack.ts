import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type { Resource } from '../lib/resourceKinds'

export type AppView = 'home' | 'cluster' | 'manage'

export type NavPoint = {
  view: AppView
  profile: string | null
  resource: Resource
}

function navKey(p: NavPoint): string {
  if (p.view === 'cluster') return `cluster:${p.profile ?? ''}:${p.resource}`
  return p.view
}

type UseNavStackParams = {
  view: AppView
  selectedProfile: string | null
  selectedResource: Resource
  setView: (view: AppView) => void
  setSelectedProfile: (profile: string | null) => void
  setResourceMap: Dispatch<SetStateAction<Record<string, Resource>>>
  /** When set, ⌘K / Ctrl+K toggles the command palette in the same key handler as nav shortcuts. */
  onToggleCmdPalette?: () => void
}

export function useNavStack({
  view,
  selectedProfile,
  selectedResource,
  setView,
  setSelectedProfile,
  setResourceMap,
  onToggleCmdPalette,
}: UseNavStackParams) {
  const [navStack, setNavStack] = useState<NavPoint[]>([])
  const [navIndex, setNavIndex] = useState(-1)
  const navIndexRef = useRef(-1)
  const navSkipRef = useRef(false)

  const applyNavPoint = useCallback((point: NavPoint) => {
    navSkipRef.current = true
    setView(point.view)
    if (point.view === 'cluster' && point.profile) {
      setSelectedProfile(point.profile)
      setResourceMap(prev => ({ ...prev, [point.profile!]: point.resource }))
    }
  }, [setView, setSelectedProfile, setResourceMap])

  const goNavBack = useCallback(() => {
    const i = navIndexRef.current
    if (i <= 0) return
    const next = i - 1
    const point = navStack[next]
    if (!point) return
    navIndexRef.current = next
    setNavIndex(next)
    applyNavPoint(point)
  }, [navStack, applyNavPoint])

  const goNavForward = useCallback(() => {
    const i = navIndexRef.current
    if (i < 0 || i >= navStack.length - 1) return
    const next = i + 1
    const point = navStack[next]
    if (!point) return
    navIndexRef.current = next
    setNavIndex(next)
    applyNavPoint(point)
  }, [navStack, applyNavPoint])

  useEffect(() => {
    const point: NavPoint = {
      view,
      profile: view === 'cluster' ? selectedProfile : null,
      resource: selectedResource,
    }
    const key = navKey(point)
    if (navSkipRef.current) {
      navSkipRef.current = false
      return
    }
    setNavStack(prev => {
      const i = navIndexRef.current
      const cur = i >= 0 ? prev[i] : undefined
      if (cur && navKey(cur) === key) return prev
      const trimmed = i >= 0 ? prev.slice(0, i + 1) : []
      const next = [...trimmed, point].slice(-40)
      navIndexRef.current = next.length - 1
      setNavIndex(navIndexRef.current)
      return next
    })
  }, [view, selectedProfile, selectedResource])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null
      if (t?.closest?.('textarea, [contenteditable="true"], input')) return
      const mod = e.metaKey || e.ctrlKey
      if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
        if (onToggleCmdPalette) {
          e.preventDefault()
          onToggleCmdPalette()
        }
        return
      }
      // Browser-style history: ⌘[ / ⌘] (Mac) or Alt+← / Alt+→
      if (mod && !e.altKey && !e.shiftKey && e.key === '[') {
        e.preventDefault()
        goNavBack()
        return
      }
      if (mod && !e.altKey && !e.shiftKey && e.key === ']') {
        e.preventDefault()
        goNavForward()
        return
      }
      if (e.altKey && !mod && e.key === 'ArrowLeft') {
        e.preventDefault()
        goNavBack()
        return
      }
      if (e.altKey && !mod && e.key === 'ArrowRight') {
        e.preventDefault()
        goNavForward()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [goNavBack, goNavForward, onToggleCmdPalette])

  return {
    navStack,
    navIndex,
    goNavBack,
    goNavForward,
  }
}
