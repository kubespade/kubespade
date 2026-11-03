import { LifeBuoy, Sparkles, X } from 'lucide-react'
import { LEGAL_URLS, openExternal, SITE_URLS } from '../lib/siteConfig'
import type { AppUpdateInfo } from '../lib/appUpdate'
import type { UiDensity } from '../lib/uiDensity'
import type { UiTheme } from '../lib/uiTheme'
import {
  AiClientMark,
  AI_CLIENT_META,
  type AiClientId,
} from '../lib/aiClient'
import { Modal } from '../components/Modal'
import { AppearanceSection } from './settings/AppearanceSection'
import { AppVersionSection } from './settings/AppVersionSection'
import { ClusterMetricsSection } from './settings/ClusterMetricsSection'
import type { Profile } from '../types'

interface Props {
  uiScale: number
  onScaleChange: (v: number) => void
  uiDensity: UiDensity
  onDensityChange: (v: UiDensity) => void
  uiTheme: UiTheme
  onThemeChange: (v: UiTheme) => void
  debugEnabled: boolean
  onDebugChange: (v: boolean) => void
  profiles: Profile[]
  preferredAiClient?: AiClientId | null
  aiAvailable?: boolean
  onChangeAiClient?: () => void
  appUpdate?: AppUpdateInfo | null
  onAppUpdate?: (info: AppUpdateInfo | null) => void
  onClose: () => void
}


export function SettingsPanel({
  uiScale, onScaleChange, uiDensity, onDensityChange, uiTheme, onThemeChange,
  debugEnabled, onDebugChange, profiles, preferredAiClient, aiAvailable,
  onChangeAiClient, appUpdate, onAppUpdate, onClose,
}: Props) {
  return (
    <Modal
      onClose={onClose}
      backdropClassName="settings-backdrop overlay-backdrop"
      className="settings-panel overlay-sheet"
    >
      <div className="settings-panel-header">
        <span className="settings-panel-title">Settings</span>
        <button className="settings-panel-close" onClick={onClose}><X size={14} /></button>
      </div>

      <div className="settings-panel-body">
        <AppearanceSection
          uiScale={uiScale}
          onScaleChange={onScaleChange}
          uiDensity={uiDensity}
          onDensityChange={onDensityChange}
          uiTheme={uiTheme}
          onThemeChange={onThemeChange}
        />

        {aiAvailable && (
          <div className="settings-panel-section">
            <div className="settings-section-title">
              <Sparkles size={12} />
              AI assistant
            </div>

            <div className="settings-row">
              <div className="settings-row-info">
                <span className="settings-row-label">Preferred client</span>
                <span className="settings-row-desc">
                  Used by the sidebar AI button. First launch asks once; change it here anytime.
                </span>
              </div>
              <div className="settings-row-control settings-row-control-stack">
                <div className="settings-ai-pref">
                  {preferredAiClient ? (
                    <>
                      <AiClientMark id={preferredAiClient} size={18} branded />
                      <span>{AI_CLIENT_META[preferredAiClient].name}</span>
                    </>
                  ) : (
                    <span className="settings-ai-pref-empty">Not chosen yet</span>
                  )}
                </div>
                <button
                  type="button"
                  className="settings-action-btn"
                  onClick={() => onChangeAiClient?.()}
                >
                  {preferredAiClient ? 'Change…' : 'Choose…'}
                </button>
              </div>
            </div>
          </div>
        )}

        <ClusterMetricsSection profiles={profiles} />

        <AppVersionSection appUpdate={appUpdate} onAppUpdate={onAppUpdate} />

        <div className="settings-panel-section">
          <div className="settings-section-title">
            Legal &amp; support
          </div>

          <div className="settings-row">
            <div className="settings-row-info">
              <span className="settings-row-label">Website &amp; policies</span>
              <span className="settings-row-desc">Product info, Privacy Policy, and Terms of Use</span>
            </div>
            <div className="settings-row-control settings-row-control-stack">
              <button type="button" className="settings-action-btn" onClick={() => openExternal(SITE_URLS.home)}>
                Website
              </button>
              <button type="button" className="settings-action-btn" onClick={() => openExternal(LEGAL_URLS.privacy)}>
                Privacy
              </button>
              <button type="button" className="settings-action-btn" onClick={() => openExternal(LEGAL_URLS.terms)}>
                Terms
              </button>
            </div>
          </div>
        </div>

        <div className="settings-panel-section">
          <div className="settings-section-title">
            <LifeBuoy size={12} />
            Diagnostics
          </div>

          <div className="settings-row">
            <div className="settings-row-info">
              <span className="settings-row-label">Support logging</span>
              <span className="settings-row-desc">
                {debugEnabled
                  ? 'Recording HTTP requests and console messages for a support export…'
                  : 'Turn on to record logs. Turning off saves a redacted .log file to Downloads.'}
              </span>
            </div>
            <div className="settings-row-control">
              <button
                className={`settings-toggle ${debugEnabled ? 'on' : ''}`}
                onClick={() => onDebugChange(!debugEnabled)}
                aria-label={debugEnabled ? 'Disable support logging' : 'Enable support logging'}
              >
                <span className="settings-toggle-thumb" />
              </button>
            </div>
          </div>
        </div>

        <div className="settings-panel-footer">
          <button type="button" className="settings-footer-link" onClick={() => openExternal(SITE_URLS.home)}>
            kubespade.com
          </button>
          <span aria-hidden>·</span>
          <button type="button" className="settings-footer-link" onClick={() => openExternal(SITE_URLS.support)}>
            Support
          </button>
        </div>
      </div>
    </Modal>
  )
}
