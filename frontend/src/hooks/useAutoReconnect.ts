import { useCallback, useEffect, useRef } from 'react'
import { isTransientNetworkError } from '../lib/apiError'

const DEFAULT_DELAY_MS = 2500
const DEFAULT_MAX_ATTEMPTS = 5

type Options = {
  delayMs?: number
  /** Stop scheduling after this many auto-retries (default 5). */
  maxAttempts?: number
  /** Called once when maxAttempts is exhausted. */
  onExhausted?: () => void
}

/** Schedule a soft reconnect after transient network failures — with a hard cap. */
export function useAutoReconnect(reconnect: () => void, options: Options = {}) {
  const delayMs = options.delayMs ?? DEFAULT_DELAY_MS
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const attemptsRef = useRef(0)
  const reconnectRef = useRef(reconnect)
  const onExhaustedRef = useRef(options.onExhausted)
  reconnectRef.current = reconnect
  onExhaustedRef.current = options.onExhausted

  const clear = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const resetAttempts = useCallback(() => {
    attemptsRef.current = 0
  }, [])

  const schedule = useCallback(() => {
    if (timerRef.current) return
    if (attemptsRef.current >= maxAttempts) {
      onExhaustedRef.current?.()
      return
    }
    attemptsRef.current += 1
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      reconnectRef.current()
    }, delayMs)
  }, [delayMs, maxAttempts])

  /** Auto-retry timeouts / connection-lost style errors. */
  const onFailure = useCallback((message: string) => {
    if (isTransientNetworkError(message) || /connection lost|retrying/i.test(message)) {
      schedule()
    }
  }, [schedule])

  useEffect(() => () => clear(), [clear])

  return { clear, schedule, onFailure, resetAttempts }
}
