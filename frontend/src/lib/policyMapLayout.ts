import type { NetworkMap, NetworkMapNode } from '../types'

export type Pos = { x: number; y: number }

export const NODE_H = 56
export const NODE_MIN_W = 168
export const NODE_MAX_W = 280
export const PAD = 28
const CHAR_W = 7.2 // approx mono 11px

export function nodeWidth(name: string | undefined): number {
  const raw = 24 + Math.ceil((name ?? '').length * CHAR_W)
  return Math.min(NODE_MAX_W, Math.max(NODE_MIN_W, raw))
}

/** Split long names into up to 2 lines that fit width. */
export function nameLines(name: string | undefined, width: number): [string, string?] {
  const n = name ?? ''
  const maxChars = Math.max(8, Math.floor((width - 20) / CHAR_W))
  if (n.length <= maxChars) return [n]
  // Prefer split on '-' near the middle of the first line budget.
  const budget = maxChars
  let split = -1
  for (let i = Math.min(budget, n.length - 1); i >= Math.floor(budget * 0.4); i--) {
    if (n[i] === '-' || n[i] === '_') {
      split = i + 1
      break
    }
  }
  if (split < 0) split = budget
  const a = n.slice(0, split)
  let b = n.slice(split)
  if (b.length > maxChars) b = b.slice(0, maxChars - 1) + '…'
  return [a, b]
}

export function isSyn(kind: string): boolean {
  return kind === 'CIDR' || kind === 'Namespace'
}

export function normalizeMap(raw: NetworkMap | null | undefined): NetworkMap {
  return {
    nodes: Array.isArray(raw?.nodes) ? raw.nodes : [],
    edges: Array.isArray(raw?.edges) ? raw.edges : [],
    policies: raw?.policies ?? 0,
    workloads: raw?.workloads ?? 0,
    namespace: raw?.namespace,
    note: raw?.note,
  }
}

export function autoLayout(nodes: NetworkMapNode[] | undefined): {
  positions: Map<string, Pos>
  sizes: Map<string, { w: number; h: number }>
  contentW: number
  contentH: number
} {
  const positions = new Map<string, Pos>()
  const sizes = new Map<string, { w: number; h: number }>()
  const list = nodes ?? []
  if (list.length === 0) return { positions, sizes, contentW: 400, contentH: 280 }

  for (const n of list) {
    const w = nodeWidth(n.name)
    const lines = nameLines(n.name, w)
    const h = NODE_H + (lines[1] ? 12 : 0) + ((n.openIngress || n.openEgress) ? 14 : 0)
    sizes.set(n.id, { w, h })
  }

  const syn = list.filter(n => isSyn(n.kind))
  const work = list.filter(n => !isSyn(n.kind))
  const left = syn.filter(n => n.kind === 'CIDR')
  const right = syn.filter(n => n.kind === 'Namespace')

  const groups = new Map<string, NetworkMapNode[]>()
  for (const n of work) {
    const key = n.namespace || '_'
    const bucket = groups.get(key) ?? []
    bucket.push(n)
    groups.set(key, bucket)
  }
  const nsKeys = [...groups.keys()].sort()
  const cols = Math.max(1, nsKeys.length)
  const gapX = 48
  const gapY = 28

  const maxWorkW = Math.max(NODE_MIN_W, ...work.map(n => sizes.get(n.id)?.w ?? NODE_MIN_W), NODE_MIN_W)
  const leftRailW = left.length > 0
    ? Math.max(...left.map(n => sizes.get(n.id)?.w ?? NODE_MIN_W)) + gapX
    : 0
  const colW = maxWorkW + gapX

  nsKeys.forEach((ns, ci) => {
    const col = groups.get(ns) ?? []
    let y = PAD
    col.forEach(n => {
      const sz = sizes.get(n.id) ?? { w: NODE_MIN_W, h: NODE_H }
      positions.set(n.id, {
        x: PAD + leftRailW + ci * colW + sz.w / 2,
        y: y + sz.h / 2,
      })
      y += sz.h + gapY
    })
  })

  let leftY = PAD
  left.forEach(n => {
    const sz = sizes.get(n.id) ?? { w: NODE_MIN_W, h: NODE_H }
    positions.set(n.id, { x: PAD + sz.w / 2, y: leftY + sz.h / 2 })
    leftY += sz.h + gapY
  })

  const workRight = PAD + leftRailW + cols * colW
  let rightY = PAD
  right.forEach(n => {
    const sz = sizes.get(n.id) ?? { w: NODE_MIN_W, h: NODE_H }
    positions.set(n.id, { x: workRight + sz.w / 2, y: rightY + sz.h / 2 })
    rightY += sz.h + gapY
  })

  let maxX = PAD + NODE_MIN_W
  let maxY = PAD + NODE_H
  for (const [id, p] of positions) {
    const sz = sizes.get(id) ?? { w: NODE_MIN_W, h: NODE_H }
    maxX = Math.max(maxX, p.x + sz.w / 2)
    maxY = Math.max(maxY, p.y + sz.h / 2)
  }
  return {
    positions,
    sizes,
    contentW: maxX + PAD + 24,
    contentH: maxY + PAD + 24,
  }
}

export function edgePath(from: Pos, to: Pos): string {
  const dx = Math.max(40, Math.abs(to.x - from.x) * 0.35)
  const cx1 = from.x + (to.x >= from.x ? dx : -dx)
  const cx2 = to.x + (to.x >= from.x ? -dx : dx)
  return `M ${from.x} ${from.y} C ${cx1} ${from.y}, ${cx2} ${to.y}, ${to.x} ${to.y}`
}

export function filterMap(data: NetworkMap, nsList: string[] | null): NetworkMap {
  const base = normalizeMap(data)
  if (!nsList || nsList.length <= 1) return base
  const allow = new Set(nsList)
  const nodes = base.nodes.filter(n => {
    if (n.kind === 'CIDR') return true
    if (n.namespace) return allow.has(n.namespace)
    return true
  })
  const ids = new Set(nodes.map(n => n.id))
  const edges = base.edges.filter(e => ids.has(e.from) && ids.has(e.to))
  return { ...base, nodes, edges }
}

export function nodeFingerprint(nodes: NetworkMapNode[] | undefined): string {
  return (nodes ?? []).map(n => `${n.id}:${n.openIngress ? 1 : 0}${n.openEgress ? 1 : 0}`).sort().join('|')
}
