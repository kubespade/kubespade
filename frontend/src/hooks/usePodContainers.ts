import { useEffect, useState } from 'react'
import { api } from '../api/client'

export interface PodContainerList {
  init: string[]
  containers: string[]
  current: string
  running?: string[]
}

/** Preferred running container: explicit → API current → first running. */
export function pickPreferredContainer(
  list: PodContainerList,
  preferred?: string,
): string {
  const running = list.running ?? []
  return (
    (preferred && running.includes(preferred) ? preferred : '') ||
    list.current ||
    running[0] ||
    ''
  )
}

export function usePodContainers(
  profile: string,
  podName: string | undefined,
  namespace: string | undefined,
  preferredContainer: string | undefined,
  enabled = true,
) {
  const [containerList, setContainerList] = useState<PodContainerList | null>(null)
  const [activeContainer, setActiveContainer] = useState(preferredContainer ?? '')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!enabled || !podName) return
    let cancelled = false
    setError('')
    api.getPodContainers(profile, podName, namespace)
      .then(data => {
        if (cancelled) return
        if (!Array.isArray(data.containers) || !Array.isArray(data.init)) {
          throw new Error('Invalid container list')
        }
        const list: PodContainerList = {
          init: data.init,
          containers: data.containers,
          current: data.current || '',
          running: Array.isArray(data.running) ? data.running : data.containers,
        }
        setContainerList(list)
        const next = pickPreferredContainer(list, preferredContainer)
        if (next) setActiveContainer(next)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : 'Failed to load containers')
      })
    return () => { cancelled = true }
  }, [profile, podName, namespace, preferredContainer, enabled])

  return {
    containerList,
    activeContainer,
    setActiveContainer,
    error,
    setError,
  }
}
