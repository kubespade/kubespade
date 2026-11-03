/** Exponential-ish backoff: 1.5s, 3s, 4.5s, … matching existing metrics history polls. */
export function defaultRetryBackoff(retry: number): number {
  return 1500 * (retry + 1)
}

export interface FetchWithRetryOpts<T> {
  /** Max retry attempts after the first try (default 4 → 5 total attempts). */
  retries?: number
  backoff?: (retry: number) => number
  isCancelled?: () => boolean
  /** When true, wait and try again (e.g. history still too short). */
  shouldRetry?: (result: T, retry: number) => boolean
}

/**
 * Call `fn` with backoff on throw or when `shouldRetry` says so.
 * Returns the last successful value, or `undefined` if every attempt threw.
 */
export async function fetchWithRetry<T>(
  fn: () => Promise<T>,
  opts: FetchWithRetryOpts<T> = {},
): Promise<T | undefined> {
  const retries = opts.retries ?? 4
  const backoff = opts.backoff ?? defaultRetryBackoff
  let last: T | undefined
  for (let retry = 0; ; retry++) {
    if (opts.isCancelled?.()) return last
    try {
      last = await fn()
      if (opts.isCancelled?.()) return last
      if (opts.shouldRetry?.(last, retry) && retry < retries) {
        await new Promise(r => setTimeout(r, backoff(retry)))
        continue
      }
      return last
    } catch {
      if (opts.isCancelled?.()) return last
      if (retry < retries) {
        await new Promise(r => setTimeout(r, backoff(retry)))
        continue
      }
      return last
    }
  }
}
