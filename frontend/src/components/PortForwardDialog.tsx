import { useEffect, useState } from 'react'
import { Modal } from './Modal'

interface Props {
  podName: string
  namespace: string
  suggestedPorts?: number[]
  onConfirm: (localPort: number, remotePort: number, openInBrowser: boolean, scheme: 'http' | 'https' | 'auto') => void
  onCancel: () => void
  error?: string
  loading?: boolean
}

function defaultSchemeForPort(port: number): 'http' | 'https' {
  return port === 443 || port === 8443 || port === 9443 || port === 6443 ? 'https' : 'http'
}

export function PortForwardDialog({ podName, namespace, suggestedPorts = [], onConfirm, onCancel, error, loading }: Props) {
  const firstPort = suggestedPorts[0]
  const [remotePort, setRemotePort] = useState(firstPort ? String(firstPort) : '')
  const [localPort, setLocalPort] = useState(() =>
    firstPort ? String(Math.floor(Math.random() * 20000) + 30000) : ''
  )
  const [openInBrowser, setOpenInBrowser] = useState(true)
  // 'auto' = let backend pick (detects Argo CD --insecure etc.)
  const [scheme, setScheme] = useState<'auto' | 'http' | 'https'>('auto')

  const remote = parseInt(remotePort) || 0
  const local = parseInt(localPort) || remote

  useEffect(() => {
    // When remote port changes, reset to auto so backend can decide.
    setScheme('auto')
  }, [remotePort])

  function selectPort(p: number) {
    setRemotePort(String(p))
    if (!localPort) setLocalPort(String(Math.floor(Math.random() * 20000) + 30000))
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && remote > 0 && !loading) onConfirm(local, remote, openInBrowser, scheme)
    if (e.key === 'Escape') onCancel()
  }

  const hint = scheme === 'auto' && (remote === 443 || remote === 8443)
    ? 'Auto: https, or http if the pod runs with --insecure'
    : undefined

  return (
    <Modal
      onClose={onCancel}
      backdropClassName="confirm-backdrop pf-dialog-backdrop overlay-backdrop"
      className="confirm-dialog pf-dialog overlay-pop"
      dismissTrigger="click"
      closeOnEscape={false}
      onKeyDown={handleKey}
      style={{ width: 400 }}
    >
      <div className="confirm-title">Port Forward — {podName}</div>

      {suggestedPorts.length > 1 && (
        <div className="pf-port-chips">
          {suggestedPorts.map(p => (
            <button
              key={p}
              className={`pf-port-chip${String(p) === remotePort ? ' pf-port-chip-active' : ''}`}
              onClick={() => selectPort(p)}
              type="button"
            >
              {p}
            </button>
          ))}
        </div>
      )}

      <div className="pf-row">
        <div className="pf-field">
          <label className="pf-label">Remote port</label>
          <input
            className="pf-input"
            type="number" min={1} max={65535}
            placeholder="e.g. 8080"
            value={remotePort}
            onChange={e => setRemotePort(e.target.value)}
            autoFocus={!firstPort}
          />
        </div>
        <span className="pf-arrow">→</span>
        <div className="pf-field">
          <label className="pf-label">Local port</label>
          <input
            className="pf-input"
            type="number" min={1} max={65535}
            placeholder={remotePort || 'same as pod'}
            value={localPort}
            onChange={e => setLocalPort(e.target.value)}
            autoFocus={!!firstPort}
          />
        </div>
      </div>
      <div className="pf-ns">Namespace: <b>{namespace}</b></div>

      <div className="pf-scheme-row">
        <span className="pf-label">Open as</span>
        <div className="pf-scheme-chips">
          {([
            ['auto', `Auto${remote ? ` (${defaultSchemeForPort(remote)})` : ''}`],
            ['http', 'HTTP'],
            ['https', 'HTTPS'],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={`pf-port-chip${scheme === value ? ' pf-port-chip-active' : ''}`}
              onClick={() => setScheme(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {hint && <div className="pf-scheme-hint">{hint}</div>}

      <label className="pf-open-browser">
        <input
          type="checkbox"
          checked={openInBrowser}
          onChange={e => setOpenInBrowser(e.target.checked)}
        />
        Open in browser
      </label>
      {error && <div className="confirm-error">{error}</div>}
      <div className="confirm-actions">
        <button className="confirm-btn confirm-btn-cancel" onClick={onCancel} disabled={loading}>Cancel</button>
        <button className="confirm-btn confirm-btn-primary" onClick={() => onConfirm(local, remote, openInBrowser, scheme)} disabled={loading || remote === 0}>
          {loading ? 'Starting…' : 'Start'}
        </button>
      </div>
    </Modal>
  )
}
