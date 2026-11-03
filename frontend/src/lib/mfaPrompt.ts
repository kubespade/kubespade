/** Promise-based MFA prompt. MfaDialogHost in App.tsx resolves it. */

type Listener = (open: boolean, message: string) => void

let pending: {
  resolve: (code: string | null) => void
  message: string
} | null = null

const listeners = new Set<Listener>()

export function isInvalidMfaMessage(msg: string): boolean {
  return /MFA failed|invalid MFA|MultiFactorAuthentication|one time pass ?code|MFA required/i.test(msg)
}

export function subscribeMfaPrompt(listener: Listener): () => void {
  listeners.add(listener)
  if (pending) listener(true, pending.message)
  return () => { listeners.delete(listener) }
}

function notify(open: boolean, message: string) {
  for (const l of listeners) l(open, message)
}

/** Ask the user for a TOTP code. Resolves to the 6-digit code, or null if cancelled. */
export function promptMfa(message = 'Enter MFA code to continue:'): Promise<string | null> {
  if (pending) {
    // Coalesce concurrent prompts into one dialog.
    return new Promise(resolve => {
      const prev = pending!.resolve
      pending!.resolve = (code) => { prev(code); resolve(code) }
      pending!.message = message
      notify(true, message)
    })
  }
  return new Promise(resolve => {
    pending = { resolve, message }
    notify(true, message)
  })
}

export function resolveMfaPrompt(code: string | null) {
  if (!pending) return
  const { resolve } = pending
  pending = null
  notify(false, '')
  resolve(code)
}
