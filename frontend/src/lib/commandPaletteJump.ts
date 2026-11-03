import type { Resource } from './resourceKinds'

export interface CommandPaletteJump {
  kind: Resource
  name: string
  namespace?: string
}

let pending: CommandPaletteJump | null = null
const listeners = new Set<() => void>()

export function setCommandPaletteJump(jump: CommandPaletteJump): void {
  pending = jump
  listeners.forEach(cb => {
    try { cb() } catch { /* ignore */ }
  })
}

/** Consume a jump intended for the given resource kind (clears the pending slot). */
export function takeCommandPaletteJump(kind: string): CommandPaletteJump | null {
  if (!pending || pending.kind !== kind) return null
  const jump = pending
  pending = null
  return jump
}

/** Notify tables when a jump is queued (same-kind open must still react). */
export function subscribeCommandPaletteJump(cb: () => void): () => void {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}
