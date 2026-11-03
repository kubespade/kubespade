import { useState } from 'react'
import { X } from 'lucide-react'
import { connectProfile, authProfileSafe, type ConnectResult } from '../lib/connectProfile'
import type { EKSCluster, Profile } from '../types'
import { Modal } from './Modal'

interface Props {
  profile: Profile
  initial: ConnectResult
  onClose: () => void
  onConnected: (profileName: string) => void
}

export function ConnectOverlay({ profile, initial, onClose, onConnected }: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(initial.status === 'error' ? initial.message : '')
  const [needsMFA, setNeedsMFA] = useState(initial.status === 'mfa')
  const [mfaToken, setMfaToken] = useState('')
  const [clusters, setClusters] = useState<EKSCluster[]>(
    initial.status === 'pick-cluster' ? initial.clusters : [],
  )
  const [showClusters, setShowClusters] = useState(initial.status === 'pick-cluster')

  async function runConnect(token = mfaToken) {
    setLoading(true)
    setError('')
    try {
      const result = await connectProfile(profile, token)
      if (result.status === 'connected') {
        onConnected(profile.name)
        return
      }
      if (result.status === 'mfa') {
        setNeedsMFA(true)
        setMfaToken('')
        if (token || result.message) {
          setError(result.message || 'MFA failed — check code and try again')
        }
        return
      }
      if (result.status === 'pick-cluster') {
        setClusters(result.clusters)
        setShowClusters(true)
        setNeedsMFA(false)
        return
      }
      setError(result.message)
    } finally {
      setLoading(false)
    }
  }

  async function pickCluster(cluster: EKSCluster) {
    setLoading(true)
    setError('')
    try {
      await authProfileSafe(profile.name, cluster.name, mfaToken, cluster.resourceGroup)
      onConnected(profile.name)
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Connection failed'
      if (/MFA failed|invalid MFA|MultiFactorAuthentication|one time pass ?code|MFA required/i.test(message)) {
        setNeedsMFA(true)
        setShowClusters(false)
        setMfaToken('')
        setError(message)
      } else {
        setError(message)
      }
    } finally {
      setLoading(false)
    }
  }

  const label = profile.displayName || profile.clusterName || profile.name

  return (
    <Modal
      onClose={onClose}
      backdropClassName="connect-overlay-backdrop overlay-backdrop"
      className="connect-overlay overlay-pop"
      dismissOnBackdrop={false}
    >
      <div className="connect-overlay-header">
        <span>Connect to {label}</span>
        <button className="acm-close-btn" onClick={onClose}><X size={15} /></button>
      </div>
      <div className="connect-overlay-body">
        {error && <div className="card-error">{error}</div>}

        {needsMFA && !showClusters && (
          <div className="mfa-row">
            <input
              type="text" placeholder="MFA code" maxLength={6}
              inputMode="numeric" autoComplete="one-time-code"
              value={mfaToken}
              autoFocus
              onChange={e => setMfaToken(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && mfaToken.length >= 6 && runConnect()}
            />
            <button onClick={() => runConnect()} disabled={loading || mfaToken.length < 6}>
              {loading ? '…' : 'Auth'}
            </button>
          </div>
        )}

        {showClusters && (
          <div className="cluster-select">
            <p className="select-label">Select cluster:</p>
            {clusters.map(c => (
              <button
                key={`${c.name}-${c.location ?? ''}-${c.resourceGroup ?? ''}`}
                className="cluster-item"
                onClick={() => pickCluster(c)}
                disabled={loading}
              >
                <span className="cluster-item-name">{c.name}</span>
                {c.location && <span className="cluster-item-ver">{c.location}</span>}
                {!c.location && c.version && <span className="cluster-item-ver">K8s {c.version}</span>}
              </button>
            ))}
          </div>
        )}

        {!needsMFA && !showClusters && (
          <div className="connect-overlay-actions">
            <button onClick={() => runConnect()} disabled={loading}>
              {loading ? 'Connecting…' : 'Retry'}
            </button>
          </div>
        )}
      </div>
    </Modal>
  )
}
