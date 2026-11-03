import { X } from 'lucide-react'
import { AiClientMark, AI_CLIENT_META, aiClientAccent, isAiClientId, type AiClientId } from '../lib/aiClient'
import { Modal } from './Modal'

export interface DetectedAiAgent {
  id: string
  name: string
  path: string
  mcp: string
}

interface Props {
  open: boolean
  agents: DetectedAiAgent[]
  title?: string
  subtitle?: string
  /** Currently preferred client — shown as “In use”. */
  currentId?: AiClientId | null
  confirmLabel?: string
  onPick: (id: AiClientId) => void
  onClose: () => void
}

export function AiClientPicker({
  open,
  agents,
  title = 'Choose your AI assistant',
  subtitle = 'KubeSpade will open this CLI in the app. You can change it later in Settings.',
  currentId = null,
  confirmLabel,
  onPick,
  onClose,
}: Props) {
  if (!open) return null

  const installed = agents.filter((a): a is DetectedAiAgent & { id: AiClientId } =>
    isAiClientId(a.id),
  )

  return (
    <Modal
      onClose={onClose}
      backdropClassName="ai-picker-backdrop overlay-backdrop"
      className="ai-picker-modal overlay-pop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ai-picker-title"
    >
      <button type="button" className="ai-picker-close" onClick={onClose} aria-label="Close">
        <X size={14} />
      </button>
      <div className="ai-picker-hero">
        <div className="ai-picker-hero-glow" aria-hidden />
        <h2 id="ai-picker-title">{title}</h2>
        <p>{subtitle}</p>
      </div>

      {installed.length === 0 ? (
        <div className="ai-picker-empty">
          <p>No supported AI CLI found on this system.</p>
          <p className="ai-picker-empty-hint">
            Install <code>claude</code>, <code>gemini</code>, <code>codex</code>,{' '}
            <code>copilot</code>, or <code>agent</code> (Cursor) on your PATH, then try again.
          </p>
        </div>
      ) : (
        <div className="ai-picker-grid">
          {installed.map(a => {
            const meta = AI_CLIENT_META[a.id]
            const accent = aiClientAccent(a.id)
            const inUse = currentId != null && a.id === currentId
            const cta = inUse
              ? 'In use'
              : (confirmLabel || (currentId ? 'Switch' : 'Use'))
            return (
              <button
                key={a.id}
                type="button"
                className={`ai-picker-card${inUse ? ' ai-picker-card-current' : ''}`}
                style={{
                  ['--ai-accent' as string]: accent.accent,
                  ['--ai-accent-soft' as string]: accent.accentSoft,
                }}
                disabled={inUse}
                aria-current={inUse ? 'true' : undefined}
                onClick={() => { if (!inUse) onPick(a.id) }}
              >
                <span className="ai-picker-card-icon">
                  <AiClientMark id={a.id} size={28} branded />
                </span>
                <span className="ai-picker-card-body">
                  <span className="ai-picker-card-name">{meta.name}</span>
                  <span className="ai-picker-card-blurb">{meta.blurb}</span>
                  <span className="ai-picker-card-path" title={a.path}>{a.path}</span>
                </span>
                <span className={`ai-picker-card-cta${inUse ? ' ai-picker-card-cta-current' : ''}`}>
                  {cta}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </Modal>
  )
}
