/** Open the Settings panel from anywhere in the app (Overview CTA, etc.). */
export const OPEN_SETTINGS_EVENT = 'kubespade:open-settings'

export function openSettings(): void {
  window.dispatchEvent(new Event(OPEN_SETTINGS_EVENT))
}
