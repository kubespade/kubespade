/** Error banner with an always-visible Reconnect action. */
export function ErrorReconnectBanner({
  error,
  onReconnect,
  label = 'Reconnect',
}: {
  error: string | null | undefined
  onReconnect: () => void
  label?: string
}) {
  if (!error) return null
  return (
    <div className="cv-error-banner">
      <span className="cv-error-banner-text">{error}</span>
      <button type="button" className="cv-error-reconnect" onClick={onReconnect}>
        {label}
      </button>
    </div>
  )
}
