import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api/client'
import type { HelmRelease } from '../types'
import { Combobox, type ComboboxOption } from './Combobox'
import { HelmValuesDiffPanel } from './HelmValuesDiffPanel'
import { Modal } from './Modal'

interface Props {
  profile: string
  mode: 'install' | 'upgrade'
  /** Required for upgrade; optional seed for install. */
  release?: HelmRelease | null
  onClose: () => void
  onDone: () => void
}

function chartNeedsRepo(chartRef: string): boolean {
  const ref = chartRef.trim()
  if (!ref) return false
  if (ref.startsWith('oci://')) return false
  if (ref.startsWith('/') || ref.startsWith('.') || ref.startsWith('file:')) return false
  if (/\.(tgz|tar\.gz)$/i.test(ref)) return false
  return true
}

function isHttpRepoURL(url: string): boolean {
  return /^https?:\/\//i.test(url.trim())
}

function repoStorageKey(chartRef: string): string {
  return `kubespade.helm.repo.${chartRef.trim().toLowerCase()}`
}

function rememberRepo(chartRef: string, repo: string) {
  const ch = chartRef.trim()
  const r = repo.trim()
  if (!ch || !r || typeof sessionStorage === 'undefined') return
  try { sessionStorage.setItem(repoStorageKey(ch), r) } catch { /* ignore */ }
}

function recallRepo(chartRef: string): string {
  const ch = chartRef.trim()
  if (!ch || typeof sessionStorage === 'undefined') return ''
  try { return sessionStorage.getItem(repoStorageKey(ch)) || '' } catch { return '' }
}

export function HelmWriteDialog({ profile, mode, release, onClose, onDone }: Props) {
  const upgrading = mode === 'upgrade'
  const [name, setName] = useState(release?.name ?? '')
  const [namespace, setNamespace] = useState(release?.namespace ?? 'default')
  const [chart, setChart] = useState(release?.chart ?? '')
  const [repo, setRepo] = useState(() => recallRepo(release?.chart ?? ''))
  const [version, setVersion] = useState(release?.chartVersion ?? '')
  const [valuesYaml, setValuesYaml] = useState('')
  const [reuseValues, setReuseValues] = useState(true)
  const [loadingValues, setLoadingValues] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [showFieldErrors, setShowFieldErrors] = useState(false)

  const [localRepos, setLocalRepos] = useState<{ name: string; url: string }[]>([])
  const [namespaces, setNamespaces] = useState<string[]>([])
  const [chartSummaries, setChartSummaries] = useState<{ name: string; description?: string; latestVersion?: string }[]>([])
  const [versions, setVersions] = useState<string[]>([])
  const [chartsLoading, setChartsLoading] = useState(false)
  const [versionsLoading, setVersionsLoading] = useState(false)
  const [indexHint, setIndexHint] = useState('')
  const chartsReq = useRef(0)
  const versionsReq = useRef(0)
  const diffReq = useRef(0)

  const [diffFromYaml, setDiffFromYaml] = useState('')
  const [diffToYaml, setDiffToYaml] = useState('')
  const [diffLoading, setDiffLoading] = useState(false)
  const [diffError, setDiffError] = useState('')

  useEffect(() => {
    let cancelled = false
    api.listHelmRepos(profile)
      .then(d => { if (!cancelled) setLocalRepos(d.repos || []) })
      .catch(() => { if (!cancelled) setLocalRepos([]) })
    return () => { cancelled = true }
  }, [profile])

  useEffect(() => {
    if (upgrading) return
    let cancelled = false
    api.getClusterInfo(profile)
      .then(d => {
        if (cancelled) return
        const list = (d.namespaces || []).filter((ns): ns is string => typeof ns === 'string' && ns.length > 0)
        list.sort((a, b) => a.localeCompare(b))
        setNamespaces(list)
      })
      .catch(() => { if (!cancelled) setNamespaces([]) })
    return () => { cancelled = true }
  }, [profile, upgrading])

  useEffect(() => {
    if (!upgrading || !release) return
    let cancelled = false
    setLoadingValues(true)
    api.getHelmReleaseValues(profile, release.namespace, release.name)
      .then(d => { if (!cancelled) setValuesYaml(d.valuesYaml || '') })
      .catch(() => { /* empty values is fine */ })
      .finally(() => { if (!cancelled) setLoadingValues(false) })
    return () => { cancelled = true }
  }, [upgrading, profile, release])

  useEffect(() => {
    const remembered = recallRepo(chart)
    if (remembered && !repo.trim()) setRepo(remembered)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only seed repo from chart name changes
  }, [chart])

  function loadChartsForRepo(url: string) {
    const u = url.trim()
    if (!isHttpRepoURL(u) || chart.trim().startsWith('oci://')) {
      setChartSummaries([])
      setVersions([])
      setIndexHint('')
      return
    }
    const id = ++chartsReq.current
    setChartsLoading(true)
    setIndexHint('Loading charts…')
    api.listHelmRepoCharts(profile, { url: u })
      .then(d => {
        if (id !== chartsReq.current) return
        setChartSummaries(d.charts || [])
        setIndexHint(d.charts?.length ? `${d.charts.length} charts` : 'No charts in index')
      })
      .catch(e => {
        if (id !== chartsReq.current) return
        setChartSummaries([])
        setIndexHint(e instanceof Error ? e.message : 'Failed to load charts')
      })
      .finally(() => {
        if (id === chartsReq.current) setChartsLoading(false)
      })
  }

  function loadVersionsForChart(url: string, chartName: string) {
    const u = url.trim()
    const ch = chartName.trim()
    if (!isHttpRepoURL(u) || !ch || ch.startsWith('oci://')) {
      setVersions([])
      return
    }
    const id = ++versionsReq.current
    setVersionsLoading(true)
    api.listHelmRepoChartVersions(profile, { url: u, chart: ch })
      .then(d => {
        if (id !== versionsReq.current) return
        setVersions(d.versions || [])
      })
      .catch(() => {
        if (id !== versionsReq.current) return
        setVersions([])
      })
      .finally(() => {
        if (id === versionsReq.current) setVersionsLoading(false)
      })
  }

  // Initial / when repo becomes a valid URL (debounced lightly via effect).
  useEffect(() => {
    if (!isHttpRepoURL(repo)) {
      setChartSummaries([])
      setVersions([])
      setIndexHint('')
      return
    }
    const t = window.setTimeout(() => loadChartsForRepo(repo), 280)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, repo])

  useEffect(() => {
    if (!isHttpRepoURL(repo) || !chart.trim() || chart.trim().startsWith('oci://')) {
      setVersions([])
      return
    }
    const t = window.setTimeout(() => loadVersionsForChart(repo, chart), 280)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, repo, chart])

  const fromVersion = upgrading ? (release?.chartVersion || '').trim() : ''
  const toVersion = version.trim()
  const showValuesDiff = Boolean(
    upgrading
    && fromVersion
    && toVersion
    && fromVersion !== toVersion
    && isHttpRepoURL(repo)
    && (chart.trim() || release?.chart)
    && !chart.trim().startsWith('oci://'),
  )

  useEffect(() => {
    if (!showValuesDiff) {
      setDiffFromYaml('')
      setDiffToYaml('')
      setDiffError('')
      setDiffLoading(false)
      return
    }
    const chartName = (chart.trim() || release?.chart || '').trim()
    const id = ++diffReq.current
    setDiffLoading(true)
    setDiffError('')
    const t = window.setTimeout(() => {
      Promise.all([
        api.getHelmChartValues(profile, { chart: chartName, url: repo.trim(), version: fromVersion }),
        api.getHelmChartValues(profile, { chart: chartName, url: repo.trim(), version: toVersion }),
      ])
        .then(([from, to]) => {
          if (id !== diffReq.current) return
          setDiffFromYaml(from.valuesYaml || '')
          setDiffToYaml(to.valuesYaml || '')
        })
        .catch(e => {
          if (id !== diffReq.current) return
          setDiffFromYaml('')
          setDiffToYaml('')
          setDiffError(e instanceof Error ? e.message : 'Failed to load chart values')
        })
        .finally(() => {
          if (id === diffReq.current) setDiffLoading(false)
        })
    }, 320)
    return () => {
      window.clearTimeout(t)
      diffReq.current++
    }
  }, [showValuesDiff, profile, repo, chart, release?.chart, fromVersion, toVersion])

  const repoOptions: ComboboxOption[] = useMemo(
    () => localRepos.map(r => ({
      value: r.url,
      label: r.name,
      detail: r.url,
    })),
    [localRepos],
  )

  const namespaceOptions: ComboboxOption[] = useMemo(
    () => namespaces.map(ns => ({ value: ns, label: ns })),
    [namespaces],
  )

  const chartOptions: ComboboxOption[] = useMemo(
    () => chartSummaries.map(c => ({
      value: c.name,
      label: c.name,
      detail: c.latestVersion
        ? `${c.latestVersion}${c.description ? ` · ${c.description}` : ''}`
        : c.description,
    })),
    [chartSummaries],
  )

  const versionOptions: ComboboxOption[] = useMemo(
    () => versions.map(v => ({ value: v, label: v })),
    [versions],
  )

  function validateChartLoc(): string | null {
    const ch = chart.trim() || (upgrading ? (release?.chart ?? '') : '')
    if (!upgrading && !chart.trim()) return 'chart'
    if (ch && chartNeedsRepo(ch) && !repo.trim()) return 'repo'
    return null
  }

  async function submit() {
    if (busy) return
    setBusy(true)
    setError('')
    setShowFieldErrors(true)

    if (!upgrading) {
      const missingName = !name.trim()
      const missingNs = !namespace.trim()
      const missingChart = !chart.trim()
      const missingRepo = chartNeedsRepo(chart.trim()) && !repo.trim()
      if (missingName || missingNs || missingChart || missingRepo) {
        setBusy(false)
        return
      }
    } else {
      const locErr = validateChartLoc()
      if (locErr) {
        setBusy(false)
        return
      }
    }

    try {
      if (upgrading && release) {
        const ch = chart.trim() || release.chart
        await api.upgradeHelmRelease(profile, release.namespace, release.name, {
          chart: chart.trim() || undefined,
          repo: repo.trim() || undefined,
          version: version.trim() || undefined,
          valuesYaml,
          reuseValues: reuseValues && !valuesYaml.trim(),
        })
        rememberRepo(ch, repo)
      } else {
        const n = name.trim()
        const ns = namespace.trim()
        const ch = chart.trim()
        await api.installHelmRelease(profile, {
          name: n,
          namespace: ns,
          chart: ch,
          repo: repo.trim() || undefined,
          version: version.trim() || undefined,
          valuesYaml,
        })
        rememberRepo(ch, repo)
      }
      onDone()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : `${mode} failed`)
      setBusy(false)
    }
  }

  const needsRepo = chartNeedsRepo(chart.trim() || (upgrading ? (release?.chart ?? '') : ''))
  const valuesEmpty = !valuesYaml.trim()
  const ociChart = chart.trim().startsWith('oci://')
  const invalidName = showFieldErrors && !upgrading && !name.trim()
  const invalidNs = showFieldErrors && !upgrading && !namespace.trim()
  const invalidChart = showFieldErrors && !upgrading && !chart.trim()
  const invalidRepo = showFieldErrors && needsRepo && !repo.trim() && !ociChart

  return (
    <Modal
      onClose={() => { if (!busy) onClose() }}
      backdropClassName="confirm-backdrop overlay-backdrop"
      className="confirm-dialog overlay-pop confirm-dialog-wide helm-write-dialog"
      dismissTrigger="click"
      closeOnEscape={!busy}
      style={{ width: 560 }}
    >
      <div className="confirm-title">
        {upgrading ? `Upgrade ${release?.namespace}/${release?.name}` : 'Install Helm chart'}
      </div>
      <div className="helm-write-body">
      <div className="helm-write-form">
        {!upgrading && (
          <>
            <label className={`helm-write-field${invalidName ? ' helm-write-field-invalid' : ''}`}>
              <span>Release name</span>
              <input
                className={`helm-write-input${invalidName ? ' helm-write-input-invalid' : ''}`}
                value={name}
                onChange={e => setName(e.target.value)}
                disabled={busy}
                autoFocus
                aria-invalid={invalidName || undefined}
              />
            </label>
            <div className={`helm-write-field${invalidNs ? ' helm-write-field-invalid' : ''}`}>
              <span>Namespace</span>
              <Combobox
                value={namespace}
                onChange={setNamespace}
                options={namespaceOptions}
                disabled={busy}
                placeholder="default"
                emptyMessage={namespaces.length ? 'No matches — type a namespace' : 'Type a namespace'}
                invalid={invalidNs}
              />
            </div>
          </>
        )}

        <div className={`helm-write-field${invalidRepo ? ' helm-write-field-invalid' : ''}`}>
          <span>
            Repo{' '}
            <em>
              {ociChart
                ? '(optional for oci://)'
                : needsRepo
                  ? '(required — pick local or type URL)'
                  : '(optional)'}
            </em>
          </span>
          <Combobox
            value={repo}
            onChange={setRepo}
            options={repoOptions}
            disabled={busy}
            placeholder="Select local repo or paste https://…"
            emptyMessage={localRepos.length ? 'No matching repos — keep typing a URL' : 'No local Helm repos — paste a URL'}
            onPick={opt => loadChartsForRepo(opt.value)}
            onCommit={v => { if (isHttpRepoURL(v)) loadChartsForRepo(v) }}
            autoFocus={upgrading}
            invalid={invalidRepo}
          />
          {indexHint && !ociChart && (
            <span className={`helm-write-hint${chartsLoading ? '' : indexHint.startsWith('Failed') || indexHint.startsWith('download') ? ' helm-write-hint-err' : ''}`}>
              {indexHint}
            </span>
          )}
        </div>

        <div className={`helm-write-field${invalidChart ? ' helm-write-field-invalid' : ''}`}>
          <span>Chart</span>
          <Combobox
            value={chart}
            onChange={v => {
              setChart(v)
              setVersion('')
            }}
            options={ociChart ? [] : chartOptions}
            disabled={busy}
            placeholder={upgrading ? 'Leave empty to keep current chart name' : 'podinfo  or  oci://…'}
            emptyMessage={chartsLoading ? 'Loading charts…' : 'No matches — type a chart name'}
            onPick={opt => {
              setChart(opt.value)
              const latest = chartSummaries.find(c => c.name === opt.value)?.latestVersion
              if (latest) setVersion(latest)
              if (isHttpRepoURL(repo)) loadVersionsForChart(repo, opt.value)
            }}
            invalid={invalidChart}
          />
        </div>

        <div className="helm-write-field">
          <span>Version <em>(optional — omit for latest)</em></span>
          <Combobox
            value={version}
            onChange={setVersion}
            options={versionOptions}
            disabled={busy}
            placeholder={versionsLoading ? 'Loading versions…' : 'e.g. 6.15.0'}
            emptyMessage={versionsLoading ? 'Loading…' : 'No versions — type freely'}
            maxVisible={300}
          />
        </div>

        {showValuesDiff && (
          <HelmValuesDiffPanel
            fromVersion={fromVersion}
            toVersion={toVersion}
            fromYaml={diffFromYaml}
            toYaml={diffToYaml}
            loading={diffLoading}
            error={diffError || undefined}
          />
        )}

        <label className="helm-write-field">
          <span>Values YAML {loadingValues ? '(loading…)' : ''}</span>
          <textarea
            className="helm-write-textarea"
            value={valuesYaml}
            onChange={e => setValuesYaml(e.target.value)}
            disabled={busy || loadingValues}
            rows={8}
            spellCheck={false}
            placeholder="# leave empty to keep / use chart defaults"
          />
        </label>
        {upgrading && (
          <label className={`helm-write-check${reuseValues && valuesEmpty ? ' helm-write-check-on' : ''}`}>
            <input
              type="checkbox"
              checked={reuseValues}
              disabled={busy || !valuesEmpty}
              onChange={e => setReuseValues(e.target.checked)}
            />
            <span>
              {valuesEmpty
                ? 'Keep my value overrides (new chart defaults for the rest, e.g. image tag)'
                : 'Keep overrides (clear YAML above to enable)'}
            </span>
          </label>
        )}
      </div>
      {error && <div className="confirm-error">{error}</div>}
      </div>
      <div className="confirm-actions">
        <button type="button" className="confirm-btn confirm-btn-cancel" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="confirm-btn confirm-btn-primary" onClick={() => { void submit() }} disabled={busy || loadingValues}>
          {busy ? (upgrading ? 'Upgrading…' : 'Installing…') : (upgrading ? 'Upgrade' : 'Install')}
        </button>
      </div>
    </Modal>
  )
}
