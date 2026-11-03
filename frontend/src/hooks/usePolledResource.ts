import { useEffect, useRef, useState } from 'react'
import type { DependencyList } from 'react'
import { useAutoReconnect } from './useAutoReconnect'

interface Options<T> {
  /** Value used before the first load and while re-fetching after deps change. */
  initial: T
  /** Poll interval in ms (default 30s). */
  intervalMs?: number
  /** Fallback message when the thrown error is not an Error instance. */
  errorLabel?: string
}

interface PolledResource<T> {
  data: T
  loading: boolean
  error: string
  /** Manual re-fetch that also clears the auto-reconnect timer (e.g. banner button). */
  reload: () => void
  /** Silent re-fetch without toggling the loading state (e.g. after a mutation). */
  refresh: () => void
  setError: (msg: string) => void
}

/**
 * Poll a resource on an interval with the shared auto-reconnect behaviour.
 * Collapses the identical loading/error/interval/useAutoReconnect block that was
 * duplicated across the list pages. Re-fetches whenever `deps` change.
 */
export function usePolledResource<T>(
  fetcher: () => Promise<T>,
  deps: DependencyList,
  opts: Options<T>,
): PolledResource<T> {
  const { initial, intervalMs = 30_000, errorLabel = 'Failed to load' } = opts
  const [data, setData] = useState<T>(initial)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher

  const loadRef = useRef<() => Promise<void>>(async () => {})
  const { clear: clearAutoReconnect, onFailure, resetAttempts } = useAutoReconnect(() => {
    setError('')
    void loadRef.current()
  }, {
    onExhausted: () => {
      setError(prev => (prev ? `${prev.replace(/\s*—\s*retrying…$/i, '')} — stopped retrying.` : 'Stopped retrying.'))
    },
  })

  async function load() {
    try {
      const result = await fetcherRef.current()
      setData(result)
      setError('')
      resetAttempts()
      clearAutoReconnect()
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : errorLabel
      setError(message)
      onFailure(message)
    } finally {
      setLoading(false)
    }
  }
  loadRef.current = load

  useEffect(() => {
    setLoading(true)
    setData(initial)
    void load()
    const t = setInterval(() => { void load() }, intervalMs)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return {
    data,
    loading,
    error,
    reload: () => {
      clearAutoReconnect()
      setError('')
      setLoading(true)
      void load()
    },
    refresh: () => { void load() },
    setError,
  }
}
