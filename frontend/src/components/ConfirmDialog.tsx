import { useEffect, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Modal } from './Modal'

interface Props {
  title: string
  message: string
  confirmLabel?: string
  onConfirm: () => void
  onCancel: () => void
  danger?: boolean
  error?: string
  children?: ReactNode
  /** Wider dialog for long YAML / manifests. */
  wide?: boolean
  /** Stack above NodeActionLog (drain) so the log stays open underneath. */
  aboveActionLog?: boolean
}

export function ConfirmDialog({ title, message, confirmLabel = 'Confirm', onConfirm, onCancel, danger = true, error, children, wide, aboveActionLog = false }: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Enter') onConfirm()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onConfirm])

  const stack = aboveActionLog ? ' stack-above-nal' : ''
  return (
    <Modal
      onClose={onCancel}
      backdropClassName={`confirm-backdrop overlay-backdrop${stack}`}
      className={`confirm-dialog overlay-pop${wide ? ' confirm-dialog-wide' : ''}${stack}`}
    >
      <div className="confirm-icon">
        <AlertTriangle size={20} />
      </div>
      <div className="confirm-content">
        <div className="confirm-title">{title}</div>
        <div className="confirm-message">{message}</div>
        {children}
      </div>
      {error && <div className="confirm-error">{error}</div>}
      <div className="confirm-actions">
        <button className="confirm-btn confirm-btn-cancel" onClick={onCancel}>Cancel</button>
        <button
          className={`confirm-btn ${danger ? 'confirm-btn-danger' : 'confirm-btn-primary'}`}
          onClick={onConfirm}
          autoFocus
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  )
}
