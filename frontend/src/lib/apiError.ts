/** Transient link blips — show Reconnect / auto-retry. */
export function isTransientNetworkError(message: string): boolean {
  return /timed out|timeout|network|connection lost|offline|not connected to the internet|code -100[159]|trust challenges|NSURLError|ECONNRESET|ENOTFOUND|EAI_AGAIN|socket hang up/i.test(
    message,
  )
}

/** Errors that need an MFA prompt on Reconnect. */
export function isMfaReconnectError(message: string): boolean {
  return /MFA required|invalid MFA|mfa code/i.test(message)
}

/** RBAC / auth failures — not a network blip; don’t imply “No X found”. */
export function isPermissionDeniedError(message: string): boolean {
  const m = message.toLowerCase()
  return (
    m.includes('forbidden') ||
    m.includes('accessdenied') ||
    m.includes('access denied') ||
    m.includes('unauthorized') ||
    m.includes('not authorized') ||
    m.includes('authorizationfailed') ||
    /\b403\b/.test(m) ||
    /\b401\b/.test(m) ||
    m.includes('cannot list resource') ||
    m.includes('cannot get resource') ||
    m.includes('cannot watch resource') ||
    (m.includes('permission') && (m.includes('denied') || m.includes('list') || m.includes('get') || m.includes('watch')))
  )
}

/** User-facing watch/list error; keeps permission failures distinct from empty lists. */
export function friendlyWatchError(message: string, kindLabel?: string): string {
  if (!isPermissionDeniedError(message)) return message
  const what = kindLabel?.trim() || 'these resources'
  return `Insufficient permissions to list ${what}. Your credentials don’t allow this view.`
}
