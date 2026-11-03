import { useEffect, useState } from 'react'
import { api, type RolloutRevision } from '../api/client'
import { Modal } from './Modal'
import { formatAge } from '../lib/formatAge'

interface Props {
  profile: string
  name: string
  namespace?: string
  onClose: () => void
  /** Called after a successful rollback to a specific revision. */
  onRolledBack: () => void
}

export function RolloutHistoryDialog({ profile, name, namespace, onClose, onRolledBack }: Props) {
  const [revisions, setRevisions] = useState<RolloutRevision[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [undoing, setUndoing] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    api.listDeploymentRevisions(profile, name, namespace)
      .then(d => { if (!cancelled) setRevisions(d.revisions) })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load history') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [profile, name, namespace])

  async function handleRollback(rev: number) {
    setUndoing(rev)
    setError('')
    try {
      await api.undoDeployment(profile, name, namespace, rev)
      onRolledBack()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Undo failed')
      setUndoing(null)
    }
  }

  return (
    <Modal
      onClose={onClose}
      backdropClassName="confirm-backdrop overlay-backdrop"
      className="confirm-dialog overlay-pop"
      dismissTrigger="click"
      closeOnEscape={false}
      style={{ width: 520 }}
    >
      <div className="confirm-title">Rollout history — {name}</div>
      {loading && <div className="confirm-message">Loading…</div>}
      {error && <div className="confirm-error">{error}</div>}
      {!loading && revisions.length === 0 && !error && (
        <div className="confirm-message">No revisions found.</div>
      )}
      {revisions.length > 0 && (
        <table className="rollout-history-table">
          <thead>
            <tr>
              <th>Revision</th>
              <th>Age</th>
              <th>Replicas</th>
              <th>Images</th>
              <th>Change-cause</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {revisions.map(r => (
              <tr key={r.revision} className={r.current ? 'rollout-current' : undefined}>
                <td>
                  {r.revision}
                  {r.current && <span className="rollout-current-badge">current</span>}
                </td>
                <td>{formatAge(Date.now(), r.age)}</td>
                <td>{r.replicas}</td>
                <td className="rollout-images" title={r.images}>{r.images || '—'}</td>
                <td className="rollout-cause" title={r.changeCause}>{r.changeCause || '—'}</td>
                <td>
                  {!r.current && (
                    <button
                      className="confirm-btn confirm-btn-primary"
                      style={{ padding: '3px 8px', fontSize: 11 }}
                      disabled={undoing !== null}
                      onClick={() => handleRollback(r.revision)}
                    >
                      {undoing === r.revision ? '…' : 'Rollback'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="confirm-actions">
        <button className="confirm-btn confirm-btn-cancel" onClick={onClose} disabled={undoing !== null}>Close</button>
      </div>
    </Modal>
  )
}
