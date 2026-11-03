import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeft, Cloud, FileText, Globe, Hexagon, X } from 'lucide-react'
import { GroupSelect } from '../components/GroupSelect'
import { SecretInput } from '../components/SecretInput'
import { api, type KubeContextEntry } from '../api/client'
import { parseAzureSpJson } from '../lib/azureSp'
import type { Profile } from '../types'

// ── Helpers ───────────────────────────────────────────────────────────────────

function suggestDisplayName(contextName: string, displayName?: string): string {
  if (displayName && displayName !== contextName) return displayName
  // EKS ARN: arn:aws:eks:region:account:cluster/cluster-name → take last segment after /
  const clusterIdx = contextName.indexOf(':cluster/')
  if (clusterIdx !== -1) return contextName.slice(clusterIdx + ':cluster/'.length)
  const slashIdx = contextName.lastIndexOf('/')
  if (slashIdx !== -1) return contextName.slice(slashIdx + 1)
  return contextName
}


// ── Add Cluster Modal ─────────────────────────────────────────────────────────

const AWS_REGIONS = [
  { value: 'us-east-1',      label: 'US East (N. Virginia) — us-east-1' },
  { value: 'us-east-2',      label: 'US East (Ohio) — us-east-2' },
  { value: 'us-west-1',      label: 'US West (N. California) — us-west-1' },
  { value: 'us-west-2',      label: 'US West (Oregon) — us-west-2' },
  { value: 'ca-central-1',   label: 'Canada (Central) — ca-central-1' },
  { value: 'ca-west-1',      label: 'Canada West (Calgary) — ca-west-1' },
  { value: 'eu-central-1',   label: 'Europe (Frankfurt) — eu-central-1' },
  { value: 'eu-central-2',   label: 'Europe (Zurich) — eu-central-2' },
  { value: 'eu-west-1',      label: 'Europe (Ireland) — eu-west-1' },
  { value: 'eu-west-2',      label: 'Europe (London) — eu-west-2' },
  { value: 'eu-west-3',      label: 'Europe (Paris) — eu-west-3' },
  { value: 'eu-north-1',     label: 'Europe (Stockholm) — eu-north-1' },
  { value: 'eu-south-1',     label: 'Europe (Milan) — eu-south-1' },
  { value: 'eu-south-2',     label: 'Europe (Spain) — eu-south-2' },
  { value: 'ap-east-1',      label: 'Asia Pacific (Hong Kong) — ap-east-1' },
  { value: 'ap-south-1',     label: 'Asia Pacific (Mumbai) — ap-south-1' },
  { value: 'ap-south-2',     label: 'Asia Pacific (Hyderabad) — ap-south-2' },
  { value: 'ap-northeast-1', label: 'Asia Pacific (Tokyo) — ap-northeast-1' },
  { value: 'ap-northeast-2', label: 'Asia Pacific (Seoul) — ap-northeast-2' },
  { value: 'ap-northeast-3', label: 'Asia Pacific (Osaka) — ap-northeast-3' },
  { value: 'ap-southeast-1', label: 'Asia Pacific (Singapore) — ap-southeast-1' },
  { value: 'ap-southeast-2', label: 'Asia Pacific (Sydney) — ap-southeast-2' },
  { value: 'ap-southeast-3', label: 'Asia Pacific (Jakarta) — ap-southeast-3' },
  { value: 'ap-southeast-4', label: 'Asia Pacific (Melbourne) — ap-southeast-4' },
  { value: 'me-south-1',     label: 'Middle East (Bahrain) — me-south-1' },
  { value: 'me-central-1',   label: 'Middle East (UAE) — me-central-1' },
  { value: 'af-south-1',     label: 'Africa (Cape Town) — af-south-1' },
  { value: 'sa-east-1',      label: 'South America (São Paulo) — sa-east-1' },
  { value: 'il-central-1',   label: 'Israel (Tel Aviv) — il-central-1' },
]

type Step = 'pick' | 'aws' | 'kubeconfig' | 'gcp' | 'azure'

interface ImportEntry {
  contextName: string
  clusterName: string
  displayName: string
  group: string
  selected: boolean
}

/** Contexts already pinned as kubeconfig profiles (clusterName stores the context name). */
function alreadyImportedContextNames(profiles: Profile[]): Set<string> {
  const set = new Set<string>()
  for (const p of profiles) {
    if (p.type === 'kubeconfig' && p.clusterName) set.add(p.clusterName)
  }
  return set
}

function toImportEntries(contexts: KubeContextEntry[], profiles: Profile[]): ImportEntry[] {
  const taken = alreadyImportedContextNames(profiles)
  return contexts
    .filter(c => !taken.has(c.contextName))
    .map(c => ({
      contextName: c.contextName,
      clusterName: c.clusterName,
      displayName: c.displayName || suggestDisplayName(c.contextName),
      group: '',
      selected: true,
    }))
}

export function AddClusterModal({
  profiles,
  groups,
  onCreateGroup,
  onDone,
  onClose,
}: {
  profiles: Profile[]
  groups: string[]
  onCreateGroup: (name: string) => Promise<string[]>
  onDone: () => void
  onClose: () => void
}) {
  const [step, setStep] = useState<Step>('pick')
  const [selectedGroup, setSelectedGroup] = useState('')
  const [accessKeyId, setAccessKeyId] = useState('')
  const [secretAccessKey, setSecretAccessKey] = useState('')
  const [region, setRegion] = useState('eu-central-1')
  const [roleArn, setRoleArn] = useState('')
  const [kubeconfigData, setKubeconfigData] = useState('')
  const [gcpSAJson, setGcpSAJson] = useState('')
  const [gcpProjectId, setGcpProjectId] = useState('')
  const [azureClientId, setAzureClientId] = useState('')
  const [azureClientSecret, setAzureClientSecret] = useState('')
  const [azureTenantId, setAzureTenantId] = useState('')
  const [azureSubscriptionId, setAzureSubscriptionId] = useState('')
  const [azurePasteOpen, setAzurePasteOpen] = useState(false)
  const [azurePasteText, setAzurePasteText] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // kubeconfig multi-context state
  const [kubeStep, setKubeStep] = useState<'upload' | 'form'>('upload')
  const [kubeContexts, setKubeContexts] = useState<KubeContextEntry[]>([])
  const [importEntries, setImportEntries] = useState<ImportEntry[]>([])
  const [previewLoading, setPreviewLoading] = useState(false)
  const [defaultKubeconfigPath, setDefaultKubeconfigPath] = useState<string | null>(null)
  const [defaultNotFound, setDefaultNotFound] = useState(false)
  const [uploadedKubeconfigPath, setUploadedKubeconfigPath] = useState<string | null>(null)
  type KubeconfigSource = 'default' | 'upload' | 'paste'
  const [kubeconfigSource, setKubeconfigSource] = useState<KubeconfigSource | null>(null)

  useEffect(() => {
    if (!gcpSAJson) { setGcpProjectId(''); return }
    try {
      const sa = JSON.parse(gcpSAJson)
      setGcpProjectId(sa.project_id ?? '')
    } catch {
      setGcpProjectId('')
    }
  }, [gcpSAJson])


  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    if (step !== 'kubeconfig' || kubeconfigData) return
    setPreviewLoading(true)
    setDefaultNotFound(false)
    api.getDefaultKubeconfig().then(result => {
      if (!result) {
        setDefaultNotFound(true)
        setKubeStep('upload')
        return
      }
      setDefaultKubeconfigPath(result.path)
      setKubeContexts(result.contexts)
      const entries = toImportEntries(result.contexts, profiles)
      setImportEntries(entries)
      setUploadedKubeconfigPath(null)
      // Only auto-open the import list when there is something new to add.
      // Missing file / empty / all already imported → stay on paste/upload.
      if (entries.length > 0) {
        setKubeStep('form')
        setKubeconfigSource('default')
      } else {
        setKubeStep('upload')
        setKubeconfigSource(null)
      }
    }).finally(() => setPreviewLoading(false))
  }, [step]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleKubeNext() {
    if (!kubeconfigData) return
    setError(''); setPreviewLoading(true)
    try {
      const contexts = await api.previewKubeconfig(kubeconfigData)
      setKubeContexts(contexts)
      const entries = toImportEntries(contexts, profiles)
      setImportEntries(entries)
      if (entries.length === 0) {
        setError(
          contexts.length === 0
            ? 'No contexts found in this kubeconfig.'
            : `All ${contexts.length} context${contexts.length === 1 ? '' : 's'} already imported.`,
        )
        return
      }
      setKubeStep('form')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Invalid kubeconfig')
    } finally {
      setPreviewLoading(false)
    }
  }

  function updateImportEntry(idx: number, patch: Partial<ImportEntry>) {
    setImportEntries(prev => prev.map((e, i) => i === idx ? { ...e, ...patch } : e))
  }

  function applyAzureSpRaw(raw: string): boolean {
    const sp = parseAzureSpJson(raw)
    if (!sp) return false
    if (sp.clientId) setAzureClientId(sp.clientId)
    if (sp.clientSecret) setAzureClientSecret(sp.clientSecret)
    if (sp.tenantId) setAzureTenantId(sp.tenantId)
    if (sp.subscriptionId) setAzureSubscriptionId(sp.subscriptionId)
    return true
  }

  async function pasteAzureSpJson() {
    setAzurePasteOpen(true)
    setError('')
    try {
      const text = await navigator.clipboard.readText()
      if (!text.trim()) return
      setAzurePasteText(text)
      if (!applyAzureSpRaw(text)) setError('Invalid Azure service principal JSON')
    } catch {
      /* iPad / permission — user can paste into the textarea */
    }
  }

  async function handleSave() {
    setError(''); setLoading(true)
    try {
      if (step === 'aws') {
        const { name: id } = await api.addProfile({ type: 'aws', accessKeyId, secretAccessKey, region, roleArn: roleArn || undefined })
        if (selectedGroup) await api.setProfileGroup(id, selectedGroup)
      } else if (step === 'gcp') {
        const { name: id } = await api.addProfile({ type: 'gcp', serviceAccountJson: gcpSAJson, projectId: gcpProjectId })
        if (selectedGroup) await api.setProfileGroup(id, selectedGroup)
      } else if (step === 'azure') {
        const spJson = JSON.stringify({ clientId: azureClientId, clientSecret: azureClientSecret, tenantId: azureTenantId, subscriptionId: azureSubscriptionId })
        const { name: id } = await api.addProfile({ type: 'azure', serviceAccountJson: spJson, subscriptionId: azureSubscriptionId })
        if (selectedGroup) await api.setProfileGroup(id, selectedGroup)
      } else {
        // kubeconfig — import all contexts; server assigns opaque ids
        for (const entry of importEntries.filter(e => e.selected)) {
          const livePath = uploadedKubeconfigPath ?? defaultKubeconfigPath ?? ''
          const { name: id } = await api.addProfile(
            kubeconfigSource === 'paste'
              ? {
                  type: 'kubeconfig',
                  kubeconfigData,
                  kubeconfigContext: entry.contextName,
                  kubeconfigEmbedded: true,
                }
              : {
                  type: 'kubeconfig',
                  kubeconfigPath: livePath,
                  kubeconfigContext: entry.contextName,
                  kubeconfigEmbedded: false,
                },
          )
          if (entry.group) await api.setProfileGroup(id, entry.group)
        }
      }
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error')
    } finally {
      setLoading(false)
    }
  }

  const canSave = step === 'aws'
    ? !!(accessKeyId && secretAccessKey)
    : step === 'gcp'
      ? !!(gcpSAJson && gcpProjectId)
      : step === 'azure'
        ? !!(azureClientId && azureClientSecret && azureTenantId && azureSubscriptionId)
        : importEntries.some(e => e.selected)

  return createPortal(
    <>
      <div className="acm-backdrop" />
      <div className="acm-modal" onMouseDown={e => e.stopPropagation()}>

        {/* Header */}
        <div className="acm-header">
          <div className="acm-header-left">
            {step !== 'pick' && (
              <button className="acm-back-btn" onClick={() => {
                if (step === 'kubeconfig' && kubeStep === 'form') {
                  setKubeStep('upload'); setError('')
                } else {
                  setStep('pick'); setKubeStep('upload'); setError('')
                }
              }}>
                <ArrowLeft size={14} />
              </button>
            )}
            <span className="acm-title">
              {step === 'pick' ? 'Add Cluster'
                : step === 'aws' ? 'Amazon EKS'
                : step === 'gcp' ? 'Google GKE'
                : step === 'azure' ? 'Azure AKS'
                : kubeStep === 'form'
                  ? `${importEntries.length} new cluster${importEntries.length === 1 ? '' : 's'}`
                  : 'kubeconfig'}
            </span>
          </div>
          <button className="acm-close-btn" onClick={onClose}><X size={15} /></button>
        </div>

        {/* Step 1: Provider picker */}
        {step === 'pick' && (
          <div className="acm-picker">
            <p className="acm-picker-hint">Choose how to connect</p>
            <div className="acm-provider-grid">
              <button className="acm-provider-card" onClick={() => setStep('aws')}>
                <div className="acm-provider-icon acm-provider-aws">
                  <Cloud size={28} />
                </div>
                <span className="acm-provider-name">Amazon EKS</span>
                <span className="acm-provider-desc">AWS access keys</span>
              </button>
              <button className="acm-provider-card" onClick={() => setStep('gcp')}>
                <div className="acm-provider-icon acm-provider-gcp">
                  <Globe size={28} />
                </div>
                <span className="acm-provider-name">Google GKE</span>
                <span className="acm-provider-desc">Service account key</span>
              </button>
              <button className="acm-provider-card" onClick={() => setStep('azure')}>
                <div className="acm-provider-icon acm-provider-azure">
                  <Hexagon size={28} />
                </div>
                <span className="acm-provider-name">Azure AKS</span>
                <span className="acm-provider-desc">Service principal</span>
              </button>
              <button className="acm-provider-card" onClick={() => setStep('kubeconfig')}>
                <div className="acm-provider-icon acm-provider-kube">
                  <FileText size={28} />
                </div>
                <span className="acm-provider-name">kubeconfig</span>
                <span className="acm-provider-desc">Upload or paste YAML</span>
              </button>
            </div>
          </div>
        )}

        {/* Step 2: AWS form */}
        {step === 'aws' && (
          <div className="acm-form">
            {error && <div className="acm-error">{error}</div>}
            <div className="acm-fields">
              <GroupSelect value={selectedGroup} onChange={setSelectedGroup} groups={groups} onCreateGroup={onCreateGroup} />
              <div className="acm-divider" />
              <input className="acm-input" placeholder="Access Key ID" value={accessKeyId} onChange={e => setAccessKeyId(e.target.value)} autoComplete="off" autoFocus />
              <SecretInput placeholder="Secret Access Key" value={secretAccessKey} onChange={e => setSecretAccessKey(e.target.value)} autoComplete="off" />
              <select className="acm-select" value={region} onChange={e => setRegion(e.target.value)}>
                {AWS_REGIONS.map(r => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
              <input className="acm-input" placeholder="Role ARN (optional)" value={roleArn} onChange={e => setRoleArn(e.target.value)} autoComplete="off" />
            </div>
            <div className="acm-footer">
              <button className="acm-btn-cancel" onClick={onClose}>Cancel</button>
              <button className="acm-btn-save" onClick={handleSave} disabled={loading || !canSave}>
                {loading ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        )}

        {/* Step 2a: kubeconfig upload */}
        {step === 'kubeconfig' && kubeStep === 'upload' && (
          <div className="acm-form">
            {error && <div className="acm-error">{error}</div>}
            <div className="acm-fields">
              {previewLoading && !kubeconfigData
                ? <div className="acm-kube-checking">Checking ~/.kube/config…</div>
                : !kubeconfigData && defaultNotFound
                  ? <div className="acm-kube-hint">~/.kube/config not found — paste or upload a kubeconfig below.</div>
                  : !kubeconfigData && defaultKubeconfigPath && kubeContexts.length > 0 && importEntries.length === 0
                    ? (
                      <div className="acm-kube-hint">
                        All {kubeContexts.length} context{kubeContexts.length === 1 ? '' : 's'} in ~/.kube/config
                        are already imported. Paste or upload a different kubeconfig below.
                      </div>
                    )
                    : !kubeconfigData && defaultKubeconfigPath && kubeContexts.length === 0
                      ? <div className="acm-kube-hint">~/.kube/config has no contexts — paste or upload a kubeconfig below.</div>
                      : null}
              <div className="acm-upload-row">
                <label className="acm-upload-btn">
                  Upload file
                  <input type="file" style={{ display: 'none' }}
                    onChange={e => {
                      const file = e.target.files?.[0]; if (!file) return
                      const filePath = window.kubespade?.getPathForFile?.(file) ?? null
                      if (filePath) {
                        setUploadedKubeconfigPath(filePath)
                        setKubeconfigSource('upload')
                        setDefaultKubeconfigPath(null)
                      } else {
                        setUploadedKubeconfigPath(null)
                        setKubeconfigSource('paste')
                      }
                      const reader = new FileReader()
                      reader.onload = ev => { setKubeconfigData(ev.target?.result as string); setError('') }
                      reader.readAsText(file)
                    }} />
                </label>
                {kubeconfigData && <span className="acm-loaded">✓ Loaded</span>}
              </div>
              <textarea
                className="acm-textarea"
                placeholder="…or paste kubeconfig YAML here"
                rows={8}
                value={kubeconfigData}
                onChange={e => {
                  setKubeconfigData(e.target.value)
                  setKubeconfigSource('paste')
                  setUploadedKubeconfigPath(null)
                  setDefaultKubeconfigPath(null)
                  setError('')
                }}
              />
            </div>
            <div className="acm-footer">
              <button className="acm-btn-cancel" onClick={onClose}>Cancel</button>
              <button className="acm-btn-save" onClick={handleKubeNext} disabled={previewLoading || !kubeconfigData}>
                {previewLoading ? 'Parsing…' : 'Next →'}
              </button>
            </div>
          </div>
        )}

        {/* Step 2b: kubeconfig context form */}
        {step === 'kubeconfig' && kubeStep === 'form' && (
          <div className="acm-form">
            {error && <div className="acm-error">{error}</div>}
            {kubeconfigSource === 'default' && defaultKubeconfigPath && (
              <div className="acm-kube-path">{defaultKubeconfigPath}</div>
            )}
            {kubeconfigSource === 'upload' && uploadedKubeconfigPath && (
              <div className="acm-kube-path" title="Live-linked — re-read on every connect">↗ {uploadedKubeconfigPath}</div>
            )}
            <div className="acm-fields acm-kube-entries">
              <div className="acm-kube-hint">
                {kubeconfigSource === 'paste'
                  ? 'Uncheck any clusters you do not want to import.'
                  : 'Unchecked clusters stay out of the app until you add them later. New contexts that appear in the file are picked up automatically.'}
                {' '}
                Press ← to paste or upload a different kubeconfig.
              </div>
              {importEntries.map((entry, idx) => (
                <div key={entry.contextName} className={`acm-kube-entry${entry.selected ? '' : ' acm-kube-entry-off'}`}>
                  <label className="acm-kube-entry-header">
                    <input
                      type="checkbox"
                      checked={entry.selected}
                      onChange={e => updateImportEntry(idx, { selected: e.target.checked })}
                    />
                    <span className="acm-kube-entry-copy">
                      <span className="acm-kube-context">{entry.displayName}</span>
                      {entry.displayName !== entry.contextName && (
                        <span className="acm-kube-cluster" title={entry.contextName}>{entry.contextName}</span>
                      )}
                    </span>
                  </label>
                  {entry.selected && (
                    <GroupSelect
                      value={entry.group}
                      onChange={g => updateImportEntry(idx, { group: g })}
                      groups={groups}
                      onCreateGroup={onCreateGroup}
                    />
                  )}
                </div>
              ))}
            </div>
            <div className="acm-footer">
              <button className="acm-btn-cancel" onClick={onClose}>Cancel</button>
              {importEntries.some(e => e.selected) && (
                <button className="acm-btn-save" onClick={handleSave} disabled={loading || !canSave}>
                  {loading
                    ? 'Importing…'
                    : importEntries.filter(e => e.selected).length === 1
                      ? 'Save'
                      : `Import ${importEntries.filter(e => e.selected).length} clusters`}
                </button>
              )}
            </div>
          </div>
        )}

        {/* Step 2: Azure form */}
        {step === 'azure' && (
          <div className="acm-form">
            {error && <div className="acm-error">{error}</div>}
            <div className="acm-fields">
              <GroupSelect value={selectedGroup} onChange={setSelectedGroup} groups={groups} onCreateGroup={onCreateGroup} />
              <div className="acm-divider" />
              <div className="acm-upload-row">
                <label className="acm-upload-btn">
                  Upload SP JSON
                  <input type="file" accept=".json" style={{ display: 'none' }}
                    onChange={e => {
                      const file = e.target.files?.[0]; if (!file) return
                      const reader = new FileReader()
                      reader.onload = ev => {
                        const raw = String(ev.target?.result ?? '')
                        if (!applyAzureSpRaw(raw)) setError('Invalid Azure service principal JSON')
                        else setError('')
                      }
                      reader.readAsText(file)
                    }} />
                </label>
                <button type="button" className="acm-upload-btn" onClick={() => { void pasteAzureSpJson() }}>
                  Paste JSON
                </button>
              </div>
              {azurePasteOpen && (
                <textarea
                  className="acm-textarea"
                  placeholder="Paste Azure service principal JSON here"
                  rows={6}
                  value={azurePasteText}
                  autoFocus
                  onChange={e => {
                    const raw = e.target.value
                    setAzurePasteText(raw)
                    if (!raw.trim()) return
                    applyAzureSpRaw(raw)
                  }}
                />
              )}
              <input className="acm-input" placeholder="Client ID" value={azureClientId} onChange={e => setAzureClientId(e.target.value)} autoComplete="off" autoFocus />
              <SecretInput placeholder="Client Secret" value={azureClientSecret} onChange={e => setAzureClientSecret(e.target.value)} autoComplete="off" />
              <input className="acm-input" placeholder="Tenant ID" value={azureTenantId} onChange={e => setAzureTenantId(e.target.value)} autoComplete="off" />
              <input className="acm-input" placeholder="Subscription ID" value={azureSubscriptionId} onChange={e => setAzureSubscriptionId(e.target.value)} autoComplete="off" />
            </div>
            <div className="acm-footer">
              <button className="acm-btn-cancel" onClick={onClose}>Cancel</button>
              <button className="acm-btn-save" onClick={handleSave} disabled={loading || !canSave}>
                {loading ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        )}

        {/* Step 2: GCP form */}
        {step === 'gcp' && (
          <div className="acm-form">
            {error && <div className="acm-error">{error}</div>}
            <div className="acm-fields">
              <GroupSelect value={selectedGroup} onChange={setSelectedGroup} groups={groups} onCreateGroup={onCreateGroup} />
              <div className="acm-divider" />
              <div className="acm-upload-row">
                <label className="acm-upload-btn">
                  Upload key file
                  <input type="file" accept=".json" style={{ display: 'none' }}
                    onChange={e => {
                      const file = e.target.files?.[0]; if (!file) return
                      const reader = new FileReader()
                      reader.onload = ev => setGcpSAJson(ev.target?.result as string)
                      reader.readAsText(file)
                    }} />
                </label>
                {gcpProjectId && <span className="acm-loaded">✓ {gcpProjectId}</span>}
              </div>
              <textarea
                className="acm-textarea"
                placeholder="…or paste Service Account JSON key here"
                rows={6}
                value={gcpSAJson}
                onChange={e => setGcpSAJson(e.target.value)}
                autoFocus
              />
            </div>
            <div className="acm-footer">
              <button className="acm-btn-cancel" onClick={onClose}>Cancel</button>
              <button className="acm-btn-save" onClick={handleSave} disabled={loading || !canSave}>
                {loading ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        )}

      </div>
    </>,
    document.body
  )
}
