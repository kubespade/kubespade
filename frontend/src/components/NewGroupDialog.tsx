import { useState } from 'react'
import { Modal } from './Modal'

interface Props {
  onConfirm: (name: string) => void
  onCancel: () => void
}

export function NewGroupDialog({ onConfirm, onCancel }: Props) {
  const [name, setName] = useState('')

  function submit() {
    const trimmed = name.trim()
    if (!trimmed) return
    onConfirm(trimmed)
  }

  return (
    <Modal
      onClose={onCancel}
      backdropClassName="confirm-backdrop overlay-backdrop"
      className="confirm-dialog overlay-pop"
      dismissTrigger="click"
      closeOnEscape={false}
      style={{ width: 320 }}
    >
      <div className="confirm-title">New Group</div>
      <input
        className="sg-add-input sg-add-input-modal"
        placeholder="Group name…"
        value={name}
        autoFocus
        onChange={e => setName(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') submit()
          if (e.key === 'Escape') onCancel()
        }}
      />
      <div className="confirm-actions">
        <button type="button" className="confirm-btn confirm-btn-cancel" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="confirm-btn confirm-btn-primary"
          onClick={submit}
          disabled={!name.trim()}
          data-testid="new-group-confirm"
        >
          Create
        </button>
      </div>
    </Modal>
  )
}
