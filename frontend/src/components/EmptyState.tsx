import type { ReactNode } from 'react'

interface Props {
  title: string
  hint?: ReactNode
  action?: { label: string; onClick: () => void; testId?: string }
  /** Use inside a table cell (`td.res-empty`). */
  compact?: boolean
}

/** Empty list / table placeholder: title + optional hint + optional action. No italics. */
export function EmptyState({ title, hint, action, compact }: Props) {
  return (
    <div className={`empty-state${compact ? ' empty-state-compact' : ''}`}>
      <p className="empty-state-title">{title}</p>
      {hint != null && hint !== '' && <p className="empty-state-hint">{hint}</p>}
      {action && (
        <button
          type="button"
          className="empty-state-action"
          onClick={action.onClick}
          data-testid={action.testId}
        >
          {action.label}
        </button>
      )}
    </div>
  )
}
