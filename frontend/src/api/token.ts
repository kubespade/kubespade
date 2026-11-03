/** Per-launch API token injected into index.html (Electron/production) or Vite env. */
let cachedToken: string | null = null

export function apiToken(): string {
  if (cachedToken !== null) return cachedToken
  const meta = document.querySelector('meta[name="k8s-api-token"]')?.getAttribute('content')
  if (meta) {
    cachedToken = meta
    return meta
  }
  const fromEnv = (import.meta as ImportMeta & { env?: Record<string, string> }).env?.VITE_K8S_API_TOKEN
  cachedToken = fromEnv ?? ''
  return cachedToken
}

export function authHeaders(extra?: HeadersInit): Headers {
  const h = new Headers(extra)
  const t = apiToken()
  if (t) h.set('Authorization', `Bearer ${t}`)
  return h
}

/** Append access_token for EventSource / WebSocket (cannot set Authorization). */
export function withAccessToken(url: string): string {
  const t = apiToken()
  if (!t) return url
  const sep = url.includes('?') ? '&' : '?'
  return `${url}${sep}access_token=${encodeURIComponent(t)}`
}
