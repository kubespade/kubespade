/** Public marketing / legal site. */
export const SITE_URL = 'https://kubespade.com'

export const SITE_URLS = {
  home: SITE_URL,
  download: `${SITE_URL}/download.html`,
  support: 'https://github.com/kubespade/kubespade/issues',
} as const

export const LEGAL_URLS = {
  privacy: `${SITE_URL}/privacy.html`,
  terms: `${SITE_URL}/terms.html`,
} as const

export function openExternal(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer')
}
