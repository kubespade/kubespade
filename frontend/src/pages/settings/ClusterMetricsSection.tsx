import { useEffect, useState } from 'react'
import { Gauge } from 'lucide-react'
import { api } from '../../api/client'
import type { MetricsSourceSettings, PrometheusRef } from '../../api/client'
import {
  CMC_DEFAULT_RETENTION,
  CMC_RETENTION_OPTIONS,
  normalizeRetentionDays,
  type CmcRetentionDays,
} from '../../api/clusterMetrics/constants'
import { rememberCollectorState, setCachedCollectorEnabled, setCachedCollectorRetention } from '../../api/clusterMetrics/statusCache'
import type { Profile } from '../../types'
import { profileLabel } from '../../lib/profileLabel'

function promRefKey(ref: Pick<PrometheusRef, 'namespace' | 'name' | 'port'>): string {
  return `${ref.namespace}/${ref.name}:${ref.port}`
}

function shortPromService(name: string): string {
  return name
    .replace(/^prometheus-stack-kube-prom-/, '')
    .replace(/^kube-prometheus-stack-/, '')
    .replace(/^prometheus-/, '')
}

function promStatusLine(ms: MetricsSourceSettings | undefined): string {
  const selected = ms?.selected
  const top = selected ?? ms?.discovered?.[0]
  const bits: string[] = []
  if (top) {
    const label = `${top.namespace}/${shortPromService(top.name)}`
    bits.push(top.healthy === false ? `Prometheus: ${label}?` : `Prometheus: ${label}`)
  } else {
    bits.push('Prometheus: not found')
  }
  if (ms?.prometheusURL) bits.push('external URL set')
  if (ms?.hasBearer) bits.push('bearer saved')
  return bits.join(' · ')
}

type CmcRowStatus = {
  state: string
  message?: string
  retentionDays?: number
  desiredRetention?: CmcRetentionDays
  manifestVersion?: number
  updateAvailable?: boolean
  busy?: boolean
  error?: string
}

interface Props {
  profiles: Profile[]
}

export function ClusterMetricsSection({ profiles }: Props) {
  const [cmcByProfile, setCmcByProfile] = useState<Record<string, CmcRowStatus>>({})
  const [cmcBulkBusy, setCmcBulkBusy] = useState(false)
  const [cmcError, setCmcError] = useState('')
  const [metricsSrcByProfile, setMetricsSrcByProfile] = useState<Record<string, MetricsSourceSettings>>({})
  const [metricsSrcBusy, setMetricsSrcBusy] = useState<string | null>(null)
  const [metricsSectionTab, setMetricsSectionTab] = useState<'collector' | 'prometheus'>('collector')
  const [promAdvancedOpen, setPromAdvancedOpen] = useState<Record<string, boolean>>({})
  const connectedProfiles = profiles.filter(p => p.connected)

  function retentionFor(name: string): CmcRetentionDays {
    const row = cmcByProfile[name]
    return row?.desiredRetention ?? normalizeRetentionDays(row?.retentionDays)
  }

  useEffect(() => {
    if (connectedProfiles.length === 0) return
    let cancelled = false
    void (async () => {
      const next: Record<string, CmcRowStatus> = {}
      await Promise.all(connectedProfiles.map(async p => {
        try {
          const s = await api.getClusterMetricsCollector(p.name)
          next[p.name] = {
            state: s.state,
            message: s.message,
            retentionDays: s.retentionDays,
            desiredRetention: normalizeRetentionDays(s.retentionDays),
            manifestVersion: s.manifestVersion,
            updateAvailable: s.updateAvailable,
          }
          rememberCollectorState(p.name, s.state, s.retentionDays)
        } catch (e) {
          next[p.name] = {
            state: 'error',
            message: e instanceof Error ? e.message : String(e),
            desiredRetention: CMC_DEFAULT_RETENTION,
          }
        }
      }))
      if (!cancelled) {
        setCmcByProfile(prev => {
          const merged: Record<string, CmcRowStatus> = { ...prev }
          for (const [name, row] of Object.entries(next)) {
            const prevDesired = prev[name]?.desiredRetention
            const prevInstalled = prev[name]?.retentionDays
            const keepDraft = prevDesired != null
              && prevInstalled != null
              && prevDesired !== normalizeRetentionDays(prevInstalled)
            merged[name] = {
              ...row,
              desiredRetention: keepDraft ? prevDesired : (row.desiredRetention ?? CMC_DEFAULT_RETENTION),
            }
          }
          return merged
        })
      }
    })()
    return () => { cancelled = true }
  }, [connectedProfiles.map(p => p.name).join(',')])

  useEffect(() => {
    if (connectedProfiles.length === 0) return
    let cancelled = false
    void (async () => {
      const srcNext: Record<string, MetricsSourceSettings> = {}
      await Promise.all(connectedProfiles.map(async p => {
        try {
          srcNext[p.name] = await api.getMetricsSource(p.name)
        } catch {
          srcNext[p.name] = { source: 'auto', discovered: [] }
        }
      }))
      if (!cancelled) setMetricsSrcByProfile(prev => ({ ...prev, ...srcNext }))
    })()
    return () => { cancelled = true }
  }, [connectedProfiles.map(p => p.name).join(',')])

  async function saveMetricsSource(name: string, patch: {
    source?: string
    prometheusNamespace?: string
    prometheusService?: string
    prometheusPort?: string
    prometheusURL?: string
    prometheusBearer?: string
    clearBearer?: boolean
  }) {
    setMetricsSrcBusy(name)
    setCmcError('')
    try {
      const cur = metricsSrcByProfile[name]
      const s = await api.setMetricsSource(name, {
        source: patch.source ?? cur?.source ?? 'auto',
        prometheusNamespace: patch.prometheusNamespace ?? cur?.prometheusNamespace ?? '',
        prometheusService: patch.prometheusService ?? cur?.prometheusService ?? '',
        prometheusPort: patch.prometheusPort ?? cur?.prometheusPort ?? '',
        prometheusURL: patch.prometheusURL ?? cur?.prometheusURL ?? '',
        prometheusBearer: patch.prometheusBearer,
        clearBearer: patch.clearBearer,
      })
      setMetricsSrcByProfile(prev => ({ ...prev, [name]: s }))
    } catch (e) {
      setCmcError(e instanceof Error ? e.message : String(e))
    } finally {
      setMetricsSrcBusy(null)
    }
  }

  function pickDiscovered(name: string, ref: PrometheusRef) {
    void saveMetricsSource(name, {
      source: 'auto',
      prometheusNamespace: ref.namespace,
      prometheusService: ref.name,
      prometheusPort: ref.port,
      prometheusURL: '',
    })
  }

  function patchCmc(name: string, patch: Partial<CmcRowStatus>) {
    setCmcByProfile(prev => ({ ...prev, [name]: { ...prev[name], state: prev[name]?.state ?? '—', ...patch } }))
  }

  async function refreshOne(name: string, opts?: { keepDesired?: boolean }) {
    const s = await api.getClusterMetricsCollector(name)
    rememberCollectorState(name, s.state, s.retentionDays)
    setCmcByProfile(prev => {
      const cur = prev[name]
      const desired = opts?.keepDesired && cur?.desiredRetention != null
        ? cur.desiredRetention
        : normalizeRetentionDays(s.retentionDays)
      return {
        ...prev,
        [name]: {
          ...cur,
          state: s.state,
          message: s.message,
          retentionDays: s.retentionDays,
          desiredRetention: desired,
          manifestVersion: s.manifestVersion,
          updateAvailable: s.updateAvailable,
          error: undefined,
          busy: cur?.busy,
        },
      }
    })
    return s
  }

  async function enableOne(name: string) {
    const days = retentionFor(name)
    patchCmc(name, {
      busy: true,
      error: undefined,
      state: 'pending',
      message: 'Applying…',
      desiredRetention: days,
      updateAvailable: false,
    })
    setCmcError('')
    try {
      await api.setClusterMetricsCollector(name, { enabled: true, retentionDays: days })
      setCachedCollectorEnabled(name, true)
      setCachedCollectorRetention(name, days)
      void saveMetricsSource(name, { source: 'auto' })
      for (let i = 0; i < 8; i++) {
        await new Promise(r => setTimeout(r, 1500))
        const st = await refreshOne(name, { keepDesired: true })
        const stored = st.retentionDays != null ? normalizeRetentionDays(st.retentionDays) : null
        if (st.state === 'error') break
        if (st.state === 'running' && stored === days) break
      }
      await refreshOne(name)
      patchCmc(name, { desiredRetention: days })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      patchCmc(name, { state: 'error', error: msg, message: msg })
      setCmcError(msg)
    } finally {
      patchCmc(name, { busy: false })
    }
  }

  async function disableOne(name: string) {
    patchCmc(name, {
      busy: true,
      error: undefined,
      state: 'pending',
      message: 'Removing…',
      updateAvailable: false,
    })
    setCmcError('')
    try {
      await api.setClusterMetricsCollector(name, { enabled: false })
      setCachedCollectorEnabled(name, false)
      // Deletes are async in-cluster — keep "Removing…" until pods/namespace are gone.
      for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 2000))
        const st = await refreshOne(name)
        if (st.state === 'missing' || st.state === 'disabled') break
        patchCmc(name, { state: 'pending', message: st.message || 'Removing…' })
      }
      await refreshOne(name)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      patchCmc(name, { state: 'error', error: msg, message: msg })
      setCmcError(msg)
    } finally {
      patchCmc(name, { busy: false })
    }
  }

  async function enableAll() {
    if (connectedProfiles.length === 0) return
    setCmcBulkBusy(true)
    setCmcError('')
    const errors: string[] = []
    for (const p of connectedProfiles) {
      try {
        await enableOne(p.name)
      } catch (e) {
        errors.push(`${profileLabel(p)}: ${e instanceof Error ? e.message : e}`)
      }
    }
    if (errors.length) setCmcError(errors.join('; '))
    setCmcBulkBusy(false)
  }

  async function disableAll() {
    if (connectedProfiles.length === 0) return
    setCmcBulkBusy(true)
    setCmcError('')
    for (const p of connectedProfiles) {
      await disableOne(p.name)
    }
    setCmcBulkBusy(false)
  }

  async function refreshMetricsSources() {
    if (connectedProfiles.length === 0) return
    const srcNext: Record<string, MetricsSourceSettings> = {}
    await Promise.all(connectedProfiles.map(async p => {
      try {
        srcNext[p.name] = await api.getMetricsSource(p.name)
      } catch {
        srcNext[p.name] = { source: 'auto', discovered: [] }
      }
    }))
    setMetricsSrcByProfile(prev => ({ ...prev, ...srcNext }))
  }

  async function refreshAll() {
    if (connectedProfiles.length === 0) return
    setCmcBulkBusy(true)
    setCmcError('')
    try {
      await Promise.all([
        ...connectedProfiles.map(p => refreshOne(p.name).catch(e => {
          patchCmc(p.name, { state: 'error', error: e instanceof Error ? e.message : String(e) })
        })),
        refreshMetricsSources(),
      ])
    } finally {
      setCmcBulkBusy(false)
    }
  }

  return (
    <div className="settings-panel-section">
      <div className="settings-section-title">
        <Gauge size={12} />
        Cluster metrics
      </div>

      <p className="settings-metrics-intro">
        Charts use Prometheus when found. Enable the collector to prefer in-cluster history instead.
      </p>

      <div className="settings-metrics-tabs settings-metrics-section-tabs" role="tablist" aria-label="Cluster metrics source">
        <button
          type="button"
          role="tab"
          aria-selected={metricsSectionTab === 'collector'}
          className={`settings-metrics-tab${metricsSectionTab === 'collector' ? ' active' : ''}`}
          onClick={() => setMetricsSectionTab('collector')}
        >
          Collector
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={metricsSectionTab === 'prometheus'}
          className={`settings-metrics-tab${metricsSectionTab === 'prometheus' ? ' active' : ''}`}
          onClick={() => setMetricsSectionTab('prometheus')}
        >
          Prometheus
        </button>
      </div>

      {connectedProfiles.length === 0 ? (
        <p className="settings-metrics-hint">Connect at least one cluster first.</p>
      ) : metricsSectionTab === 'collector' ? (
        <div className="settings-metrics-tab-panel" role="tabpanel">
          <div className="settings-metrics-toolbar">
            <span className="settings-metrics-toolbar-meta">
              {connectedProfiles.length} connected cluster{connectedProfiles.length === 1 ? '' : 's'}
            </span>
            <div className="settings-cmc-row-actions">
              <button
                type="button"
                className="settings-action-btn"
                disabled={cmcBulkBusy}
                onClick={() => void enableAll()}
              >
                Enable all
              </button>
              <button
                type="button"
                className="settings-action-btn"
                disabled={cmcBulkBusy}
                onClick={() => void disableAll()}
              >
                Disable all
              </button>
              <button
                type="button"
                className="settings-action-btn"
                disabled={cmcBulkBusy}
                onClick={() => void refreshAll()}
              >
                Refresh
              </button>
            </div>
          </div>

          <div className="settings-cmc-list">
            {connectedProfiles.map(p => {
              const row = cmcByProfile[p.name]
              const state = row?.state ?? '…'
              const busy = Boolean(row?.busy) || cmcBulkBusy
              const installed = state === 'running' || state === 'pending' || state === 'error'
              const desired = retentionFor(p.name)
              const retentionDirty = Boolean(
                installed
                && row?.retentionDays != null
                && normalizeRetentionDays(row.retentionDays) !== desired,
              )
              const needsUpdate = !busy && (Boolean(row?.updateAvailable) || retentionDirty)
              const showInstall = !installed && !busy
              const showUpdate = installed && needsUpdate
              const collectorStatus = busy
                ? (row?.message || 'Applying…')
                : [
                    state === 'missing' ? 'Not installed' : state,
                    row?.retentionDays ? `${row.retentionDays}d stored` : null,
                    retentionDirty ? `→ ${desired}d` : null,
                    needsUpdate ? 'update available' : null,
                    row?.error ? `(${row.error})` : null,
                  ].filter(Boolean).join(' · ')

              return (
                <div key={p.name} className="settings-cmc-row settings-cmc-row-compact">
                  <div className="settings-cmc-compact-main">
                    <div className="settings-cmc-row-info">
                      <span className="settings-cmc-name">{profileLabel(p)}</span>
                      <span className="settings-cmc-status" title={collectorStatus}>{collectorStatus}</span>
                    </div>
                    <div className="settings-cmc-retention" role="group" aria-label={`Retention for ${profileLabel(p)}`}>
                      {CMC_RETENTION_OPTIONS.map(d => (
                        <button
                          key={d}
                          type="button"
                          className={`settings-cmc-retention-btn${desired === d ? ' active' : ''}`}
                          disabled={busy}
                          onClick={() => patchCmc(p.name, { desiredRetention: d })}
                        >
                          {d}d
                        </button>
                      ))}
                    </div>
                    <div className="settings-cmc-row-actions">
                      {(showInstall || showUpdate) && (
                        <button
                          type="button"
                          className="settings-action-btn"
                          disabled={busy}
                          onClick={() => void enableOne(p.name)}
                        >
                          {showUpdate ? 'Update' : 'Enable'}
                        </button>
                      )}
                      <button
                        type="button"
                        className="settings-action-btn"
                        disabled={busy || state === 'missing' || state === '—'}
                        onClick={() => void disableOne(p.name)}
                      >
                        Disable
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
          <p className="settings-metrics-hint">
            When the collector has samples, charts use it instead of Prometheus. History stays in the cluster across app restarts.
          </p>
        </div>
      ) : (
        <div className="settings-metrics-tab-panel" role="tabpanel">
          <div className="settings-metrics-toolbar">
            <span className="settings-metrics-toolbar-meta">
              {connectedProfiles.length} connected cluster{connectedProfiles.length === 1 ? '' : 's'}
            </span>
            <div className="settings-cmc-row-actions">
              <button
                type="button"
                className="settings-action-btn"
                disabled={cmcBulkBusy}
                onClick={() => void refreshAll()}
              >
                Refresh
              </button>
            </div>
          </div>

          <div className="settings-cmc-list">
            {connectedProfiles.map(p => {
              const busy = cmcBulkBusy || metricsSrcBusy === p.name
              const ms = metricsSrcByProfile[p.name]
              const src = (ms?.source || 'auto').toLowerCase()
              const discovered = ms?.discovered ?? []
              const selectedKey = ms?.prometheusNamespace && ms?.prometheusService
                ? promRefKey({
                    namespace: ms.prometheusNamespace,
                    name: ms.prometheusService,
                    port: ms.prometheusPort || 'web',
                  })
                : ''
              const promStatus = promStatusLine(ms)
              const advancedOpen = Boolean(promAdvancedOpen[p.name])

              return (
                <div key={p.name} className="settings-cmc-row settings-cmc-row-compact">
                  <div className="settings-cmc-compact-main">
                    <div className="settings-cmc-row-info">
                      <span className="settings-cmc-name">{profileLabel(p)}</span>
                      <span className="settings-cmc-status" title={promStatus}>{promStatus}</span>
                    </div>
                    {discovered.length > 0 && (
                      <select
                        className="settings-metrics-select settings-metrics-select-inline"
                        disabled={busy}
                        aria-label={`Prometheus Service for ${profileLabel(p)}`}
                        value={selectedKey && discovered.some(r => promRefKey(r) === selectedKey)
                          ? selectedKey
                          : ''}
                        onChange={e => {
                          const key = e.target.value
                          if (!key) {
                            void saveMetricsSource(p.name, {
                              prometheusNamespace: '',
                              prometheusService: '',
                              prometheusPort: '',
                            })
                            return
                          }
                          const ref = discovered.find(r => promRefKey(r) === key)
                          if (ref) pickDiscovered(p.name, ref)
                        }}
                      >
                        <option value="">Auto-pick</option>
                        {discovered.map(ref => (
                          <option key={promRefKey(ref)} value={promRefKey(ref)}>
                            {ref.namespace}/{shortPromService(ref.name)}:{ref.port}
                            {ref.healthy ? '' : ' (?)'}
                          </option>
                        ))}
                      </select>
                    )}
                    <button
                      type="button"
                      className="settings-metrics-advanced-toggle"
                      aria-expanded={advancedOpen}
                      onClick={() => setPromAdvancedOpen(prev => ({
                        ...prev,
                        [p.name]: !prev[p.name],
                      }))}
                    >
                      {advancedOpen ? 'Hide' : 'Advanced'}
                    </button>
                  </div>

                  {advancedOpen && (
                    <div className="settings-metrics-advanced">
                      <div className="settings-metrics-grid">
                        <label className="settings-metrics-field">
                          <span>Service namespace</span>
                          <input
                            value={ms?.prometheusNamespace ?? ''}
                            disabled={busy}
                            onChange={e => setMetricsSrcByProfile(prev => ({
                              ...prev,
                              [p.name]: { ...(prev[p.name] ?? { source: src }), prometheusNamespace: e.target.value },
                            }))}
                            onBlur={() => void saveMetricsSource(p.name, {})}
                          />
                        </label>
                        <label className="settings-metrics-field">
                          <span>Service name</span>
                          <input
                            value={ms?.prometheusService ?? ''}
                            disabled={busy}
                            onChange={e => setMetricsSrcByProfile(prev => ({
                              ...prev,
                              [p.name]: { ...(prev[p.name] ?? { source: src }), prometheusService: e.target.value },
                            }))}
                            onBlur={() => void saveMetricsSource(p.name, {})}
                          />
                        </label>
                        <label className="settings-metrics-field">
                          <span>Port</span>
                          <input
                            value={ms?.prometheusPort ?? ''}
                            disabled={busy}
                            placeholder="web or 9090"
                            onChange={e => setMetricsSrcByProfile(prev => ({
                              ...prev,
                              [p.name]: { ...(prev[p.name] ?? { source: src }), prometheusPort: e.target.value },
                            }))}
                            onBlur={() => void saveMetricsSource(p.name, {})}
                          />
                        </label>
                      </div>
                      <label className="settings-metrics-field">
                        <span>External URL (optional)</span>
                        <input
                          value={ms?.prometheusURL ?? ''}
                          disabled={busy}
                          placeholder="https://prometheus.example.com"
                          onChange={e => setMetricsSrcByProfile(prev => ({
                            ...prev,
                            [p.name]: { ...(prev[p.name] ?? { source: src }), prometheusURL: e.target.value },
                          }))}
                          onBlur={() => void saveMetricsSource(p.name, {})}
                        />
                      </label>
                      <div className="settings-metrics-bearer-row">
                        <label className="settings-metrics-field settings-metrics-field-grow">
                          <span>Bearer token</span>
                          <input
                            type="password"
                            disabled={busy}
                            placeholder={ms?.hasBearer ? '(saved — leave blank to keep)' : 'optional'}
                            onBlur={e => {
                              const v = e.target.value.trim()
                              if (v) void saveMetricsSource(p.name, { prometheusBearer: v })
                              e.target.value = ''
                            }}
                          />
                        </label>
                        {ms?.hasBearer && (
                          <button
                            type="button"
                            className="settings-action-btn"
                            disabled={busy}
                            onClick={() => void saveMetricsSource(p.name, { clearBearer: true })}
                          >
                            Clear
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          <p className="settings-metrics-hint">
            Used automatically when found and the collector is off. Open Advanced to set Service, URL, or bearer.
          </p>
        </div>
      )}
      {cmcError && <div className="settings-billing-error">{cmcError}</div>}
    </div>
  )
}
