import { useState } from 'react'

const CREATE_VALUE = '__create__'

interface Props {
  value: string
  onChange: (group: string) => void
  groups: string[]
  onCreateGroup: (name: string) => Promise<string[]>
  className?: string
}

/** Group picker with inline "create group" option. */
export function GroupSelect({ value, onChange, groups, onCreateGroup, className = 'acm-select' }: Props) {
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function commitCreate() {
    const name = newName.trim()
    if (!name) {
      setCreating(false)
      setNewName('')
      return
    }
    if (groups.includes(name)) {
      onChange(name)
      setCreating(false)
      setNewName('')
      return
    }
    setBusy(true)
    setError('')
    try {
      await onCreateGroup(name)
      onChange(name)
      setCreating(false)
      setNewName('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create group')
    } finally {
      setBusy(false)
    }
  }

  if (creating) {
    return (
      <div className="group-select-create">
        <input
          className="acm-input"
          placeholder="New group name…"
          value={newName}
          autoFocus
          disabled={busy}
          onChange={e => { setNewName(e.target.value); setError('') }}
          onKeyDown={e => {
            if (e.key === 'Enter') commitCreate()
            if (e.key === 'Escape') { setCreating(false); setNewName(''); setError('') }
          }}
        />
        <div className="group-select-create-actions">
          <button type="button" className="group-select-create-btn" onClick={commitCreate} disabled={busy || !newName.trim()}>
            {busy ? '…' : 'Create'}
          </button>
          <button type="button" className="group-select-create-cancel" onClick={() => { setCreating(false); setNewName(''); setError('') }}>
            Cancel
          </button>
        </div>
        {error && <div className="group-select-create-error">{error}</div>}
      </div>
    )
  }

  return (
    <select
      className={className}
      value={value}
      onChange={e => {
        if (e.target.value === CREATE_VALUE) {
          setCreating(true)
          return
        }
        onChange(e.target.value)
      }}
    >
      <option value="">No group</option>
      {groups.map(g => <option key={g} value={g}>{g}</option>)}
      <option value={CREATE_VALUE}>+ Create group…</option>
    </select>
  )
}
