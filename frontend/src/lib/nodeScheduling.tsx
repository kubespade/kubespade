import type { NodeInfo } from '../types'

export function NodeStatusBadges({ n }: { n: Pick<NodeInfo, 'status' | 'unschedulable'> }) {
  if (n.unschedulable) {
    return <span className="badge status-cordoned">Cordoned</span>
  }
  return <span className={`badge status-${n.status.toLowerCase()}`}>{n.status}</span>
}

export function nodeStatusSortKey(n: Pick<NodeInfo, 'status' | 'unschedulable'>): string {
  if (n.unschedulable) return `0-Cordoned`
  return `1-${n.status}`
}
