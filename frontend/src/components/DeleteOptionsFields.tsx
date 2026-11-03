import type { DeleteResourceOpts } from '../api/client'

export type DeleteFormState = {
  force: boolean
  gracePeriod: string
  propagation: 'Foreground' | 'Background' | 'Orphan'
}

export const DEFAULT_DELETE_FORM: DeleteFormState = {
  force: false,
  gracePeriod: '',
  propagation: 'Foreground',
}

export function deleteFormToOpts(form: DeleteFormState): DeleteResourceOpts {
  const opts: DeleteResourceOpts = {
    force: form.force,
    propagation: form.propagation,
  }
  const raw = form.gracePeriod.trim()
  if (raw !== '') {
    const n = Number(raw)
    if (Number.isFinite(n) && n >= 0) opts.gracePeriod = Math.floor(n)
  }
  return opts
}

/** Shared kubectl-style delete flags for ConfirmDialog children. */
export function DeleteOptionsFields({
  value,
  onChange,
  showForce = true,
}: {
  value: DeleteFormState
  onChange: (next: DeleteFormState) => void
  /** Force (grace 0) — most useful for stuck pods; available for all kinds. */
  showForce?: boolean
}) {
  return (
    <div className="confirm-delete-opts">
      <label className="confirm-delete-field">
        <span>Cascade</span>
        <select
          value={value.propagation}
          onChange={e => onChange({
            ...value,
            propagation: e.target.value as DeleteFormState['propagation'],
          })}
        >
          <option value="Foreground">Foreground — wait for dependents</option>
          <option value="Background">Background — delete dependents async</option>
          <option value="Orphan">Orphan — leave dependents</option>
        </select>
      </label>
      <label className="confirm-delete-field">
        <span>Grace period (seconds)</span>
        <input
          type="number"
          min={0}
          placeholder="API default"
          value={value.gracePeriod}
          disabled={value.force}
          onChange={e => onChange({ ...value, gracePeriod: e.target.value })}
        />
      </label>
      {showForce && (
        <label className="confirm-force">
          <input
            type="checkbox"
            checked={value.force}
            onChange={e => onChange({ ...value, force: e.target.checked })}
          />
          Force (grace period 0)
        </label>
      )}
    </div>
  )
}
