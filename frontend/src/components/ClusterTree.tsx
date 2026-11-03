import {
  Boxes, Component, FolderInput, MoreHorizontal, Pencil, Server,
} from 'lucide-react'
import type { Resource } from '../lib/resourceKinds'
import { SIDEBAR_CATEGORIES, SIDEBAR_TOP_ITEMS } from '../lib/sidebarNav'
import type { CRDGroup, Profile } from '../types'
import { PROFILE_DISPLAY_NAME_MAX } from '../lib/profileLabel'

type NavItem = (typeof SIDEBAR_TOP_ITEMS)[number]
const TOP_ITEMS = SIDEBAR_TOP_ITEMS
const CATEGORIES = SIDEBAR_CATEGORIES

export interface ProfileNavState {
  collapsedCats: string[]
  expandedCrdGroups: string[]
  crdSectionOpen: boolean
}

export interface ClusterTreeProps {
  profile: Profile
  selectedProfile: string | null
  activeResource: Resource
  clusterNavActive: boolean
  connectingProfile?: string | null
  expanded: Set<string>
  focusedCluster: string | null
  openDropdown: string | null
  renamingCluster: string | null
  clusterRenameValue: string
  setClusterRenameValue: (v: string) => void
  clusterRenameCancelRef: React.MutableRefObject<boolean>
  nav: ProfileNavState
  crdByProfile: Record<string, CRDGroup[]>
  crdStatus: Record<string, 'idle' | 'loading' | 'ready' | 'error'>
  pfActiveByProfile: Record<string, number>
  onClusterClick: (profile: Profile) => void
  onToggleClusterActions: (profileName: string) => void
  onStartClusterRename: (profile: Profile) => void
  onCommitClusterRename: (profile: Profile) => void | Promise<void>
  onOpenClusterDropdown: (e: React.MouseEvent, profileName: string) => void
  onSelectResource: (profileName: string, r: Resource) => void
  onToggleCategory: (profileName: string, catId: string) => void
  onToggleCrdSection: (profileName: string) => void
  onToggleCrdGroup: (profileName: string, group: string) => void
  onLoadCrdGroups: (profileName: string, force?: boolean) => void
  onSetRenamingCluster: (name: string | null) => void
}

export function ClusterTree(props: ClusterTreeProps) {
  const {
    profile: p,
    selectedProfile,
    activeResource,
    clusterNavActive,
    connectingProfile,
    expanded,
    focusedCluster,
    openDropdown,
    renamingCluster,
    clusterRenameValue,
    setClusterRenameValue,
    clusterRenameCancelRef,
    nav,
    crdByProfile,
    crdStatus,
    pfActiveByProfile,
    onClusterClick,
    onToggleClusterActions,
    onStartClusterRename,
    onCommitClusterRename,
    onOpenClusterDropdown,
    onSelectResource,
    onToggleCategory,
    onToggleCrdSection,
    onToggleCrdGroup,
    onLoadCrdGroups,
    onSetRenamingCluster,
  } = props


  const renderItems = (items: NavItem[], profileName: string, opts?: { top?: boolean }) => {
    const isActiveItem = (id: Resource) =>
      clusterNavActive && selectedProfile === profileName && activeResource === id
    return items.map(item => {
      const pfCount = item.id === 'portforwards' ? (pfActiveByProfile[profileName] ?? 0) : 0
      const active = isActiveItem(item.id)
      return (
        <button
          key={`${profileName}:${item.id}`}
          type="button"
          data-sidebar-nav={`${profileName}:${item.id}`}
          className={`sidebar-resource-btn${opts?.top ? ' sidebar-resource-top' : ''}${
            active ? ' active' : ''
          }${pfCount > 0 ? ' pf-active' : ''}`}
          onClick={() => onSelectResource(profileName, item.id)}
        >
          <span className="sidebar-resource-icon">{item.icon}</span>
          {item.label}
          {pfCount > 0 && <span className="sidebar-resource-pf-badge">{pfCount}</span>}
        </button>
      )
    })
  }

    const isSelected = selectedProfile === p.name
    const isExpanded = expanded.has(p.name) && p.connected
    const isConnecting = connectingProfile === p.name && !p.connected
    const clusterLabel = p.displayName || p.clusterName || p.name
    const isRenaming = renamingCluster === p.name
    const showClusterActions = focusedCluster === p.name || openDropdown === p.name
    const collapsedCats = new Set(nav.collapsedCats)
    const expandedCrdGroups = new Set(nav.expandedCrdGroups)
    const crdSectionOpen = nav.crdSectionOpen

  return (
      <div className="sidebar-cluster-group">
        <div className={`sidebar-cluster-row${showClusterActions ? ' sidebar-cluster-row-active' : ''}`}>
          {isRenaming ? (
            <div className={`sidebar-cluster-btn ${isSelected ? 'selected' : ''}`}>
              <span className="sidebar-chevron">{isExpanded ? '▾' : '▸'}</span>
              <Server size={14} className="sidebar-cluster-icon" />
              <input
                className="sidebar-cluster-rename-input"
                value={clusterRenameValue}
                maxLength={PROFILE_DISPLAY_NAME_MAX}
                autoFocus
                onChange={e => setClusterRenameValue(e.target.value)}
                onBlur={() => { void onCommitClusterRename(p) }}
                onKeyDown={e => {
                  if (e.key === 'Enter') void onCommitClusterRename(p)
                  if (e.key === 'Escape') {
                    clusterRenameCancelRef.current = true
                    onSetRenamingCluster(null)
                  }
                }}
              />
            </div>
          ) : (
          <button
            className={`sidebar-cluster-btn ${isSelected ? 'selected' : ''}${!p.connected ? ' disconnected' : ''}${isConnecting ? ' connecting' : ''}`}
            onClick={() => onClusterClick(p)}
            disabled={isConnecting}
            title={p.clusterName && p.clusterName !== clusterLabel ? p.clusterName : clusterLabel}
          >
            <span className="sidebar-chevron">{isExpanded ? '▾' : '▸'}</span>
            <Server size={14} className="sidebar-cluster-icon" />
            <span className="sidebar-cluster-name">{clusterLabel}</span>
            {isConnecting
              ? <span className="sidebar-connecting-dot" />
              : p.connected
                ? <span className="sidebar-live-dot" />
                : <span className="sidebar-offline-dot" title="Not connected" />}
          </button>
          )}
          {!isRenaming && (
            <div className="sg-header-action-btns">
              <button
                type="button"
                className="sg-more-btn"
                aria-label="Cluster actions"
                onClick={e => { e.stopPropagation(); onToggleClusterActions(p.name) }}
              >
                <MoreHorizontal size={14} />
              </button>
              <button
                className="sg-rename-btn"
                onClick={e => { e.stopPropagation(); onStartClusterRename(p) }}
                title="Rename in app"
              >
                <Pencil size={11} />
              </button>
              <button
                className="sidebar-cluster-assign-btn"
                onClick={e => onOpenClusterDropdown(e, p.name)}
                title="Move to group"
              >
                <FolderInput size={12} />
              </button>
            </div>
          )}
        </div>

        {isExpanded && (
          <div className="sidebar-resources">
            {renderItems(TOP_ITEMS, p.name, { top: true })}

            {CATEGORIES.map(cat => {
              const catOpen = !collapsedCats.has(cat.id)
              const pfCount = pfActiveByProfile[p.name] ?? 0
              const showNetworkPfBadge = cat.id === 'network' && !catOpen && pfCount > 0
              return (
                <div key={cat.id} className="sidebar-category">
                  <button
                    className={`sidebar-category-btn${showNetworkPfBadge ? ' pf-active' : ''}`}
                    onClick={() => onToggleCategory(p.name, cat.id)}
                  >
                    <span className="sidebar-chevron">{catOpen ? '▾' : '▸'}</span>
                    <span className="sidebar-category-icon">{cat.icon}</span>
                    <span className="sidebar-category-label">{cat.label}</span>
                    {showNetworkPfBadge && (
                      <span className="sidebar-resource-pf-badge" title={`${pfCount} port-forward${pfCount === 1 ? '' : 's'} active`}>
                        {pfCount}
                      </span>
                    )}
                  </button>
                  {catOpen && (
                    <div className="sidebar-category-items">
                      {renderItems(cat.items, p.name)}
                    </div>
                  )}
                </div>
              )
            })}

            <div className="sidebar-category">
              <button
                className="sidebar-category-btn"
                onClick={() => onToggleCrdSection(p.name)}
              >
                <span className="sidebar-chevron">{crdSectionOpen ? '▾' : '▸'}</span>
                <span className="sidebar-category-icon"><Boxes size={11} /></span>
                Custom Resources
              </button>
              {crdSectionOpen && (
                <div className="sidebar-category-items">
                  {(() => {
                    const status = crdStatus[p.name] ?? 'idle'
                    const groupsForProfile = crdByProfile[p.name] ?? []
                    if (status === 'loading' || status === 'idle') {
                      return <div className="sidebar-crd-status">Loading…</div>
                    }
                    if (status === 'error') {
                      return (
                        <button
                          type="button"
                          className="sidebar-crd-status sidebar-crd-retry"
                          onClick={() => onLoadCrdGroups(p.name, true)}
                        >
                          Failed — click to retry
                        </button>
                      )
                    }
                    if (groupsForProfile.length === 0) {
                      return <div className="sidebar-crd-status">No custom resources</div>
                    }
                    return groupsForProfile.map(g => {
                      const grpOpen = expandedCrdGroups.has(g.group)
                      return (
                        <div key={g.group} className="sidebar-crd-group">
                          <button
                            className="sidebar-crd-group-btn"
                            onClick={() => onToggleCrdGroup(p.name, g.group)}
                          >
                            <span className="sidebar-chevron">{grpOpen ? '▾' : '▸'}</span>
                            {g.group}
                          </button>
                          {grpOpen && g.crds.map(crd => {
                            const storageVersion = crd.versions.find(v => v.storage)?.name ?? crd.versions[0]?.name ?? 'v1'
                            const rid: Resource = `crd::${crd.group}::${storageVersion}::${crd.plural}::${crd.scope}::${crd.kind}`
                            const isActive =
                              clusterNavActive && selectedProfile === p.name && activeResource === rid
                            return (
                              <button
                                key={crd.name}
                                type="button"
                                data-sidebar-nav={`${p.name}:${rid}`}
                                className={`sidebar-resource-btn${isActive ? ' active' : ''}`}
                                onClick={() => onSelectResource(p.name, rid)}
                              >
                                <span className="sidebar-resource-icon"><Component size={12} /></span>
                                {crd.kind}
                              </button>
                            )
                          })}
                        </div>
                      )
                    })
                  })()}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    )
  
}
