import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Save, RotateCcw } from 'lucide-react'
import { api } from '../api/client'
import { YamlEditor } from './YamlEditor'

export type ResourceRef =
  | { type: 'k8s'; kind: string; name: string; namespace?: string }
  | { type: 'crd'; group: string; version: string; plural: string; name: string; namespace?: string }

function resourceRefKey(ref: ResourceRef): string {
  if (ref.type === 'k8s') {
    return `k8s:${ref.kind}:${ref.namespace ?? ''}:${ref.name}`
  }
  return `crd:${ref.group}:${ref.version}:${ref.plural}:${ref.namespace ?? ''}:${ref.name}`
}

interface Props {
  profile: string
  title: string
  /** Required for edit/create of a single resource; unused for mode=apply. */
  resourceRef?: ResourceRef
  onClose: () => void
  mode?: 'edit' | 'create' | 'apply'
  initialYaml?: string
  defaultNamespace?: string
  onCreated?: () => void
  /** Stack above NodeActionLog (drain). */
  aboveActionLog?: boolean
}

export function YamlPanel({
  profile, title, resourceRef, onClose,
  mode = 'edit', initialYaml = '', defaultNamespace, onCreated,
  aboveActionLog = false,
}: Props) {
  const isCreate = mode === 'create'
  const isApply = mode === 'apply'
  const isCompose = isCreate || isApply
  const refKey = resourceRef ? resourceRefKey(resourceRef) : 'apply'
  const [original, setOriginal] = useState(isCompose ? initialYaml : '')
  const [yaml, setYaml] = useState(isCompose ? initialYaml : '')
  const [loading, setLoading] = useState(!isCompose)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saveSuccess, setSaveSuccess] = useState(false)

  useEffect(() => {
    if (isCompose) {
      setOriginal(initialYaml)
      setYaml(initialYaml)
      setLoading(false)
      setError('')
      return
    }

    if (!resourceRef) {
      setError('Missing resource reference')
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)
    setError('')

    async function fetchYaml() {
      try {
        let text: string
        if (resourceRef!.type === 'k8s') {
          text = await api.getResourceYaml(profile, resourceRef!.kind, resourceRef!.name, resourceRef!.namespace)
        } else {
          text = await api.getCRDResourceYaml(profile, resourceRef!.group, resourceRef!.version, resourceRef!.plural, resourceRef!.name, resourceRef!.namespace)
        }
        if (!cancelled) {
          setOriginal(text)
          setYaml(text)
          setLoading(false)
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load YAML')
          setLoading(false)
        }
      }
    }

    fetchYaml()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- refKey replaces resourceRef object identity
  }, [profile, refKey, isCompose, initialYaml])

  async function handleSave() {
    setSaving(true)
    setError('')
    setSaveSuccess(false)
    try {
      if (isApply) {
        await api.applyManifestYaml(profile, yaml)
        setSaveSuccess(true)
        setTimeout(() => {
          onCreated?.()
          onClose()
        }, 600)
      } else if (isCreate) {
        if (!resourceRef || resourceRef.type !== 'k8s') throw new Error('Create is only supported for standard resources')
        await api.createResourceYaml(profile, resourceRef.kind, yaml, defaultNamespace)
        setSaveSuccess(true)
        setTimeout(() => {
          onCreated?.()
          onClose()
        }, 600)
      } else if (!resourceRef) {
        throw new Error('Missing resource reference')
      } else if (resourceRef.type === 'k8s') {
        await api.applyResourceYaml(profile, resourceRef.kind, resourceRef.name, yaml, resourceRef.namespace)
        setOriginal(yaml)
        setSaveSuccess(true)
        setTimeout(() => setSaveSuccess(false), 2000)
      } else {
        await api.applyCRDResourceYaml(profile, resourceRef.group, resourceRef.version, resourceRef.plural, resourceRef.name, yaml, resourceRef.namespace)
        setOriginal(yaml)
        setSaveSuccess(true)
        setTimeout(() => setSaveSuccess(false), 2000)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  function handleReset() {
    setYaml(original)
    setError('')
  }

  const isDirty = isCompose ? yaml.trim().length > 0 : yaml !== original && !loading
  const saveLabel = isApply
    ? (saving ? 'Applying…' : saveSuccess ? 'Applied!' : 'Apply')
    : isCreate
      ? (saving ? 'Creating…' : saveSuccess ? 'Created!' : 'Create')
      : (saving ? 'Saving…' : saveSuccess ? 'Saved!' : 'Save')

  return createPortal(
    <>
      <div className={`yaml-panel-backdrop overlay-backdrop${aboveActionLog ? ' stack-above-nal' : ''}`} onMouseDown={onClose} />
      <div className={`yaml-panel overlay-sheet${aboveActionLog ? ' stack-above-nal' : ''}`} onMouseDown={e => e.stopPropagation()}>
        <div className="yaml-panel-header">
          <span className="yaml-panel-title">{title}</span>
          <div className="yaml-panel-header-actions">
            {!isCompose && isDirty && (
              <button className="yaml-panel-btn yaml-panel-btn-ghost" onClick={handleReset} title="Reset changes">
                <RotateCcw size={13} />
              </button>
            )}
            <button
              className={`yaml-panel-btn ${saveSuccess ? 'yaml-panel-btn-success' : 'yaml-panel-btn-primary'}`}
              onClick={handleSave}
              disabled={!isDirty || saving}
            >
              <Save size={13} />
              {saveLabel}
            </button>
            <button className="yaml-panel-btn yaml-panel-btn-ghost" onClick={onClose} title="Close">
              <X size={14} />
            </button>
          </div>
        </div>

        {error && <div className="yaml-panel-error">{error}</div>}

        <div className="yaml-panel-body">
          {loading ? (
            <div className="yaml-panel-loading">Loading…</div>
          ) : (
            <YamlEditor value={yaml} onChange={setYaml} />
          )}
        </div>
      </div>
    </>,
    document.body
  )
}
