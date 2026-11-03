/**
 * UI prefs that must survive app reinstall (same DataDir as profiles).
 * Chromium localStorage is wiped with Electron userData on reinstall;
 * this store mirrors tracked keys to ~/Library/Application Support/KubeSpade/ui-prefs.json.
 */
import { authHeaders } from '../api/token'

const TRACKED_EXACT = new Set([
  'ui-scale',
  'ui-density',
  'ui-theme',
  'app-view',
  'selected-profile',
  'selected-resource',
  'resource-map',
  'ns-map',
  'sidebar-expanded',
  'sidebar-width',
  'sidebar-nav-by-profile',
  'recent-profiles',
  'ai-preferred-client',
])

const TRACKED_PREFIXES = [
  'k8s-col-hidden::',
  'k8s-col-widths::',
]

let cache: Record<string, string> = {}
let flushTimer: ReturnType<typeof setTimeout> | null = null
let pendingRemove = new Set<string>()
let hydrated = false

export function isTrackedPref(key: string): boolean {
  if (TRACKED_EXACT.has(key)) return true
  return TRACKED_PREFIXES.some(p => key.startsWith(p))
}

function readLocalTracked(): Record<string, string> {
  const out: Record<string, string> = {}
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (!k || !isTrackedPref(k)) continue
      const v = localStorage.getItem(k)
      if (v != null) out[k] = v
    }
  } catch {
    /* ignore */
  }
  return out
}

function mirrorToLocalStorage(prefs: Record<string, string>) {
  try {
    for (const [k, v] of Object.entries(prefs)) {
      if (isTrackedPref(k)) localStorage.setItem(k, v)
    }
  } catch {
    /* ignore */
  }
}

async function fetchRemote(): Promise<Record<string, string>> {
  const res = await fetch('/api/ui-prefs', { headers: authHeaders() })
  if (!res.ok) return {}
  const body = await res.json() as { prefs?: Record<string, string> }
  return body.prefs ?? {}
}

async function pushRemote(updates: Record<string, string>, remove: string[]): Promise<void> {
  const res = await fetch('/api/ui-prefs', {
    method: 'PUT',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ prefs: updates, remove }),
  })
  if (!res.ok) {
    const d = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(d.error ?? 'Failed to save UI prefs')
  }
}

function scheduleFlush() {
  if (flushTimer) clearTimeout(flushTimer)
  flushTimer = setTimeout(() => {
    flushTimer = null
    void flushNow()
  }, 400)
}

async function flushNow(): Promise<void> {
  if (!hydrated) return
  const remove = [...pendingRemove]
  pendingRemove.clear()
  const updates: Record<string, string> = {}
  for (const [k, v] of Object.entries(cache)) {
    if (isTrackedPref(k)) updates[k] = v
  }
  try {
    await pushRemote(updates, remove)
  } catch {
    // Keep working offline / if API briefly unavailable; next change retries.
    for (const k of remove) pendingRemove.add(k)
  }
}

/** Load disk prefs (API) and migrate any localStorage-only keys once. Call before rendering App. */
export async function initPersistentStore(): Promise<void> {
  const local = readLocalTracked()
  cache = { ...local }

  try {
    const remote = await fetchRemote()
    const migrate: Record<string, string> = {}
    for (const [k, v] of Object.entries(local)) {
      if (!(k in remote)) migrate[k] = v
    }
    cache = { ...local, ...remote }
    mirrorToLocalStorage(cache)
    if (Object.keys(migrate).length > 0) {
      await pushRemote(cache, [])
    }
  } catch {
    // Backend unreachable — keep localStorage seed for this session.
  }

  hydrated = true
}

export function prefsGet(key: string): string | null {
  if (Object.prototype.hasOwnProperty.call(cache, key)) return cache[key]!
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function prefsSet(key: string, value: string): void {
  cache[key] = value
  pendingRemove.delete(key)
  try {
    localStorage.setItem(key, value)
  } catch {
    /* ignore */
  }
  if (isTrackedPref(key)) scheduleFlush()
}

export function prefsRemove(key: string): void {
  delete cache[key]
  if (isTrackedPref(key)) pendingRemove.add(key)
  try {
    localStorage.removeItem(key)
  } catch {
    /* ignore */
  }
  if (isTrackedPref(key)) scheduleFlush()
}
