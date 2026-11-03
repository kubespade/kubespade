import { createContext, useContext } from 'react'
import type { ExecTarget } from '../components/ExecPanel'
import type { LogsTarget } from '../components/PodLogsView'
import type { FilesTarget } from '../components/PodFilesPanel'

export interface WorkbenchExecRequest {
  seq: number
  profile: string
  target: ExecTarget
}

export interface WorkbenchLogsRequest {
  seq: number
  profile: string
  target: LogsTarget
}

export interface WorkbenchFilesRequest {
  seq: number
  profile: string
  target: FilesTarget
}

export interface WorkbenchApi {
  openExec: (profile: string, target: ExecTarget) => void
  openLogs: (profile: string, target: LogsTarget) => void
  openFiles: (profile: string, target: FilesTarget) => void
  openAi: () => void
  closeAi: () => void
  toggleAi: () => void
  aiOpen: boolean
}

const WorkbenchContext = createContext<WorkbenchApi | null>(null)

export function WorkbenchProvider({
  value,
  children,
}: {
  value: WorkbenchApi
  children: React.ReactNode
}) {
  return <WorkbenchContext.Provider value={value}>{children}</WorkbenchContext.Provider>
}

export function useWorkbench(): WorkbenchApi {
  const ctx = useContext(WorkbenchContext)
  if (!ctx) throw new Error('useWorkbench requires WorkbenchProvider')
  return ctx
}

/** Optional — NodesPage / ClusterView may render outside provider in tests. */
export function useWorkbenchOptional(): WorkbenchApi | null {
  return useContext(WorkbenchContext)
}
