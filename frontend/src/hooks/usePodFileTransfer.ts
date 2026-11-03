import { useCallback, useRef, useState, type DragEvent } from 'react'
import { api } from '../api/client'
import { remoteBasename } from '../lib/execCwd'

/** Resolve desktop file paths from a browser FileList / drop. */
export function localPathsFromFiles(files: Iterable<File>): string[] {
  const paths: string[] = []
  for (const f of files) {
    const p = window.kubespade?.getPathForFile?.(f)
    if (p) paths.push(p)
  }
  return paths
}

export type PickPullResult =
  | { ok: true; path: string }
  | { ok: false; reason: 'canceled' | 'unavailable' }

/** Native save / folder pick for pod → local pull. */
export async function pickLocalPullPath(
  kind: 'file' | 'dir',
  defaultName: string,
): Promise<PickPullResult> {
  const dlg = window.kubespade?.dialog
  if (!dlg?.saveLocalPath || !dlg.pickLocalDirectory) {
    return { ok: false, reason: 'unavailable' }
  }
  if (kind === 'file') {
    const saved = await dlg.saveLocalPath({ title: 'Save from pod', defaultPath: defaultName })
    if (saved.canceled || !saved.path) return { ok: false, reason: 'canceled' }
    return { ok: true, path: saved.path }
  }
  const picked = await dlg.pickLocalDirectory({ title: 'Save folder from pod' })
  if (picked.canceled || !picked.path) return { ok: false, reason: 'canceled' }
  return { ok: true, path: picked.path }
}

type TransferFnResult = 'done' | 'canceled' | void

type Options = {
  profile: string
  podName: string | undefined
  namespace?: string
  getContainer: () => string
  getRemoteDir: () => string
  /** Called after a successful push/pull (e.g. refresh file list). */
  onAfterSuccess?: () => void | Promise<void>
}

/**
 * Shared pod file push/pull/drop busy state for Exec and Files panels.
 */
export function usePodFileTransfer({
  profile,
  podName,
  namespace,
  getContainer,
  getRemoteDir,
  onAfterSuccess,
}: Options) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const busyRef = useRef(false)
  busyRef.current = busy
  const onAfterSuccessRef = useRef(onAfterSuccess)
  onAfterSuccessRef.current = onAfterSuccess

  const runTransfer = useCallback(async (label: string, fn: () => Promise<TransferFnResult>) => {
    if (busyRef.current) return
    setBusy(true)
    setMessage(label)
    setError('')
    try {
      const result = await fn()
      if (result === 'canceled') {
        setMessage('')
        return
      }
      setMessage('Done')
      setTimeout(() => setMessage(''), 1600)
      if (onAfterSuccessRef.current) await onAfterSuccessRef.current()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Transfer failed')
      setMessage('')
    } finally {
      setBusy(false)
    }
  }, [])

  const pushLocalPaths = useCallback(async (localPaths: string[]) => {
    const container = getContainer()
    if (!podName || !container || !localPaths.length) return
    const remoteDir = getRemoteDir()
    await runTransfer(
      localPaths.length === 1 ? 'Pushing…' : `Pushing ${localPaths.length}…`,
      async () => {
        for (const localPath of localPaths) {
          await api.pushPodFile(profile, podName, {
            namespace,
            container,
            remotePath: remoteDir,
            localPath,
          })
        }
        return 'done'
      },
    )
  }, [profile, podName, namespace, getContainer, getRemoteDir, runTransfer])

  const openPushDialog = useCallback(async (titleDir?: string) => {
    if (busyRef.current) return
    const dlg = window.kubespade?.dialog
    if (!dlg?.openLocalPaths) {
      setError('Native dialogs unavailable')
      return
    }
    const dir = titleDir ?? getRemoteDir()
    const picked = await dlg.openLocalPaths({
      title: `Upload into ${dir}`,
      files: true,
      directories: true,
      multi: true,
    })
    if (picked.canceled || !picked.paths.length) return
    await pushLocalPaths(picked.paths)
  }, [getRemoteDir, pushLocalPaths])

  /**
   * Dialog → pull. When `holdBusyDuringDialog`, busy is set before the save picker
   * (Exec panel); otherwise busy starts only when the transfer begins (Files panel).
   */
  const pullRemotePath = useCallback(async (
    remotePath: string,
    kind: 'file' | 'dir',
    opts?: { defaultName?: string; holdBusyDuringDialog?: boolean },
  ) => {
    const container = getContainer()
    if (!podName || !container || busyRef.current) return
    const defaultName = opts?.defaultName || remoteBasename(remotePath)
    const hold = !!opts?.holdBusyDuringDialog

    if (hold) {
      setBusy(true)
      setMessage('')
      setError('')
    }

    try {
      const picked = await pickLocalPullPath(kind, defaultName)
      if (!picked.ok) {
        if (picked.reason === 'unavailable') setError('Native dialogs unavailable')
        return
      }
      const finish = async () => {
        await api.pullPodFile(profile, podName, {
          namespace,
          container,
          remotePath,
          localPath: picked.path,
        })
        return 'done' as const
      }
      if (hold) {
        setMessage('Pulling…')
        await finish()
        setMessage('Done')
        setTimeout(() => setMessage(''), 1600)
        if (onAfterSuccessRef.current) await onAfterSuccessRef.current()
      } else {
        await runTransfer('Pulling…', finish)
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Transfer failed')
      setMessage('')
    } finally {
      if (hold) setBusy(false)
    }
  }, [profile, podName, namespace, getContainer, runTransfer])

  const handleFileDrop = useCallback(async (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (busyRef.current) return { dropped: false as const }
    const paths = localPathsFromFiles(e.dataTransfer.files || [])
    if (!paths.length) {
      setError('Drop only works for local files in the desktop app')
      return { dropped: false as const }
    }
    await pushLocalPaths(paths)
    return { dropped: true as const }
  }, [pushLocalPaths])

  return {
    busy,
    message,
    error,
    setError,
    setBusy,
    setMessage,
    runTransfer,
    pushLocalPaths,
    openPushDialog,
    pullRemotePath,
    handleFileDrop,
  }
}
