import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { resolveMfaPrompt, subscribeMfaPrompt } from '../lib/mfaPrompt'
import { Modal } from './Modal'

/** Global MFA modal — mounted once in App. Driven by promptMfa(). */
export function MfaDialogHost() {
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [code, setCode] = useState('')

  useEffect(() => subscribeMfaPrompt((isOpen, msg) => {
    setOpen(isOpen)
    setMessage(msg)
    if (isOpen) setCode('')
  }), [])

  if (!open) return null

  function submit() {
    if (code.length < 6) return
    const tok = code
    setCode('')
    resolveMfaPrompt(tok)
  }

  function cancel() {
    setCode('')
    resolveMfaPrompt(null)
  }

  return (
    <Modal
      onClose={cancel}
      backdropClassName="connect-overlay-backdrop overlay-backdrop"
      className="connect-overlay mfa-dialog overlay-pop"
      dismissTrigger="click"
      role="dialog"
      aria-modal="true"
      aria-label="MFA"
    >
      <div className="connect-overlay-header">
        <span>MFA required</span>
        <button type="button" className="acm-close-btn" onClick={cancel} aria-label="Cancel"><X size={15} /></button>
      </div>
      <div className="connect-overlay-body">
        <p className="mfa-dialog-msg">{message}</p>
        <div className="mfa-row">
          <input
            type="text"
            placeholder="123456"
            maxLength={6}
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            onKeyDown={e => e.key === 'Enter' && submit()}
            autoFocus
          />
          <button type="button" onClick={submit} disabled={code.length < 6}>Continue</button>
        </div>
      </div>
    </Modal>
  )
}
