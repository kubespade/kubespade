export type UiTheme = 'day' | 'night' | 'system'

export const UI_THEME_OPTIONS: { id: UiTheme; label: string; title: string }[] = [
  { id: 'day', label: 'Day', title: 'Force light appearance' },
  { id: 'night', label: 'Night', title: 'Force dark appearance' },
  { id: 'system', label: 'System', title: 'Match system appearance' },
]

export const UI_THEME_STORAGE_KEY = 'ui-theme'
export const UI_THEME_CHANGE_EVENT = 'kubespade:theme'

const THEME_LIGHT = '#e8edf4'
const THEME_DARK = '#0a0e14'

export function parseUiTheme(raw: string | null | undefined): UiTheme {
  if (raw === 'day' || raw === 'night' || raw === 'system') return raw
  return 'system'
}

export function resolveIsDark(theme: UiTheme): boolean {
  if (theme === 'day') return false
  if (theme === 'night') return true
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

export function isLightTheme(): boolean {
  return document.documentElement.dataset.theme === 'light'
}

/** Apply effective light/dark chrome from preference (and OS when system). */
export function applyUiTheme(theme: UiTheme): void {
  const dark = resolveIsDark(theme)
  const root = document.documentElement
  const next = dark ? 'dark' : 'light'
  root.dataset.theme = next
  root.style.colorScheme = next
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', dark ? THEME_DARK : THEME_LIGHT)
  window.dispatchEvent(new CustomEvent(UI_THEME_CHANGE_EVENT, { detail: { theme, dark } }))
}

export function readStoredUiTheme(): UiTheme {
  try {
    return parseUiTheme(localStorage.getItem(UI_THEME_STORAGE_KEY))
  } catch {
    return 'system'
  }
}
