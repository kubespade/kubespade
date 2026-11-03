import { useEffect, type RefObject } from 'react'
import type { Terminal } from '@xterm/xterm'
import { getXtermTheme } from '../lib/xtermTheme'
import { UI_THEME_CHANGE_EVENT } from '../lib/uiTheme'

/** Keep an open xterm instance in sync with KubeSpade light/dark theme. */
export function useXtermThemeSync(xtermRef: RefObject<Terminal | null>) {
  useEffect(() => {
    function onTheme() {
      if (xtermRef.current) xtermRef.current.options.theme = getXtermTheme()
    }
    window.addEventListener(UI_THEME_CHANGE_EVENT, onTheme)
    return () => window.removeEventListener(UI_THEME_CHANGE_EVENT, onTheme)
  }, [xtermRef])
}
