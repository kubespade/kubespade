import { openExternal, SITE_URLS } from './siteConfig'

export type AppUpdateInfo = {
  current: string
  latest: string
  updateAvailable: boolean
  releaseUrl?: string
  downloadUrl?: string
  /** GitHub release body (markdown/plain), if available. */
  releaseNotes?: string
  error?: string
}

/** Display form matching GitHub tags (v1.2.3). */
export function formatAppVersion(s: string | undefined | null): string {
  const n = String(s || '').trim().replace(/^v/i, '')
  return n ? `v${n}` : ''
}

export function openUpdateDownload(info: AppUpdateInfo | null): void {
  openExternal(info?.downloadUrl || SITE_URLS.download)
}

export async function checkAppUpdate(): Promise<AppUpdateInfo | null> {
  const fn = window.kubespade?.app?.checkUpdate
  if (!fn) return null
  try {
    return await fn()
  } catch {
    return null
  }
}

/** Re-open the floating update window after Later (or if it was closed). */
export async function showUpdatePopup(info?: AppUpdateInfo | null): Promise<AppUpdateInfo | null> {
  const fn = window.kubespade?.app?.showUpdatePopup
  if (!fn) return null
  try {
    return await fn(info ?? undefined)
  } catch {
    return null
  }
}
