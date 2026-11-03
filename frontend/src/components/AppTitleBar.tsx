import type { MouseEvent } from 'react'
import { ChevronLeft, ChevronRight, Download, Search, Settings, Sparkles } from 'lucide-react'
import { AiClientMark, type AiClientId } from '../lib/aiClient'
import { formatAppVersion } from '../lib/appUpdate'
import { WindowTitleControls } from './WindowTitleControls'

function shortcutMod(): string {
  if (typeof navigator === 'undefined') return 'Ctrl+'
  return /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+'
}

interface Props {
  /** Current place in the app (Welcome / Manage / Pods…) — not the cluster name. */
  locationLabel: string
  canGoBack: boolean
  canGoForward: boolean
  onBack: () => void
  onForward: () => void
  onSearch: () => void
  customTitleBar: boolean
  /** Windows titleBarOverlay — dbl-click maximize like native caption area. */
  overlayTitleBar?: boolean
  settingsOpen: boolean
  aiOpen: boolean
  aiAvailable: boolean
  preferredAiClient: AiClientId | null
  /** When set, show a download icon that re-opens the floating update popup. */
  updateAvailableVersion?: string | null
  onShowUpdate?: () => void
  onHome: () => void
  onSettings: () => void
  onAi?: () => void
}

/**
 * Ghost chrome: same color as the app on Mac / Windows / Linux.
 * Mark + back/forward + current place; search hint + AI / Settings on the right.
 * Cluster name stays in the sidebar only (no duplicate).
 */
export function AppTitleBar({
  locationLabel,
  canGoBack,
  canGoForward,
  onBack,
  onForward,
  onSearch,
  customTitleBar,
  overlayTitleBar = false,
  settingsOpen,
  aiOpen,
  aiAvailable,
  preferredAiClient,
  updateAvailableVersion = null,
  onShowUpdate,
  onHome,
  onSettings,
  onAi,
}: Props) {
  const mod = shortcutMod()
  const searchShortcut = `${mod}K`
  const updateTitle = updateAvailableVersion
    ? `Download update · ${formatAppVersion(updateAvailableVersion)}`
    : 'Download update'

  function onBarDoubleClick(e: MouseEvent) {
    if (!(customTitleBar || overlayTitleBar)) return
    const t = e.target as HTMLElement | null
    if (t?.closest?.('button, .window-title-controls')) return
    void window.kubespade?.windowControls?.maximizeToggle?.()
  }

  return (
    <header className="app-titlebar" aria-label="Window" onDoubleClick={onBarDoubleClick}>
      <div className="app-titlebar-left">
        <button
          type="button"
          className="app-titlebar-home"
          onClick={onHome}
          title="Home"
        >
          <span className="app-titlebar-mark" aria-hidden />
        </button>
        <div className="app-titlebar-nav">
          <button
            type="button"
            className="app-titlebar-btn"
            onClick={onBack}
            disabled={!canGoBack}
            title={`Back (${mod}[)`}
          >
            <ChevronLeft size={16} strokeWidth={2.25} />
          </button>
          <button
            type="button"
            className="app-titlebar-btn"
            onClick={onForward}
            disabled={!canGoForward}
            title={`Forward (${mod}])`}
          >
            <ChevronRight size={16} strokeWidth={2.25} />
          </button>
        </div>
        <span className="app-titlebar-place">{locationLabel}</span>
      </div>

      <div className="app-titlebar-right">
        {updateAvailableVersion && onShowUpdate && (
          <button
            type="button"
            className="app-titlebar-btn app-titlebar-update"
            onClick={onShowUpdate}
            title={updateTitle}
            aria-label={updateTitle}
          >
            <Download size={14} strokeWidth={2.25} aria-hidden />
          </button>
        )}
        <button
          type="button"
          className="app-titlebar-search-hint"
          onClick={onSearch}
          title={`Search resources (${searchShortcut})`}
          aria-label={`Search resources (${searchShortcut})`}
        >
          <kbd className="app-titlebar-kbd">{searchShortcut}</kbd>
          <Search size={13} strokeWidth={2.25} aria-hidden />
        </button>
        {aiAvailable && onAi && (
          <button
            type="button"
            className={`app-titlebar-btn${aiOpen ? ' active' : ''}`}
            onClick={onAi}
            title={preferredAiClient ? `AI · ${preferredAiClient}` : 'AI assistant'}
          >
            {preferredAiClient
              ? <AiClientMark id={preferredAiClient} size={14} />
              : <Sparkles size={14} />}
          </button>
        )}
        <button
          type="button"
          className={`app-titlebar-btn${settingsOpen ? ' active' : ''}`}
          onClick={onSettings}
          title="Settings"
        >
          <Settings size={14} />
        </button>
        {customTitleBar && <WindowTitleControls />}
      </div>
    </header>
  )
}
