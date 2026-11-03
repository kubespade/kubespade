import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Trash2 } from 'lucide-react'
import { api, type NodeTaint } from '../api/client'
import { fixedAnchorCenterTop } from '../lib/uiZoom'
import { Modal } from './Modal'

const EFFECTS = ['NoSchedule', 'PreferNoSchedule', 'NoExecute'] as const

interface Props {
  profile: string
  nodeName: string
  onClose: () => void
}

function formatTaint(t: NodeTaint): string {
  return t.value ? `${t.key}=${t.value}:${t.effect}` : `${t.key}:${t.effect}`
}

export function NodeTaintsDialog({ profile, nodeName, onClose }: Props) {
  const [taints, setTaints] = useState<NodeTaint[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [key, setKey] = useState('')
  const [value, setValue] = useState('')
  const [effect, setEffect] = useState<string>('NoSchedule')
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null)

  function showTip(e: React.MouseEvent, text: string) {
    const { x, y } = fixedAnchorCenterTop(e.currentTarget as HTMLElement)
    setTip({ text, x, y })
  }
  function hideTip() { setTip(null) }

  async function reload() {
    setLoading(true)
    setError('')
    try {
      const d = await api.listNodeTaints(profile, nodeName)
      setTaints(d.taints)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load taints')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api.listNodeTaints(profile, nodeName)
      .then(d => { if (!cancelled) setTaints(d.taints) })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load taints') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [profile, nodeName])

  async function handleAdd() {
    const k = key.trim()
    if (!k) {
      setError('Key is required')
      return
    }
    setBusy(true)
    setError('')
    try {
      await api.addNodeTaint(profile, nodeName, k, value.trim(), effect)
      setKey('')
      setValue('')
      await reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Add failed')
    } finally {
      setBusy(false)
    }
  }

  async function handleRemove(t: NodeTaint) {
    setBusy(true)
    setError('')
    hideTip()
    try {
      await api.removeNodeTaint(profile, nodeName, t.key, t.effect)
      await reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Remove failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Modal
        onClose={onClose}
        backdropClassName="confirm-backdrop overlay-backdrop"
        className="confirm-dialog taints-dialog overlay-pop"
        dismissTrigger="click"
      >
        <div className="taints-dialog-header">
          <div className="confirm-title">Taints</div>
          <div className="taints-dialog-node" title={nodeName}>{nodeName}</div>
        </div>

        {loading && <div className="confirm-message">Loading…</div>}
        {error && <div className="confirm-error">{error}</div>}

        {!loading && taints.length === 0 && !error && (
          <div className="confirm-message">No taints on this node.</div>
        )}

        {taints.length > 0 && (
          <ul className="taints-list">
            {taints.map(t => (
              <li key={`${t.key}:${t.effect}`} className="taints-item">
                <code className="taints-code">{formatTaint(t)}</code>
                <button
                  type="button"
                  className="row-action-btn row-action-delete"
                  disabled={busy}
                  onClick={() => handleRemove(t)}
                  onMouseEnter={e => showTip(e, 'Remove taint')}
                  onMouseLeave={hideTip}
                >
                  <Trash2 size={11} />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="taints-add">
          <div className="taints-add-title">Add taint</div>
          <div className="taints-add-row">
            <input
              className="taints-input"
              placeholder="key"
              value={key}
              disabled={busy}
              onChange={e => setKey(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAdd() }}
              autoFocus
            />
            <input
              className="taints-input"
              placeholder="value (optional)"
              value={value}
              disabled={busy}
              onChange={e => setValue(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAdd() }}
            />
            <select
              className="taints-select"
              value={effect}
              disabled={busy}
              onChange={e => setEffect(e.target.value)}
            >
              {EFFECTS.map(ef => <option key={ef} value={ef}>{ef}</option>)}
            </select>
            <button
              className="confirm-btn confirm-btn-primary"
              disabled={busy || !key.trim()}
              onClick={handleAdd}
            >
              {busy ? '…' : 'Add'}
            </button>
          </div>
        </div>

        <div className="confirm-actions">
          <button className="confirm-btn confirm-btn-cancel" onClick={onClose} disabled={busy}>Close</button>
        </div>
      </Modal>

      {tip && createPortal(
        <span className="row-action-tip" style={{ left: tip.x, top: tip.y }}>
          {tip.text}
        </span>,
        document.body,
      )}
    </>
  )
}
