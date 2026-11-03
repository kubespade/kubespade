import { useEffect } from 'react'

/**
 * Call `onEscape` when the Escape key is pressed. Pass `enabled = false` to
 * detach the listener (e.g. while a dialog is closed or embedded). Replaces the
 * hand-rolled keydown effect duplicated across dialogs and overlays.
 */
export function useEscapeKey(onEscape: () => void, enabled = true) {
  useEffect(() => {
    if (!enabled) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onEscape()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onEscape, enabled])
}
