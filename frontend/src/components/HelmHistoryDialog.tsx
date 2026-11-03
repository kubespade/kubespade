import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { HelmRevision } from '../types'
import { Modal } from './Modal'
import { formatAge } from '../lib/formatAge'

interface Props {
  profile: string
  name: string
  namespace: string
  onClose: () => void
  onRolledBack: () => void
}

export function HelmHistoryDialog({ profile, name, namespace, onClose, onRolledBack }: Props) {
  const [revisions, setRevisions] = useState<HelmRevision[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [rolling, setRolling] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    api.listHelmReleaseHistory(profile, namespace, name)
      .then(d => { if (!cancelled) setRevisions(d.revisions) })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load history') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [profile, name, namespace])

  async function handleRollback(rev: number) {
    setRolling(rev)
    setError('')
    try {
      await api.rollbackHelmRelease(profile, namespace, name, rev)
      onRolledBack()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Rollback failed')
      setRolling(null)
    }
  }

  return (
    <Modal
      onClose={onClose}
      backdropClassName="confirm-backdrop overlay-backdrop"
      className="confirm-dialog overlay-pop"
      dismissTrigger="click"
      closeOnEscape={false}
      style={{ width: 560 }}
    >
      <div className="confirm-title">Helm history — {namespace}/{name}</div>
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
              <th>Status</th>
              <th>Chart</th>
              <th>Updated</th>
              <th>Description</th>
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
                <td>{r.status || '—'}</td>
                <td className="rollout-images" title={`${r.chart} ${r.chartVersion}`}>
                  {r.chart}{r.chartVersion ? `-${r.chartVersion}` : ''}
                </td>
                <td>{r.updated ? formatAge(Date.now(), r.updated) : '—'}</td>
                <td className="rollout-cause" title={r.description}>{r.description || '—'}</td>
                <td>
                  {!r.current && (
                    <button
                      type="button"
                      className="confirm-btn confirm-btn-primary"
                      style={{ padding: '3px 8px', fontSize: 11 }}
                      disabled={rolling !== null}
                      onClick={() => handleRollback(r.revision)}
                    >
                      {rolling === r.revision ? '…' : 'Rollback'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="confirm-actions">
        <button type="button" className="confirm-btn confirm-btn-cancel" onClick={onClose} disabled={rolling !== null}>
          Close
        </button>
      </div>
    </Modal>
  )
}
