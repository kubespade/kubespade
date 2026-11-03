import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Folder, FolderOpen,
  Pencil, Plus, Settings2, X, MoreHorizontal,
} from 'lucide-react'
import type { Resource } from '../lib/resourceKinds'
import { SIDEBAR_CATEGORIES } from '../lib/sidebarNav'
import type { CRDGroup, Profile } from '../types'
import { api } from '../api/client'
import { prefsGet, prefsSet } from '../lib/persistentStore'
import { fixedRect } from '../lib/uiZoom'
import { ConfirmDialog } from './ConfirmDialog'
import { NewGroupDialog } from './NewGroupDialog'
import { EmptyState } from './EmptyState'
import { cssEscape } from '../lib/cssEscape'
import { useSidebarResize } from '../hooks/useSidebarResize'
import { ClusterTree, type ProfileNavState } from './ClusterTree'

const CATEGORIES = SIDEBAR_CATEGORIES

const NAV_STORAGE_KEY = 'sidebar-nav-by-profile'

function defaultNavState(): ProfileNavState {
  return {
    collapsedCats: CATEGORIES.map(c => c.id),
    expandedCrdGroups: [],
    crdSectionOpen: false,
  }
}

function loadNavByProfile(): Record<string, ProfileNavState> {
  try {
    const saved = prefsGet(NAV_STORAGE_KEY)
    if (saved) return JSON.parse(saved) as Record<string, ProfileNavState>
  } catch { /* ignore */ }
  return {}
}

interface Props {
  profiles: Profile[]
  selectedProfile: string | null
  /** Resource currently shown in the main pane (same source as ClusterView). */
  activeResource: Resource
  /** True only while the main pane is showing a cluster resource view. */
  clusterNavActive: boolean
  resourceMap: Record<string, Resource>
  groups: string[]
  onSelectCluster: (name: string) => void
  connectingProfile?: string | null
  onSelectResource: (profileName: string, r: Resource) => void
  onManage: () => void
  onCreateGroup: (name: string) => Promise<string[]>
  onDeleteGroup: (name: string) => void | Promise<void>
  onRenameGroup: (oldName: string, newName: string) => void
  onSetProfileGroup: (profileName: string, group: string) => void
  onRenameProfile: (profileName: string, displayName: string) => void | Promise<void>
  onSidebarWidthChange?: (w: number) => void
  managing: boolean
  /** Active port-forward counts keyed by profile name (sidebar badge). */
  pfActiveByProfile?: Record<string, number>
}

// ── Group assignment dropdown (portal) ────────────────────────────────────────

function GroupDropdown({ profile, groups, onAssign, onCreateGroup, onClose }: {
  profile: Profile
  groups: string[]
  onAssign: (group: string) => void
  onCreateGroup: (name: string) => Promise<string[]>
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [onClose])

  const available = groups.filter(g => g !== profile.group)

  async function commitCreate() {
    const name = newName.trim()
    if (!name) {
      setCreating(false)
      setNewName('')
      return
    }
    setBusy(true)
    setError('')
    try {
      await onCreateGroup(name)
      onAssign(name)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create group')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div ref={ref} className="sg-dropdown">
      <div className="sg-dropdown-title">Move to group</div>
      {profile.group && (
        <button className="sg-dropdown-item sg-dropdown-item-remove" onClick={() => { onAssign(''); onClose() }}>
          <X size={11} /> No group
        </button>
      )}
      {available.length === 0 && !profile.group && !creating && (
        <div className="sg-dropdown-empty">No groups yet</div>
      )}
      {available.map(g => (
        <button key={g} className="sg-dropdown-item" onClick={() => { onAssign(g); onClose() }}>
          <Folder size={11} /> {g}
        </button>
      ))}
      <div className="sg-dropdown-divider" />
      {creating ? (
        <div className="sg-dropdown-create">
          <input
            className="sg-add-input"
            placeholder="Group name…"
            value={newName}
            autoFocus
            disabled={busy}
            onChange={e => { setNewName(e.target.value); setError('') }}
            onKeyDown={e => {
              if (e.key === 'Enter') commitCreate()
              if (e.key === 'Escape') { setCreating(false); setNewName(''); setError('') }
            }}
          />
          {error && <div className="sg-dropdown-create-error">{error}</div>}
        </div>
      ) : (
        <button className="sg-dropdown-item sg-dropdown-item-create" onClick={() => setCreating(true)}>
          <Plus size={11} /> Create group…
        </button>
      )}
    </div>
  )
}

export function Sidebar({
  profiles, selectedProfile, activeResource, clusterNavActive, resourceMap,
  groups, onSelectCluster, connectingProfile, onSelectResource, onManage,
  onCreateGroup, onDeleteGroup, onRenameGroup, onSetProfileGroup,
  onRenameProfile,
  onSidebarWidthChange, managing,
  pfActiveByProfile = {},
}: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    try {
      const saved = prefsGet('sidebar-expanded')
      return saved ? new Set(JSON.parse(saved) as string[]) : new Set()
    } catch { return new Set() }
  })
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const [navByProfile, setNavByProfile] = useState<Record<string, ProfileNavState>>(loadNavByProfile)
  const [crdByProfile, setCrdByProfile] = useState<Record<string, CRDGroup[]>>({})
  const [crdStatus, setCrdStatus] = useState<Record<string, 'idle' | 'loading' | 'ready' | 'error'>>({})
  const { sidebarWidth, onResizeStart, onResizeTouchStart } = useSidebarResize(onSidebarWidthChange)
  const prevConnectedRef = useRef<Record<string, boolean>>({})
  /** Clusters the user manually collapsed — skip auto re-expand (poll / port-forwards). */
  const userCollapsedRef = useRef<Set<string>>(new Set())
  const clusterRenameCancelRef = useRef(false)

  // Keep CSS --sidebar-w in sync so fixed panels (exec terminal) dock to the main column.
  useEffect(() => {
    document.documentElement.style.setProperty('--sidebar-w', `${sidebarWidth}px`)
  }, [sidebarWidth])

  // Keep the active nav item visible when switching clusters/resources.
  useEffect(() => {
    if (!clusterNavActive || !selectedProfile) return
    const el = document.querySelector(
      `[data-sidebar-nav="${cssEscape(`${selectedProfile}:${activeResource}`)}"]`,
    )
    if (el instanceof HTMLElement) {
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    }
  }, [clusterNavActive, selectedProfile, activeResource])

  // Group management state
  const [renamingGroup, setRenamingGroup] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [renamingCluster, setRenamingCluster] = useState<string | null>(null)
  const [clusterRenameValue, setClusterRenameValue] = useState('')
  const [addingGroup, setAddingGroup] = useState(false)
  const [openDropdown, setOpenDropdown] = useState<string | null>(null) // profile name
  const [dropdownPos, setDropdownPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const [deleteGroupTarget, setDeleteGroupTarget] = useState<string | null>(null)
  const [deleteGroupBusy, setDeleteGroupBusy] = useState(false)
  const [deleteGroupError, setDeleteGroupError] = useState('')
  /** Group/cluster ⋯ tapped — show rename/move until tap elsewhere. */
  const [focusedGroup, setFocusedGroup] = useState<string | null>(null)
  const [focusedCluster, setFocusedCluster] = useState<string | null>(null)

  useEffect(() => {
    if (!focusedGroup && !focusedCluster) return
    function onPointerUp(e: PointerEvent) {
      window.setTimeout(() => {
        const t = e.target
        if (t instanceof Element) {
          if (t.closest('.sg-header')) return
          if (t.closest('.sidebar-cluster-row')) return
          if (t.closest('.sg-dropdown')) return
        }
        setFocusedGroup(null)
        setFocusedCluster(null)
      }, 0)
    }
    document.addEventListener('pointerup', onPointerUp)
    return () => document.removeEventListener('pointerup', onPointerUp)
  }, [focusedGroup, focusedCluster])

  useEffect(() => {
    prefsSet('sidebar-expanded', JSON.stringify([...expanded]))
  }, [expanded])

  // Keep Network open when Port Forwarding is selected so the active badge stays visible.
  useEffect(() => {
    for (const [profileName, resource] of Object.entries(resourceMap)) {
      if (resource !== 'portforwards') continue
      if (userCollapsedRef.current.has(profileName)) continue
      updateProfileNav(profileName, nav => ({
        ...nav,
        collapsedCats: nav.collapsedCats.filter(id => id !== 'network'),
      }))
      setExpanded(prev => (prev.has(profileName) ? prev : new Set([...prev, profileName])))
    }
  }, [resourceMap])

  function getProfileNav(profileName: string): ProfileNavState {
    return navByProfile[profileName] ?? defaultNavState()
  }

  function updateProfileNav(profileName: string, updater: (prev: ProfileNavState) => ProfileNavState) {
    setNavByProfile(prev => {
      const cur = prev[profileName] ?? defaultNavState()
      const next = { ...prev, [profileName]: updater(cur) }
      prefsSet(NAV_STORAGE_KEY, JSON.stringify(next))
      return next
    })
  }

  function deleteGroupMessage(groupName: string): string {
    const clusters = profiles.filter(p => p.group === groupName)
    if (clusters.length === 0) {
      return `Delete group "${groupName}"?`
    }
    const names = clusters.map(p => p.displayName || p.clusterName || p.name).join(', ')
    const n = clusters.length
    return `Deleting group "${groupName}" will permanently remove ${n} cluster${n === 1 ? '' : 's'} from the app (${names}). This cannot be undone.`
  }

  async function confirmDeleteGroup() {
    if (!deleteGroupTarget || deleteGroupBusy) return
    setDeleteGroupBusy(true)
    setDeleteGroupError('')
    try {
      await onDeleteGroup(deleteGroupTarget)
      setDeleteGroupTarget(null)
    } catch (e) {
      setDeleteGroupError(e instanceof Error ? e.message : 'Failed to delete group')
    } finally {
      setDeleteGroupBusy(false)
    }
  }

  useEffect(() => {
    if (!selectedProfile) return
    if (userCollapsedRef.current.has(selectedProfile)) return
    const p = profiles.find(pr => pr.name === selectedProfile)
    const wasConnected = prevConnectedRef.current[selectedProfile]
    const isConnected = !!p?.connected
    prevConnectedRef.current[selectedProfile] = isConnected
    // Expand only when cluster newly becomes connected — not on every poll or manual collapse
    if (isConnected && !wasConnected) {
      setExpanded(prev => new Set([...prev, selectedProfile]))
    }
  }, [selectedProfile, profiles])

  function blurSidebarFocus() {
    requestAnimationFrame(() => {
      const ae = document.activeElement
      if (ae instanceof HTMLElement) ae.blur()
    })
  }

  function handleClusterClick(profile: Profile) {
    const name = profile.name
    setFocusedGroup(null)
    if (profile.connected && selectedProfile === name && expanded.has(name)) {
      userCollapsedRef.current.add(name)
      setExpanded(prev => { const n = new Set(prev); n.delete(name); return n })
      blurSidebarFocus()
      return
    }
    userCollapsedRef.current.delete(name)
    onSelectCluster(name)
    if (profile.connected) {
      setExpanded(prev => new Set([...prev, name]))
    }
    blurSidebarFocus()
  }

  function toggleCategory(profileName: string, catId: string) {
    updateProfileNav(profileName, nav => {
      const cats = new Set(nav.collapsedCats)
      if (cats.has(catId)) cats.delete(catId)
      else cats.add(catId)
      return { ...nav, collapsedCats: [...cats] }
    })
  }

  function toggleGroup(groupName: string) {
    setCollapsedGroups(prev => {
      const n = new Set(prev)
      if (n.has(groupName)) { n.delete(groupName) } else { n.add(groupName) }
      return n
    })
  }

  function toggleGroupActions(groupName: string) {
    setFocusedCluster(null)
    setFocusedGroup(prev => (prev === groupName ? null : groupName))
  }

  function toggleClusterActions(profileName: string) {
    setFocusedGroup(null)
    setFocusedCluster(prev => (prev === profileName ? null : profileName))
  }

  function selectResource(profileName: string, r: Resource) {
    setFocusedGroup(null)
    setFocusedCluster(null)
    onSelectCluster(profileName)
    onSelectResource(profileName, r)
    if (r === 'portforwards') {
      updateProfileNav(profileName, nav => ({
        ...nav,
        collapsedCats: nav.collapsedCats.filter(id => id !== 'network'),
      }))
      setExpanded(prev => new Set([...prev, profileName]))
    }
    // iPad/WebKit can keep :hover after tap, which overrides .active styles.
    blurSidebarFocus()
  }

  function toggleCrdGroup(profileName: string, group: string) {
    updateProfileNav(profileName, nav => {
      const groups = new Set(nav.expandedCrdGroups)
      if (groups.has(group)) groups.delete(group)
      else groups.add(group)
      return { ...nav, expandedCrdGroups: [...groups] }
    })
  }

  function loadCrdGroups(profileName: string, force = false) {
    const status = crdStatus[profileName]
    if (!force && (status === 'loading' || status === 'ready')) return
    setCrdStatus(s => ({ ...s, [profileName]: 'loading' }))
    void api.listCRDGroups(profileName)
      .then(r => {
        setCrdByProfile(prev => ({ ...prev, [profileName]: r.groups }))
        setCrdStatus(s => ({ ...s, [profileName]: 'ready' }))
      })
      .catch(() => {
        setCrdStatus(s => ({ ...s, [profileName]: 'error' }))
      })
  }

  function toggleCrdSection(profileName: string) {
    const opening = !getProfileNav(profileName).crdSectionOpen
    updateProfileNav(profileName, nav => ({ ...nav, crdSectionOpen: !nav.crdSectionOpen }))
    if (opening) loadCrdGroups(profileName)
  }

  // If Custom Resources was left open, fetch when the cluster tree is expanded.
  useEffect(() => {
    for (const name of expanded) {
      const p = profiles.find(pr => pr.name === name)
      if (!p?.connected) continue
      if (getProfileNav(name).crdSectionOpen) loadCrdGroups(name)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to expand/connect
  }, [expanded, profiles])

  function startRename(group: string) {
    setRenamingGroup(group)
    setRenameValue(group)
  }

  function commitRename() {
    if (renamingGroup && renameValue.trim() && renameValue.trim() !== renamingGroup) {
      onRenameGroup(renamingGroup, renameValue.trim())
    }
    setRenamingGroup(null)
  }

  function startClusterRename(p: Profile) {
    setFocusedCluster(null)
    setRenamingCluster(p.name)
    setClusterRenameValue(p.displayName || p.clusterName || p.name)
  }

  async function commitClusterRename(p: Profile) {
    if (clusterRenameCancelRef.current) {
      clusterRenameCancelRef.current = false
      return
    }
    if (renamingCluster !== p.name) return
    const next = clusterRenameValue.trim()
    setRenamingCluster(null)
    const current = p.displayName || p.clusterName || p.name
    if (next === current) return
    await onRenameProfile(p.name, next)
  }

  function confirmAddGroup(name: string) {
    onCreateGroup(name)
    setAddingGroup(false)
  }

  function openClusterDropdown(e: React.MouseEvent, profileName: string) {
    e.stopPropagation()
    const rect = fixedRect(e.currentTarget as HTMLElement)
    setDropdownPos({ x: rect.right + 4, y: rect.top })
    setOpenDropdown(profileName)
  }

  function clusterTreeProps(p: Profile) {
    return {
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
      nav: getProfileNav(p.name),
      crdByProfile,
      crdStatus,
      pfActiveByProfile,
      onClusterClick: handleClusterClick,
      onToggleClusterActions: toggleClusterActions,
      onStartClusterRename: startClusterRename,
      onCommitClusterRename: commitClusterRename,
      onOpenClusterDropdown: openClusterDropdown,
      onSelectResource: selectResource,
      onToggleCategory: toggleCategory,
      onToggleCrdSection: toggleCrdSection,
      onToggleCrdGroup: toggleCrdGroup,
      onLoadCrdGroups: loadCrdGroups,
      onSetRenamingCluster: setRenamingCluster,
    }
  }

  const grouped = groups.map(g => ({
    name: g,
    profiles: profiles.filter(p => p.group === g),
  }))
  const ungrouped = profiles.filter(p => !p.group || !groups.includes(p.group))
  const dropdownProfile = profiles.find(p => p.name === openDropdown) ?? null

  return (
    <aside className="sidebar" style={{ width: sidebarWidth, minWidth: sidebarWidth }}>
      <div className="sidebar-content">
      <div className="sidebar-clusters">
        {profiles.length === 0 && (
          <div className="sidebar-empty">
            <EmptyState
              compact
              title="No clusters yet"
              hint="Import a kubeconfig or cloud account from Manage."
              action={{ label: 'Manage', onClick: onManage }}
            />
          </div>
        )}

        {/* Named groups */}
        {grouped.map(({ name, profiles: gProfiles }) => {
          const isCollapsed = collapsedGroups.has(name)
          const isRenaming = renamingGroup === name
          const showGroupActions = focusedGroup === name || isRenaming
          return (
            <div key={name} className="sg-section">
              <div className={`sg-header${showGroupActions ? ' sg-header-active' : ''}`}>
                <button className="sg-collapse-btn" onClick={() => toggleGroup(name)}>
                  {isCollapsed ? <FolderOpen size={11} /> : <Folder size={11} />}
                </button>
                {isRenaming ? (
                  <input
                    className="sg-rename-input"
                    value={renameValue}
                    autoFocus
                    onChange={e => setRenameValue(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={e => {
                      if (e.key === 'Enter') commitRename()
                      if (e.key === 'Escape') setRenamingGroup(null)
                    }}
                  />
                ) : (
                  <span className="sg-name" onClick={() => toggleGroup(name)}>
                    {name}
                  </span>
                )}
                <div className="sg-header-actions">
                  <span className="sg-count">{gProfiles.length}</span>
                  <div className="sg-header-action-btns">
                    <button
                      type="button"
                      className="sg-more-btn"
                      aria-label="Group actions"
                      onClick={e => { e.stopPropagation(); toggleGroupActions(name) }}
                    >
                      <MoreHorizontal size={14} />
                    </button>
                    <button className="sg-rename-btn" onClick={e => { e.stopPropagation(); startRename(name) }} title="Rename"><Pencil size={11} /></button>
                    <button className="sg-delete-btn" onClick={e => { e.stopPropagation(); setDeleteGroupError(''); setDeleteGroupTarget(name) }} title="Delete group"><X size={11} /></button>
                  </div>
                </div>
              </div>
              {!isCollapsed && gProfiles.map(p => (
                <ClusterTree key={p.name} {...clusterTreeProps(p)} />
              ))}
            </div>
          )
        })}

        {/* Ungrouped clusters */}
        {ungrouped.length > 0 && (
          <div className={groups.length > 0 ? 'sg-ungrouped' : ''}>
            {groups.length > 0 && ungrouped.length > 0 && (
              <div className="sg-ungrouped-label">Other</div>
            )}
            {ungrouped.map(p => (
              <ClusterTree key={p.name} {...clusterTreeProps(p)} />
            ))}
          </div>
        )}

        {/* Add group */}
        <button className="sg-add-btn" onClick={() => setAddingGroup(true)} data-testid="new-group">
          <Plus size={12} /> New Group
        </button>
      </div>

      <div className="sidebar-footer">
        <button
          className={`sidebar-manage-btn ${managing ? 'active' : ''}`}
          onClick={onManage}
        >
          <Settings2 size={13} />
          Manage Clusters
        </button>
      </div>
      </div>

      <div className="sidebar-resize-handle" onMouseDown={onResizeStart} onTouchStart={onResizeTouchStart} />

      {/* Group assignment dropdown portal */}
      {openDropdown && dropdownProfile && createPortal(
        <div style={{ position: 'fixed', left: dropdownPos.x, top: dropdownPos.y, zIndex: 9999 }}>
          <GroupDropdown
            profile={dropdownProfile}
            groups={groups}
            onAssign={g => { onSetProfileGroup(dropdownProfile.name, g); setOpenDropdown(null) }}
            onCreateGroup={onCreateGroup}
            onClose={() => setOpenDropdown(null)}
          />
        </div>,
        document.body
      )}

      {addingGroup && (
        <NewGroupDialog
          onConfirm={confirmAddGroup}
          onCancel={() => setAddingGroup(false)}
        />
      )}

      {deleteGroupTarget && (
        <ConfirmDialog
          title="Delete group"
          message={deleteGroupMessage(deleteGroupTarget)}
          confirmLabel={deleteGroupBusy ? 'Deleting…' : 'Delete group'}
          error={deleteGroupError}
          onConfirm={confirmDeleteGroup}
          onCancel={() => { if (!deleteGroupBusy) { setDeleteGroupTarget(null); setDeleteGroupError('') } }}
        />
      )}
    </aside>
  )
}
