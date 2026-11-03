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
