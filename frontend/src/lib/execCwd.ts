/** Parse / strip KubeSpade cwd OSC: ESC ] 7777 ; cwd=PATH BEL|ST */

const CWD_OSC_RE = /\x1b\]7777;cwd=([^\x07\x1b]*)(?:\x07|\x1b\\)/g

/** Incomplete OSC at end of a chunk (held until next stdout). */
const INCOMPLETE_OSC_RE = /\x1b(?:\](?:7(?:7(?:7(?:7(?:;(?:c(?:w(?:d(?:=[^\x07\x1b]*)?)?)?)?)?)?)?)?)?)?$/

export type CwdOscCarry = string

export function consumeCwdOsc(
  chunk: string,
  carry: CwdOscCarry = '',
): { text: string; cwd?: string; carry: CwdOscCarry } {
  const combined = carry + chunk
  let cwd: string | undefined
  let text = combined.replace(CWD_OSC_RE, (_m, path: string) => {
    const p = String(path || '').trim()
    if (p.startsWith('/')) cwd = p
    return ''
  })

  const incomplete = text.match(INCOMPLETE_OSC_RE)
  let nextCarry: CwdOscCarry = ''
  if (incomplete) {
    nextCarry = incomplete[0]
    text = text.slice(0, -incomplete[0].length)
  }

  return { text, cwd, carry: nextCarry }
}

export function shortenPodPath(path: string, max = 36): string {
  if (path.length <= max) return path
  const parts = path.split('/').filter(Boolean)
  if (parts.length <= 2) return `…${path.slice(-(max - 1))}`
  let out = `…/${parts.slice(-2).join('/')}`
  if (out.length > max) out = `…${out.slice(-(max - 1))}`
  return out
}

export function joinLocalPath(dir: string, name: string): string {
  const sep = dir.includes('\\') && !dir.includes('/') ? '\\' : '/'
  const base = dir.replace(/[\\/]+$/, '')
  return `${base}${sep}${name}`
}

export function remoteBasename(remotePath: string): string {
  const cleaned = remotePath.replace(/\/+$/, '') || '/'
  if (cleaned === '/') return 'root'
  const i = cleaned.lastIndexOf('/')
  return i >= 0 ? cleaned.slice(i + 1) : cleaned
}
