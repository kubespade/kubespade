type Level = 'LOG' | 'WARN' | 'ERROR'

interface Entry { ts: string; level: Level; msg: string }

const entries: Entry[] = []
let active = false

const orig = {
  log:   console.log.bind(console) as (...a: unknown[]) => void,
  warn:  console.warn.bind(console) as (...a: unknown[]) => void,
  error: console.error.bind(console) as (...a: unknown[]) => void,
}

function now() {
  return new Date().toISOString().replace('T', ' ').slice(0, 23)
}

function serialize(a: unknown): string {
  if (typeof a === 'object' && a !== null) {
    try { return JSON.stringify(a) } catch { /* fall through */ }
  }
  return String(a)
}

function capture(level: Level, args: unknown[]) {
  if (!active) return
  entries.push({ ts: now(), level, msg: args.map(serialize).join(' ') })
}

export function enableDebug(): void {
  active = true
  entries.length = 0
  console.log   = (...a: unknown[]) => { capture('LOG',   a); orig.log(...a) }
  console.warn  = (...a: unknown[]) => { capture('WARN',  a); orig.warn(...a) }
  console.error = (...a: unknown[]) => { capture('ERROR', a); orig.error(...a) }
}

// Restores console, returns collected frontend log lines (for download).
export function disableDebug(): string {
  active = false
  console.log   = orig.log
  console.warn  = orig.warn
  console.error = orig.error
  const out = entries.map(e => `[${e.ts}] [FRONTEND-${e.level}] ${e.msg}`).join('\n')
  entries.length = 0
  return out
}

export function isDebugEnabled(): boolean { return active }
