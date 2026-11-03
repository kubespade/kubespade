import { useState } from 'react'
import { Modal } from './Modal'

interface Props {
  resourceName: string
  current: number
  onConfirm: (replicas: number) => void
  onCancel: () => void
  error?: string
  loading?: boolean
}

export function ScaleDialog({ resourceName, current, onConfirm, onCancel, error, loading }: Props) {
  const [replicas, setReplicas] = useState(current)

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !loading) onConfirm(replicas)
    if (e.key === 'Escape') onCancel()
  }

  return (
    <Modal
      onClose={onCancel}
      backdropClassName="confirm-backdrop overlay-backdrop"
      className="confirm-dialog overlay-pop"
      dismissTrigger="click"
      closeOnEscape={false}
      onKeyDown={handleKey}
      style={{ width: 320 }}
    >
      <div className="confirm-title">Scale — {resourceName}</div>
      <div className="scale-input-row">
        <button className="scale-step-btn" onClick={() => setReplicas(r => Math.max(0, r - 1))} disabled={replicas <= 0}>−</button>
        <input
          className="scale-input"
          type="number" min={0}
          value={replicas}
          onChange={e => setReplicas(Math.max(0, parseInt(e.target.value) || 0))}
          autoFocus
        />
        <button className="scale-step-btn" onClick={() => setReplicas(r => r + 1)}>+</button>
      </div>
      {replicas === 0 && <div className="scale-warn">Setting replicas to 0 will stop all pods.</div>}
      {error && <div className="confirm-error">{error}</div>}
      <div className="confirm-actions">
        <button className="confirm-btn confirm-btn-cancel" onClick={onCancel} disabled={loading}>Cancel</button>
        <button className="confirm-btn confirm-btn-primary" onClick={() => onConfirm(replicas)} disabled={loading}>
          {loading ? 'Scaling…' : 'Scale'}
        </button>
      </div>
    </Modal>
  )
}
