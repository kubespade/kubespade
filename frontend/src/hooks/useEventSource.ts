import { useEffect, useRef } from 'react'
import { withAccessToken } from '../api/token'

export interface EventSourceHandlers {
  /** Called for each SSE message. Receives the EventSource so the caller can close() early. */
  onMessage: (event: MessageEvent, es: EventSource) => void
  /** Called on EventSource error. Receives the EventSource so the caller can close(). */
  onError?: (event: Event, es: EventSource) => void
}

/**
 * Open an EventSource for `url` (with the per-launch access token appended),
 * dispatch messages/errors to the given handlers, and close it on cleanup /
 * when `url` changes. Pass `url = null` to skip connecting.
 *
 * Handlers are read fresh on every event (kept in a ref), so callers don't need
 * to memoize them and the connection is not torn down when they change.
 */
export function useEventSource(url: string | null, handlers: EventSourceHandlers) {
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers

  useEffect(() => {
    if (url === null) return
    const es = new EventSource(withAccessToken(url))
    es.onmessage = (e) => handlersRef.current.onMessage(e, es)
    es.onerror = (e) => handlersRef.current.onError?.(e, es)
    return () => es.close()
  }, [url])
}
