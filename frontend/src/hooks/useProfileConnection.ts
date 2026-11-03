import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { connectProfile, type ConnectResult } from '../lib/connectProfile'
import { pushRecentProfile } from '../lib/recentProfiles'
import { prefsGet } from '../lib/persistentStore'
import type { Profile } from '../types'
import type { AppView } from './useNavStack'

type UseProfileConnectionParams = {
  profiles: Profile[]
  loadProfiles: () => Promise<void>
  view: AppView
  setView: (view: AppView) => void
  selectedProfile: string | null
  setSelectedProfile: (profile: string | null) => void
  setRecentNames: Dispatch<SetStateAction<string[]>>
}

export function useProfileConnection({
  profiles,
  loadProfiles,
  view,
  setView,
  selectedProfile,
  setSelectedProfile,
  setRecentNames,
}: UseProfileConnectionParams) {
  const [connectingProfile, setConnectingProfile] = useState<string | null>(null)
  const [connectOverlay, setConnectOverlay] = useState<{
    profileName: string
    result: ConnectResult
  } | null>(null)
  const didRestoreView = useRef(false)
  /** Avoid looping reconnect while a profile stays disconnected mid-view. */
  const reconnectAttemptRef = useRef<string | null>(null)

  const profilesRef = useRef(profiles)
  profilesRef.current = profiles
  const selectedConnected =
    selectedProfile != null &&
    (profiles.find(pr => pr.name === selectedProfile)?.connected ?? false)

  // Restore last cluster view when a session is still live (cold start + soft reload).
  // Never restore manage. If the session expired, try silent reconnect / MFA overlay.
  useEffect(() => {
    if (didRestoreView.current || profiles.length === 0) return
    didRestoreView.current = true

    const savedView = prefsGet('app-view')
    const savedProfile = prefsGet('selected-profile')
    if (savedView !== 'cluster' || !savedProfile) {
      if (view === 'cluster') setView('home')
      return
    }

    const p = profiles.find(pr => pr.name === savedProfile)
    if (!p) {
      setView('home')
      return
    }

    setSelectedProfile(savedProfile)
    if (p.connected) {
      setView('cluster')
      return
    }

    // One-shot restore — mid-session effect handles retries after idle disconnect.
    reconnectAttemptRef.current = savedProfile
    setConnectingProfile(savedProfile)
    void (async () => {
      try {
        const result = await connectProfile(p)
        if (result.status === 'connected') {
          reconnectAttemptRef.current = null
          await loadProfiles()
          setView('cluster')
        } else if (result.status === 'mfa' || result.status === 'pick-cluster') {
          setConnectOverlay({ profileName: savedProfile, result })
          setView('home')
        } else {
          reconnectAttemptRef.current = null
          setView('home')
        }
      } catch {
        reconnectAttemptRef.current = null
        setView('home')
      } finally {
        setConnectingProfile(prev => (prev === savedProfile ? null : prev))
        if (reconnectAttemptRef.current === savedProfile) reconnectAttemptRef.current = null
      }
    })()
  }, [profiles, loadProfiles, view, setView, setSelectedProfile])

  // Mid-session disconnect: reconnect without cancelling ourselves.
  // Do NOT put connectingProfile in deps — that used to re-run this effect, set
  // cancelled=true, and skip loadProfiles / error handling ("Reconnecting…" forever).
  useEffect(() => {
    if (view !== 'cluster' || !selectedProfile) return
    const profileName = selectedProfile
    const p = profilesRef.current.find(pr => pr.name === profileName)
    if (!p) return
    if (p.connected) {
      reconnectAttemptRef.current = null
      setConnectingProfile(prev => (prev === profileName ? null : prev))
      return
    }
    if (connectOverlay?.profileName === profileName) return
    if (reconnectAttemptRef.current === profileName) return

    let abandoned = false
    reconnectAttemptRef.current = profileName
    setConnectingProfile(profileName)
    void (async () => {
      try {
        const result = await connectProfile(p)
        if (result.status === 'connected') {
          reconnectAttemptRef.current = null
          await loadProfiles()
          return
        }
        if (abandoned) return
        if (result.status === 'mfa' || result.status === 'pick-cluster') {
          setConnectOverlay({ profileName, result })
        } else {
          reconnectAttemptRef.current = null
          setView('home')
        }
      } catch {
        if (!abandoned) {
          reconnectAttemptRef.current = null
          setView('home')
        }
      } finally {
        setConnectingProfile(prev => (prev === profileName ? null : prev))
        if (abandoned && reconnectAttemptRef.current === profileName) {
          reconnectAttemptRef.current = null
        }
      }
    })()
    return () => {
      abandoned = true
    }
  }, [view, selectedProfile, selectedConnected, connectOverlay, loadProfiles, setView])

  const handleSelectCluster = useCallback(async (profileName: string) => {
    setSelectedProfile(profileName)
    setRecentNames(pushRecentProfile(profileName))
    const profile = profiles.find(p => p.name === profileName)
    if (!profile) return

    if (profile.connected) {
      setView('cluster')
      return
    }

    setConnectingProfile(profileName)
    try {
      const result = await connectProfile(profile)
      if (result.status === 'connected') {
        await loadProfiles()
        setView('cluster')
      } else {
        setConnectOverlay({ profileName, result })
      }
    } finally {
      setConnectingProfile(null)
    }
  }, [profiles, loadProfiles, setView, setSelectedProfile, setRecentNames])

  const handleConnected = useCallback((profileName: string) => {
    reconnectAttemptRef.current = null
    setConnectOverlay(null)
    loadProfiles()
    setSelectedProfile(profileName)
    setRecentNames(pushRecentProfile(profileName))
    setView('cluster')
  }, [loadProfiles, setView, setSelectedProfile, setRecentNames])

  const clearReconnectAttempt = useCallback(() => {
    reconnectAttemptRef.current = null
  }, [])

  return {
    connectingProfile,
    connectOverlay,
    setConnectOverlay,
    reconnectAttemptRef,
    clearReconnectAttempt,
    handleSelectCluster,
    handleConnected,
  }
}
