export type UiDensity = 'comfortable' | 'default' | 'compact'

export const UI_DENSITY_OPTIONS: { id: UiDensity; label: string; title: string }[] = [
  { id: 'comfortable', label: 'Comfortable', title: 'More row padding' },
  { id: 'default', label: 'Default', title: 'Balanced spacing' },
  { id: 'compact', label: 'Compact', title: 'Dense tables and lists' },
]

export function parseUiDensity(raw: string | null | undefined): UiDensity {
  if (raw === 'comfortable' || raw === 'compact' || raw === 'default') return raw
  return 'default'
}

export function applyUiDensity(density: UiDensity): void {
  document.documentElement.setAttribute('data-density', density)
}
