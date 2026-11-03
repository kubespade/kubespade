import type { ITheme } from '@xterm/xterm'
import { isLightTheme } from './uiTheme'

/** Terminal fill, shared with the CSS around it so no seam can appear. */
export function termColors() {
  const css = getComputedStyle(document.documentElement)
  const light = isLightTheme()
  return {
    background: css.getPropertyValue('--term-bg').trim() || (light ? '#ffffff' : '#070b11'),
    foreground: css.getPropertyValue('--term-fg').trim() || (light ? '#121821' : '#e8eef6'),
  }
}

export function getXtermTheme(): ITheme {
  const light = isLightTheme()
  const { background, foreground } = termColors()
  if (light) {
    return {
      background, foreground, cursor: foreground,
      cursorAccent: background, selectionBackground: 'rgba(201,133,18,0.22)',
      black: '#24292f', red: '#cf222e', green: '#1a7f37', yellow: '#9a6700',
      blue: '#0969da', magenta: '#8250df', cyan: '#0550ae', white: '#6e7781',
      brightBlack: '#57606a', brightRed: '#a40e26', brightGreen: '#2da44e',
      brightYellow: '#bf8700', brightBlue: '#218bff', brightMagenta: '#a475f9',
      brightCyan: '#1b7fc4', brightWhite: '#1f2328',
    }
  }
  return {
    background, foreground, cursor: foreground,
    cursorAccent: background, selectionBackground: 'rgba(224,160,26,0.25)',
    black: '#484f58', red: '#ff7b72', green: '#3fb950', yellow: '#d29922',
    blue: '#58a6ff', magenta: '#bc8cff', cyan: '#39c5cf', white: '#b1bac4',
    brightBlack: '#6e7681', brightRed: '#ffa198', brightGreen: '#56d364',
    brightYellow: '#e3b341', brightBlue: '#79c0ff', brightMagenta: '#d2a8ff',
    brightCyan: '#56d4dd', brightWhite: '#e6edf3',
  }
}
