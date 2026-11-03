import { useRef, useState } from 'react'
import { Pencil } from 'lucide-react'
import { api } from '../api/client'
import { connectProfile, authProfileSafe } from '../lib/connectProfile'
import { EmptyState } from '../components/EmptyState'
import type { EKSCluster, Profile } from '../types'
import { PROFILE_DISPLAY_NAME_MAX, profileLabel, profileLocation } from '../lib/profileLabel'

export { AddClusterModal } from './AddClusterModal'

interface Props {
  profiles: Profile[]
  selectedProfile: string | null
  recentNames: string[]
  onConnected: (profileName: string) => void
  onReload: () => void
  onAdd: () => void
}

interface ProfileState {
  profile: Profile
  loading: boolean
  error: string
  needsMFA: boolean
  mfaToken: string
  clusters: EKSCluster[]
  showClusters: boolean
}

export function ManagePage({ profiles, selectedProfile, recentNames, onConnected, onReload, onAdd }: Props) {
  const [states, setStates] = useState<ProfileState[]>(() =>
    profiles.map(p => ({
      profile: p, loading: false, error: '', needsMFA: false,
      mfaToken: '', clusters: [], showClusters: false,
    }))
  )
  const [renamingName, setRenamingName] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const renameCancelRef = useRef(false)
  const mergedStates: ProfileState[] = profiles.map(p => {
    const existing = states.find(s => s.profile.name === p.name)
    return existing ? { ...existing, profile: p } : {
      profile: p, loading: false, error: '', needsMFA: false,
      mfaToken: '', clusters: [], showClusters: false,
    }
  })

  function update(name: string, patch: Partial<ProfileState>) {
    setStates(prev => {
      const has = prev.find(s => s.profile.name === name)
      if (has) return prev.map(s => s.profile.name === name ? { ...s, ...patch } : s)
      const p = profiles.find(p => p.name === name)!
      return [...prev, { profile: p, loading: false, error: '', needsMFA: false, mfaToken: '', clusters: [], showClusters: false, ...patch }]
    })
  }

  async function handleConnect(name: string) {
    const s = mergedStates.find(s => s.profile.name === name)!
    update(name, { loading: true, error: '' })
    try {
      const result = await connectProfile(s.profile, s.mfaToken)
      if (result.status === 'connected') {
        onConnected(name)
        return
      }
      if (result.status === 'mfa') {
        update(name, {
          needsMFA: true,
          mfaToken: '',
          error: result.message ?? (s.mfaToken ? 'MFA failed — check code and try again' : ''),
        })
        return
      }
      if (result.status === 'pick-cluster') {
        update(name, { clusters: result.clusters, showClusters: true, needsMFA: false })
        return
      }
      update(name, { error: result.message })
    } finally {
      update(name, { loading: false })
    }
  }

  async function handleSelectCluster(profileName: string, cluster: EKSCluster) {
    const s = mergedStates.find(s => s.profile.name === profileName)!
    update(profileName, { loading: true, error: '' })
    try {
      await authProfileSafe(profileName, cluster.name, s.mfaToken, cluster.resourceGroup)
      onConnected(profileName)
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Error'
      if (/MFA failed|invalid MFA|MultiFactorAuthentication|one time pass ?code|MFA required/i.test(message)) {
        update(profileName, {
          needsMFA: true,
          showClusters: false,
          mfaToken: '',
          error: message,
        })
      } else {
        update(profileName, { error: message })
      }
    } finally {
      update(profileName, { loading: false })
    }
  }

  async function handleDelete(p: Profile) {
    const label = profileLabel(p)
    const livePath = p.type === 'kubeconfig' && p.kubeconfigPath && !p.kubeconfigEmbedded
      ? p.kubeconfigPath
      : ''
    const liveCount = livePath
      ? profiles.filter(x => x.type === 'kubeconfig' && x.kubeconfigPath === livePath).length
      : 0
    let msg = `Remove "${label}" from KubeSpade?`
    if (livePath && liveCount <= 1) {
      msg += `\n\nThis stops watching ${livePath}. Clusters from that file will not come back until you import it again.`
    } else if (livePath) {
      msg += '\n\nIt will stay out of the app until you add it again. Other clusters from this kubeconfig keep syncing.'
    }
    if (!confirm(msg)) return
    await api.deleteProfile(p.name)
    onReload()
  }

  async function commitRename(p: Profile) {
    if (renameCancelRef.current) {
      renameCancelRef.current = false
      return
    }
    if (renamingName !== p.name) return
    const next = renameValue.trim()
    setRenamingName(null)
    if (next === profileLabel(p)) return
    await api.setProfileDisplayName(p.name, next)
    onReload()
  }

  async function handleUnlinkKubeconfig(path: string, count: number) {
    const noun = count === 1 ? 'cluster' : 'clusters'
    if (!confirm(`Remove all ${count} ${noun} imported from\n${path}\n\nThe file will no longer be watched.`)) return
    await api.unlinkKubeconfig(path)
    onReload()
  }

  const liveKubeFiles = (() => {
    const counts = new Map<string, number>()
    for (const p of profiles) {
      if (p.type === 'kubeconfig' && p.kubeconfigPath && !p.kubeconfigEmbedded) {
        counts.set(p.kubeconfigPath, (counts.get(p.kubeconfigPath) ?? 0) + 1)
      }
    }
    return [...counts.entries()].map(([path, count]) => ({ path, count }))
  })()

  async function handleDisconnect(name: string) {
    update(name, { loading: true, error: '' })
    try {
      await api.disconnectProfile(name)
      onReload()
    } catch (e) {
      update(name, { error: e instanceof Error ? e.message : 'Disconnect failed' })
    } finally {
      update(name, { loading: false })
    }
  }

  function typeBadge(p: Profile): string {
    if (p.type === 'kubeconfig') return 'kubeconfig'
    if (p.type === 'gcp') return 'GCP'
    if (p.type === 'azure') return 'Azure'
    return 'AWS'
  }

  /** Secondary lines under the card title — ARN / region / path, etc. */
  function profileMetaLines(p: Profile, hideLivePath: boolean): string[] {
    const lines: string[] = []
    const label = profileLabel(p)
    if (p.type === 'kubeconfig') {
      // Prefer full context / EKS ARN when the title is a short display name.
      if (p.clusterName && p.clusterName !== label) {
        lines.push(p.clusterName)
      } else {
        const loc = profileLocation(p)
        if (loc) lines.push(loc)
      }
      if (p.kubeconfigPath) {
        if (!hideLivePath) lines.push(p.kubeconfigPath)
      } else {
        lines.push(p.kubeconfigEmbedded ? 'pasted kubeconfig' : 'embedded kubeconfig')
      }
      return lines
    }
    const loc = profileLocation(p)
    if (loc) lines.push(loc)
    if (p.roleArn) lines.push(p.roleArn)
    if (p.type === 'gcp' && p.projectId) lines.push(p.projectId)
    if (p.type === 'azure' && (p.resourceGroup || p.subscriptionId)) {
      lines.push([p.resourceGroup, p.subscriptionId].filter(Boolean).join(' · '))
    }
    return lines
  }

  function connectLabel(s: ProfileState): string {
    if (s.loading) return '…'
    const known = recentNames.includes(s.profile.name) || selectedProfile === s.profile.name
    return known ? 'Reconnect' : 'Connect'
  }

  function sortByRecent(list: ProfileState[]): ProfileState[] {
    const rank = new Map(recentNames.map((n, i) => [n, i]))
    return [...list].sort((a, b) => {
      const ra = rank.get(a.profile.name) ?? 999
      const rb = rank.get(b.profile.name) ?? 999
      if (ra !== rb) return ra - rb
      const la = profileLabel(a.profile).toLowerCase()
      const lb = profileLabel(b.profile).toLowerCase()
      return la.localeCompare(lb)
    })
  }

  function renderCard(s: ProfileState, hideLivePath: boolean) {
    const metaLines = profileMetaLines(s.profile, hideLivePath)
    return (
      <div key={s.profile.name} className={`manage-card ${s.profile.sessionActive ? 'active' : ''}${selectedProfile === s.profile.name ? ' manage-card-focus' : ''}`}>
        <div className="manage-card-top">
          <div className="manage-card-main">
            <div className="manage-card-name">
              {renamingName === s.profile.name ? (
                <input
                  className="manage-card-rename-input"
                  value={renameValue}
                  maxLength={PROFILE_DISPLAY_NAME_MAX}
                  autoFocus
                  onChange={e => setRenameValue(e.target.value)}
                  onBlur={() => { void commitRename(s.profile) }}
                  onKeyDown={e => {
                    if (e.key === 'Enter') void commitRename(s.profile)
                    if (e.key === 'Escape') {
                      renameCancelRef.current = true
                      setRenamingName(null)
                    }
                  }}
                />
              ) : (
                profileLabel(s.profile)
              )}
              <span className="profile-type-badge">{typeBadge(s.profile)}</span>
            </div>
            {metaLines.map(line => (
              <div key={line} className="manage-card-meta" title={line}>{line}</div>
            ))}
          </div>
          <div className="manage-card-actions">
            <span
              className={`session-dot ${s.profile.sessionActive ? 'on' : 'off'}`}
              title={s.profile.sessionActive ? 'Session active' : 'No session'}
            />
            {s.profile.connected && (
              <span className="connected-badge">connected</span>
            )}
            {!s.needsMFA && !s.showClusters && (
              s.profile.connected ? (
                <>
                  <button className="btn-open" onClick={() => onConnected(s.profile.name)}>Open</button>
                  <button
                    className="btn-disconnect"
                    onClick={() => handleDisconnect(s.profile.name)}
                    disabled={s.loading}
                  >
                    {s.loading ? '…' : 'Disconnect'}
                  </button>
                </>
              ) : (
                <button className="manage-card-connect" onClick={() => handleConnect(s.profile.name)} disabled={s.loading}>
                  {connectLabel(s)}
                </button>
              )
            )}
            <button
              className="icon-btn icon-btn-quiet"
              onClick={() => {
                setRenamingName(s.profile.name)
                setRenameValue(profileLabel(s.profile))
              }}
              title="Rename in app"
            >
              <Pencil size={13} />
            </button>
            <button className="icon-btn" onClick={() => handleDelete(s.profile)} title="Delete">✕</button>
          </div>
        </div>

        {s.error && <div className="card-error">{s.error}</div>}

        {s.needsMFA && !s.showClusters && (
          <div className="mfa-row">
            <input
              type="text" placeholder="MFA code" maxLength={6}
              inputMode="numeric" autoComplete="one-time-code"
              value={s.mfaToken}
              onChange={e => update(s.profile.name, { mfaToken: e.target.value })}
              onKeyDown={e => e.key === 'Enter' && handleConnect(s.profile.name)}
            />
            <button onClick={() => handleConnect(s.profile.name)} disabled={s.loading || s.mfaToken.length < 6}>
              {s.loading ? '…' : 'Auth'}
            </button>
          </div>
        )}

        {s.showClusters && (
          <div className="cluster-select">
            <p className="select-label">Select cluster:</p>
            {s.clusters.map(c => (
              <button key={`${c.name}-${c.location ?? ''}-${c.resourceGroup ?? ''}`} className="cluster-item"
                onClick={() => handleSelectCluster(s.profile.name, c)}
                disabled={s.loading}>
                <span className="cluster-item-name">{c.name}</span>
                {c.location && <span className="cluster-item-ver">{c.location}</span>}
                {!c.location && c.version && <span className="cluster-item-ver">K8s {c.version}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  const liveGroups = liveKubeFiles.map(({ path, count }) => ({
    path,
    count,
    states: sortByRecent(mergedStates.filter(s =>
      s.profile.type === 'kubeconfig' && s.profile.kubeconfigPath === path && !s.profile.kubeconfigEmbedded,
    )),
  }))
  const pastedStates = sortByRecent(mergedStates.filter(s =>
    s.profile.type === 'kubeconfig' && (!s.profile.kubeconfigPath || s.profile.kubeconfigEmbedded),
  ))
  const credentialStates = sortByRecent(mergedStates.filter(s => s.profile.type !== 'kubeconfig'))
  const credentialMeta = [...new Set(credentialStates.map(s => typeBadge(s.profile)))].join(' · ')

  return (
    <div className="manage-page">
      <div className="manage-header">
        <h2>Manage Clusters</h2>
        <button type="button" className="page-header-btn" onClick={onAdd}>+ Add</button>
      </div>

      <div className="manage-list">
        {mergedStates.length === 0 && (
          <div className="manage-empty">
            <EmptyState
              title="No clusters configured yet"
              hint={<>Use <strong>+ Add</strong> to import a cluster.</>}
              action={{ label: '+ Add', onClick: onAdd }}
            />
          </div>
        )}

        {liveGroups.map(({ path, count, states }) => (
          <div key={path} className="manage-kube-group">
            <div className="manage-kube-group-head">
              <div className="manage-kube-group-title">
                <span className="manage-kube-group-path" title={path}>{path}</span>
                <span className="manage-kube-group-meta">live · {count}</span>
              </div>
              <button type="button" className="manage-kube-watch-stop" onClick={() => handleUnlinkKubeconfig(path, count)}>
                Stop watching
              </button>
            </div>
            <div className="manage-kube-group-items">
              {states.map(s => renderCard(s, true))}
            </div>
          </div>
        ))}

        {pastedStates.length > 0 && (
          <div className="manage-kube-group">
            <div className="manage-kube-group-head">
              <div className="manage-kube-group-title">
                <span className="manage-group-label">Pasted kubeconfig</span>
                <span className="manage-kube-group-meta">{pastedStates.length}</span>
              </div>
            </div>
            <div className="manage-kube-group-items">
              {pastedStates.map(s => renderCard(s, false))}
            </div>
          </div>
        )}

        {credentialStates.length > 0 && (
          <div className="manage-kube-group">
            <div className="manage-kube-group-head">
              <div className="manage-kube-group-title">
                <span className="manage-group-label">Provider account</span>
                <span className="manage-kube-group-meta">{credentialMeta}</span>
              </div>
            </div>
            <div className="manage-kube-group-items">
              {credentialStates.map(s => renderCard(s, false))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
