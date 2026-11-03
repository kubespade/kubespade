import { useState } from 'react'
import { ArrowUpCircle } from 'lucide-react'
import {
  checkAppUpdate,
  formatAppVersion,
  openUpdateDownload,
  type AppUpdateInfo,
} from '../../lib/appUpdate'

interface Props {
  appUpdate?: AppUpdateInfo | null
  onAppUpdate?: (info: AppUpdateInfo | null) => void
}

export function AppVersionSection({ appUpdate, onAppUpdate }: Props) {
  const [updateChecking, setUpdateChecking] = useState(false)

  return (
    <div className="settings-panel-section">
      <div className="settings-section-title">
        <ArrowUpCircle size={12} />
        App version
      </div>

      <div className="settings-row">
        <div className="settings-row-info">
          <span className="settings-row-label">
            {appUpdate?.current ? `KubeSpade ${formatAppVersion(appUpdate.current)}` : 'KubeSpade'}
          </span>
          <span className="settings-row-desc">
            {updateChecking
              ? 'Checking GitHub Releases…'
              : appUpdate?.error
                ? `Could not check for updates (${appUpdate.error}).`
                : appUpdate?.updateAvailable
                  ? `${formatAppVersion(appUpdate.latest)} is available.`
                  : appUpdate?.latest
                    ? 'You have the latest release.'
                    : 'Checks GitHub for a newer desktop build.'}
          </span>
        </div>
        <div className="settings-row-control settings-row-control-stack">
          {appUpdate?.updateAvailable && (
            <button
              type="button"
              className="settings-action-btn"
              onClick={() => openUpdateDownload(appUpdate)}
            >
              Download
            </button>
          )}
          <button
            type="button"
            className="settings-action-btn"
            disabled={updateChecking}
            onClick={() => {
              setUpdateChecking(true)
              void checkAppUpdate().then(info => {
                onAppUpdate?.(info)
                setUpdateChecking(false)
              })
            }}
          >
            {updateChecking ? 'Checking…' : 'Check for updates'}
          </button>
        </div>
      </div>
    </div>
  )
}
