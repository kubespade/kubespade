import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from './api/client'
import { disableDebug, enableDebug } from './debug'
import { Sidebar } from './components/Sidebar'
import { ConnectOverlay } from './components/ConnectOverlay'
import { MfaDialogHost } from './components/MfaDialog'
import { ClusterView } from './pages/ClusterView'
import { PageErrorBoundary } from './components/PageErrorBoundary'
import { HomePage } from './pages/HomePage'
import { ManagePage, AddClusterModal } from './pages/ManagePage'
import { SettingsPanel } from './pages/SettingsPage'
import {
  checkAppUpdate,
  showUpdatePopup,
  type AppUpdateInfo,
} from './lib/appUpdate'
import { OPEN_SETTINGS_EVENT } from './lib/openSettings'
import { AppTitleBar } from './components/AppTitleBar'
import { CommandPaletteShell } from './components/CommandPaletteShell'
import { ClusterSearchResults } from './components/ClusterSearchResults'
import { AiClientPicker, type DetectedAiAgent } from './components/AiClientPicker'
import { WorkbenchDock } from './components/WorkbenchDock'
import { ActivePortForwardsHost } from './components/ActivePortForwardsHost'
import { useNavStack, type AppView } from './hooks/useNavStack'
import { useProfileConnection } from './hooks/useProfileConnection'
import {
  AI_CLIENT_PREF_KEY,
  parseAiClientId,
  type AiClientId,
} from './lib/aiClient'
import {
  WorkbenchProvider,
  type WorkbenchExecRequest,
  type WorkbenchLogsRequest,
  type WorkbenchFilesRequest,
} from './lib/workbenchContext'
import type { ExecTarget } from './components/ExecPanel'
import type { LogsTarget } from './components/PodLogsView'
import type { FilesTarget } from './components/PodFilesPanel'
import { prefsGet, prefsRemove, prefsSet } from './lib/persistentStore'
import { pruneRecentProfiles, pushRecentProfile, readRecentProfiles } from './lib/recentProfiles'
import { applyUiDensity, parseUiDensity, type UiDensity } from './lib/uiDensity'
import {
  applyUiTheme,
  parseUiTheme,
  resolveIsDark,
  UI_THEME_STORAGE_KEY,
  type UiTheme,
} from './lib/uiTheme'
import type { Resource } from './lib/resourceKinds'
import { RESOURCE_LABELS } from './lib/resourceTableConfig'
import type { ClusterSearchHit } from './lib/clusterSearch'
import type { Profile } from './types'

export type { Resource } from './lib/resourceKinds'

function readSavedView(): AppView {
  const v = prefsGet('app-view')
  if (v === 'cluster' || v === 'home') return v
  return 'home'
}

function readInitialView(): AppView {
  // Prefer last screen; restore effect confirms the session is still live.
  return readSavedView()
}

export default function App() {
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [selectedProfile, setSelectedProfile] = useState<string | null>(
    () => prefsGet('selected-profile')
  )
  const [resourceMap, setResourceMap] = useState<Record<string, Resource>>(() => {
    try {
      const map = JSON.parse(prefsGet('resource-map') ?? '{}') as Record<string, Resource>
      if (Object.keys(map).length > 0) return map
      const legacy = prefsGet('selected-resource') as Resource | null
      const profile = prefsGet('selected-profile')
      if (legacy && profile) return { [profile]: legacy }
    } catch { /* ignore */ }
    return {}
  })
  const [view, setView] = useState<AppView>(readInitialView)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)
  const [preferredAiClient, setPreferredAiClient] = useState<AiClientId | null>(
    () => parseAiClientId(prefsGet(AI_CLIENT_PREF_KEY)),
  )
  const [aiPickerOpen, setAiPickerOpen] = useState(false)
  const [aiPickerAgents, setAiPickerAgents] = useState<DetectedAiAgent[]>([])
  const [aiPickerForSettings, setAiPickerForSettings] = useState(false)
  const [execRequest, setExecRequest] = useState<WorkbenchExecRequest | null>(null)
  const [logsRequest, setLogsRequest] = useState<WorkbenchLogsRequest | null>(null)
  const [filesRequest, setFilesRequest] = useState<WorkbenchFilesRequest | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [appUpdate, setAppUpdate] = useState<AppUpdateInfo | null>(null)
  const [customTitleBar, setCustomTitleBar] = useState(false)
  const [overlayTitleBar, setOverlayTitleBar] = useState(false)
  const [cmdPaletteOpen, setCmdPaletteOpen] = useState(false)
  const [clusterSearch, setClusterSearch] = useState<{
    query: string
    hits: ClusterSearchHit[]
  } | null>(null)
  const [groups, setGroups] = useState<string[]>([])
  const [nsMap, setNsMap] = useState<Record<string, string[] | null>>(() => {
    try { return JSON.parse(prefsGet('ns-map') ?? '{}') } catch { return {} }
  })
  const [uiScale, setUIScale] = useState<number>(() => {
    const s = prefsGet('ui-scale')
    return s ? Number(s) : 1
  })
  const [uiDensity, setUIDensity] = useState<UiDensity>(() => parseUiDensity(prefsGet('ui-density')))
  const [uiTheme, setUITheme] = useState<UiTheme>(() => parseUiTheme(prefsGet(UI_THEME_STORAGE_KEY)))
  const [debugEnabled, setDebugEnabled] = useState(false)
  const [recentNames, setRecentNames] = useState<string[]>(() => readRecentProfiles())
  const [pfActiveByProfile, setPfActiveByProfile] = useState<Record<string, number>>({})
  const onPfCountsChange = useCallback((counts: Record<string, number>) => {
    setPfActiveByProfile(counts)
  }, [])

  useEffect(() => {
    function onOpenSettings() { setSettingsOpen(true) }
    window.addEventListener(OPEN_SETTINGS_EVENT, onOpenSettings)
    return () => window.removeEventListener(OPEN_SETTINGS_EVENT, onOpenSettings)
  }, [])

  useEffect(() => {
    let cancelled = false
    void checkAppUpdate().then(info => {
      if (!cancelled && info) setAppUpdate(info)
    })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    document.documentElement.style.setProperty('--ui-zoom', String(uiScale))
    prefsSet('ui-scale', String(uiScale))
  }, [uiScale])

  useEffect(() => {
    applyUiDensity(uiDensity)
    prefsSet('ui-density', uiDensity)
  }, [uiDensity])

  useEffect(() => {
    let cancelled = false
    void window.kubespade?.app?.getWindowChrome?.().then(chrome => {
      if (cancelled || !chrome) return
      document.documentElement.dataset.windowChrome = chrome.platform
      if (chrome.hiddenInset) document.documentElement.dataset.titleBar = 'hidden-inset'
      else if (chrome.overlay) document.documentElement.dataset.titleBar = 'overlay'
      else if (chrome.customTitleBar) document.documentElement.dataset.titleBar = 'custom'
      setCustomTitleBar(!!chrome.customTitleBar)
      setOverlayTitleBar(!!chrome.overlay)
    })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    applyUiTheme(uiTheme)
    prefsSet(UI_THEME_STORAGE_KEY, uiTheme)
    void window.kubespade?.app?.setTitleTheme?.(resolveIsDark(uiTheme))
  }, [uiTheme])

  useEffect(() => {
    if (uiTheme !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => {
      applyUiTheme('system')
      void window.kubespade?.app?.setTitleTheme?.(resolveIsDark('system'))
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [uiTheme])

  useEffect(() => {
    if (selectedProfile) prefsSet('selected-profile', selectedProfile)
    else prefsRemove('selected-profile')
  }, [selectedProfile])

  useEffect(() => {
    prefsSet('resource-map', JSON.stringify(resourceMap))
  }, [resourceMap])

  useEffect(() => {
    if (view !== 'manage') prefsSet('app-view', view)
  }, [view])

  useEffect(() => {
    prefsSet('ns-map', JSON.stringify(nsMap))
  }, [nsMap])

  const loadProfiles = useCallback(async () => {
    try {
      const [{ profiles }, loadedGroups] = await Promise.all([
        api.listProfiles(),
        api.listGroups(),
      ])
      const sorted = [...profiles].sort((a, b) => {
        const la = (a.displayName || a.clusterName || a.name).toLowerCase()
        const lb = (b.displayName || b.clusterName || b.name).toLowerCase()
        return la.localeCompare(lb)
      })
      setProfiles(sorted)
      setGroups(loadedGroups)
      const valid = new Set(sorted.map(p => p.name))
      let recent = pruneRecentProfiles(valid)
      const saved = prefsGet('selected-profile')
      if (recent.length === 0 && saved && valid.has(saved)) {
        recent = pushRecentProfile(saved)
      }
      setRecentNames(recent)
      setSelectedProfile(prev => {
        if (prev && sorted.some(p => p.name === prev)) return prev
        return null
      })
    } catch {}
  }, [])

  useEffect(() => {
    loadProfiles()
    const interval = setInterval(loadProfiles, 10_000)
    return () => clearInterval(interval)
  }, [loadProfiles])

  const activeProfile = selectedProfile ? profiles.find(p => p.name === selectedProfile) : undefined
  const selectedResource = selectedProfile ? (resourceMap[selectedProfile] ?? 'overview') : 'overview'

  const toggleCmdPalette = useCallback(() => {
    setCmdPaletteOpen(o => !o)
  }, [])

  const {
    connectingProfile,
    connectOverlay,
    setConnectOverlay,
    clearReconnectAttempt,
    handleSelectCluster,
    handleConnected,
  } = useProfileConnection({
    profiles,
    loadProfiles,
    view,
    setView,
    selectedProfile,
    setSelectedProfile,
    setRecentNames,
  })

  const { navStack, navIndex, goNavBack, goNavForward } = useNavStack({
    view,
    selectedProfile,
    selectedResource,
    setView,
    setSelectedProfile,
    setResourceMap,
    onToggleCmdPalette: toggleCmdPalette,
  })

  function handleSelectResource(profileName: string, resource: Resource) {
    setSelectedProfile(profileName)
    setResourceMap(prev => ({ ...prev, [profileName]: resource }))
  }

  async function handleOpenPortForwards(profileName: string) {
    handleSelectResource(profileName, 'portforwards')
    await handleSelectCluster(profileName)
  }

  function handleNsChange(profile: string, ns: string[] | null) {
    setNsMap(prev => ({ ...prev, [profile]: ns } as Record<string, string[] | null>))
  }

  async function handleCreateGroup(name: string): Promise<string[]> {
    const updated = await api.createGroup(name)
    setGroups(updated)
    return updated
  }

  async function handleDeleteGroup(name: string) {
    const { groups: updated, removedProfiles } = await api.deleteGroup(name)
    setGroups(updated)
    if (selectedProfile && removedProfiles.includes(selectedProfile)) {
      setSelectedProfile(null)
      setView('home')
    }
    await loadProfiles()
  }

  async function handleRenameGroup(oldName: string, newName: string) {
    const updated = await api.renameGroup(oldName, newName)
    setGroups(updated)
    await loadProfiles()
  }

  async function handleSetProfileGroup(profileName: string, group: string) {
    await api.setProfileGroup(profileName, group)
    await loadProfiles()
  }

  async function handleRenameProfile(profileName: string, displayName: string) {
    await api.setProfileDisplayName(profileName, displayName)
    await loadProfiles()
  }

  async function handleDebugChange(enable: boolean) {
    if (enable) {
      await api.setDebugEnabled(true)
      enableDebug()
      setDebugEnabled(true)
    } else {
      const frontendLogs = disableDebug()
      const backendLogs = await api.getDebugLogs()
      await api.setDebugEnabled(false)
      setDebugEnabled(false)

      const combined = [
        '=== Backend Logs ===',
        backendLogs || '(empty)',
        '',
        '=== Frontend Logs ===',
        frontendLogs || '(empty)',
      ].join('\n')

      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
      const blob = new Blob([combined], { type: 'text/plain' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `k8s-client-debug-${stamp}.log`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    }
  }

  const connectedCount = profiles.filter(p => p.connected).length
  const overlayProfile = connectOverlay
    ? profiles.find(p => p.name === connectOverlay.profileName)
    : undefined
  const aiAvailable = typeof window !== 'undefined' && !!window.kubespade?.ai

  async function openAiClientPicker(fromSettings: boolean) {
    const detected = await window.kubespade?.ai?.detect?.()
    setAiPickerAgents(detected?.agents ?? [])
    setAiPickerForSettings(fromSettings)
    setAiPickerOpen(true)
  }

  const handleAiClick = useCallback(() => {
    setAiOpen(prev => {
      if (prev) return false
      return true
    })
  }, [])

  // Preferred-client gate: first click may open picker instead of the dock.
  function onSidebarAiClick() {
    if (aiOpen) {
      setAiOpen(false)
      return
    }
    if (!preferredAiClient) {
      void openAiClientPicker(false)
      return
    }
    setAiOpen(true)
  }

  function handleAiClientPick(id: AiClientId) {
    prefsSet(AI_CLIENT_PREF_KEY, id)
    setPreferredAiClient(id)
    setAiPickerOpen(false)
    if (!aiPickerForSettings) {
      setAiOpen(true)
    }
  }

  const openWorkbenchExec = useCallback((profile: string, target: ExecTarget) => {
    setExecRequest({ seq: Date.now(), profile, target })
  }, [])
  const openWorkbenchLogs = useCallback((profile: string, target: LogsTarget) => {
    setLogsRequest({ seq: Date.now(), profile, target })
  }, [])
  const openWorkbenchFiles = useCallback((profile: string, target: FilesTarget) => {
    setFilesRequest({ seq: Date.now(), profile, target })
  }, [])
  const closeAi = useCallback(() => setAiOpen(false), [])
  const openAi = useCallback(() => setAiOpen(true), [])
  const closeCmdPalette = useCallback(() => setCmdPaletteOpen(false), [])
  const openCmdPalette = useCallback(() => setCmdPaletteOpen(true), [])

  const locationLabel = useMemo(() => {
    if (view === 'home') return 'Welcome'
    if (view === 'manage') return 'Manage'
    if (view === 'cluster') {
      return RESOURCE_LABELS[selectedResource] ?? selectedResource
    }
    return 'Welcome'
  }, [view, selectedResource])

  const workbenchApi = useMemo(() => ({
    openExec: openWorkbenchExec,
    openLogs: openWorkbenchLogs,
    openFiles: openWorkbenchFiles,
    openAi,
    closeAi,
    toggleAi: handleAiClick,
    aiOpen,
  }), [openWorkbenchExec, openWorkbenchLogs, openWorkbenchFiles, openAi, closeAi, handleAiClick, aiOpen])

  return (
    <WorkbenchProvider value={workbenchApi}>
    <>
    <div className="app-shell">
      <AppTitleBar
        locationLabel={locationLabel}
        canGoBack={navIndex > 0}
        canGoForward={navIndex >= 0 && navIndex < navStack.length - 1}
        onBack={goNavBack}
        onForward={goNavForward}
        onSearch={openCmdPalette}
        customTitleBar={customTitleBar}
        overlayTitleBar={overlayTitleBar}
        settingsOpen={settingsOpen}
        aiOpen={aiOpen}
        aiAvailable={aiAvailable}
        preferredAiClient={preferredAiClient}
        updateAvailableVersion={appUpdate?.updateAvailable ? appUpdate.latest : null}
        onShowUpdate={() => {
          void showUpdatePopup(appUpdate).then(info => {
            if (info) setAppUpdate(info)
          })
        }}
        onHome={() => setView('home')}
        onSettings={() => setSettingsOpen(o => !o)}
        onAi={aiAvailable ? onSidebarAiClick : undefined}
      />
      <div className="app-layout">
      <Sidebar
        profiles={profiles}
        selectedProfile={selectedProfile}
        activeResource={selectedResource}
        clusterNavActive={view === 'cluster'}
        resourceMap={resourceMap}
        groups={groups}
        onSelectCluster={handleSelectCluster}
        connectingProfile={connectingProfile}
        onSelectResource={handleSelectResource}
        onManage={() => setView('manage')}
        onCreateGroup={handleCreateGroup}
        onDeleteGroup={handleDeleteGroup}
        onRenameGroup={handleRenameGroup}
        onSetProfileGroup={handleSetProfileGroup}
        onRenameProfile={handleRenameProfile}
        managing={view === 'manage'}
        pfActiveByProfile={pfActiveByProfile}
      />

      <div className="app-main">
        {view === 'cluster' && selectedProfile && activeProfile?.connected ? (
          <PageErrorBoundary label="Cluster view">
          <ClusterView
            key={selectedProfile}
            profile={selectedProfile}
            displayName={activeProfile?.displayName || activeProfile?.clusterName || selectedProfile}
            resource={selectedResource}
            selectedNs={nsMap[selectedProfile] ?? null}
            onNsChange={(ns) => handleNsChange(selectedProfile, ns)}
            onSelectResource={(r) => handleSelectResource(selectedProfile, r)}
            onProfilesChanged={() => { void loadProfiles() }}
          />
          </PageErrorBoundary>
        ) : view === 'cluster' && selectedProfile && connectingProfile === selectedProfile ? (
          <div className="res-placeholder">
            Reconnecting to {(activeProfile?.displayName || activeProfile?.clusterName || selectedProfile)}…
          </div>
        ) : view === 'cluster' && selectedProfile && activeProfile && !activeProfile.connected ? (
          <div className="res-placeholder" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
            <span>Disconnected from {(activeProfile.displayName || activeProfile.clusterName || selectedProfile)}</span>
            <button
              type="button"
              className="page-header-btn"
              onClick={() => {
                clearReconnectAttempt()
                void handleSelectCluster(selectedProfile)
              }}
            >
              Reconnect
            </button>
          </div>
        ) : view === 'manage' ? (
          <ManagePage
            profiles={profiles}
            selectedProfile={selectedProfile}
            recentNames={recentNames}
            onConnected={handleConnected}
            onReload={loadProfiles}
            onAdd={() => setShowAdd(true)}
          />
        ) : (
          <HomePage
            profileCount={profiles.length}
            connectedCount={connectedCount}
            onAdd={() => setShowAdd(true)}
          />
        )}
      </div>
      </div>
    </div>

    <CommandPaletteShell
      open={cmdPaletteOpen}
      onClose={closeCmdPalette}
      profile={
        selectedProfile
        ?? profiles.find(p => p.connected)?.name
        ?? null
      }
      connected={
        !!(
          (selectedProfile
            ? profiles.find(p => p.name === selectedProfile)
            : profiles.find(p => p.connected)
          )?.connected
        )
      }
      onOpenKind={(kind) => {
        const profile = selectedProfile
          ?? profiles.find(p => p.connected)?.name
          ?? null
        if (!profile) return
        handleSelectResource(profile, kind)
        setView('cluster')
        const p = profiles.find(pr => pr.name === profile)
        if (p && !p.connected) void handleSelectCluster(profile)
      }}
      onOpenObject={(kind, _name, namespace) => {
        const profile = selectedProfile
          ?? profiles.find(p => p.connected)?.name
          ?? null
        if (!profile) return
        if (namespace) handleNsChange(profile, [namespace])
        else handleNsChange(profile, [])
        handleSelectResource(profile, kind)
        setView('cluster')
        const p = profiles.find(pr => pr.name === profile)
        if (p && !p.connected) void handleSelectCluster(profile)
      }}
      onShowAllResults={(query, hits) => {
        setClusterSearch({ query, hits })
      }}
    />
    <ClusterSearchResults
      open={!!clusterSearch}
      query={clusterSearch?.query ?? ''}
      hits={clusterSearch?.hits ?? []}
      profileLabel={
        activeProfile?.displayName
        || activeProfile?.clusterName
        || selectedProfile
        || undefined
      }
      onClose={() => setClusterSearch(null)}
      onOpenObject={(kind, _name, namespace) => {
        const profile = selectedProfile
          ?? profiles.find(p => p.connected)?.name
          ?? null
        if (!profile) return
        if (namespace) handleNsChange(profile, [namespace])
        else handleNsChange(profile, [])
        handleSelectResource(profile, kind)
        setView('cluster')
      }}
    />

    {showAdd && (
      <AddClusterModal
        profiles={profiles}
        groups={groups}
        onCreateGroup={handleCreateGroup}
        onDone={() => { setShowAdd(false); loadProfiles() }}
        onClose={() => setShowAdd(false)}
      />
    )}

    {connectOverlay && overlayProfile && (
      <ConnectOverlay
        profile={overlayProfile}
        initial={connectOverlay.result}
        onClose={() => {
          clearReconnectAttempt()
          setConnectOverlay(null)
        }}
        onConnected={handleConnected}
      />
    )}

    {settingsOpen && (
      <SettingsPanel
        uiScale={uiScale}
        onScaleChange={setUIScale}
        uiDensity={uiDensity}
        onDensityChange={setUIDensity}
        uiTheme={uiTheme}
        onThemeChange={setUITheme}
        debugEnabled={debugEnabled}
        onDebugChange={handleDebugChange}
        profiles={profiles}
        preferredAiClient={preferredAiClient}
        aiAvailable={aiAvailable}
        onChangeAiClient={() => void openAiClientPicker(true)}
        appUpdate={appUpdate}
        onAppUpdate={setAppUpdate}
        onClose={() => setSettingsOpen(false)}
      />
    )}
    <AiClientPicker
      open={aiPickerOpen}
      agents={aiPickerAgents}
      currentId={preferredAiClient}
      title={aiPickerForSettings ? 'Change AI assistant' : 'Choose your AI assistant'}
      subtitle={aiPickerForSettings
        ? 'This becomes the default for the title-bar AI button. Change it again anytime in Settings.'
        : 'KubeSpade will remember this choice. Change it later in Settings → AI assistant.'}
      onPick={handleAiClientPick}
      onClose={() => setAiPickerOpen(false)}
    />
    <WorkbenchDock
      resourceKey={view === 'cluster' && selectedProfile
        ? `${selectedProfile}/${selectedResource}`
        : view}
      execRequest={execRequest}
      logsRequest={logsRequest}
      filesRequest={filesRequest}
      aiOpen={aiOpen}
      aiClientId={preferredAiClient}
      onAiClose={() => setAiOpen(false)}
    />
    <ActivePortForwardsHost
      profiles={profiles}
      preferredProfile={selectedProfile}
      onOpenPortForwards={profile => { void handleOpenPortForwards(profile) }}
      onCountsChange={onPfCountsChange}
    />
    <MfaDialogHost />
    </>
    </WorkbenchProvider>
  )
}
