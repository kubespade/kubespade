/** Age from unix seconds relative to nowMs (Date.now()). */
export function formatAge(nowMs: number, unixSec: number): string {
  const s = Math.max(0, Math.floor(nowMs / 1000 - unixSec))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}
