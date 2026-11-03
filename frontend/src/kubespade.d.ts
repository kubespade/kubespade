export {}

declare global {
  interface Window {
    kubespade?: {
      getPathForFile(file: File): string | null
      app?: {
        checkUpdate(): Promise<{
          current: string
          latest: string
          updateAvailable: boolean
          releaseUrl?: string
          downloadUrl?: string
          releaseNotes?: string
          error?: string
        }>
        /** Re-open the floating update window (ignores Later dismiss for this call). */
        showUpdatePopup?(info?: {
          current: string
          latest: string
          updateAvailable: boolean
          releaseUrl?: string
          downloadUrl?: string
          releaseNotes?: string
          error?: string
        }): Promise<{
          current: string
          latest: string
          updateAvailable: boolean
          releaseUrl?: string
          downloadUrl?: string
          releaseNotes?: string
          error?: string
        }>
        getWindowChrome?(): Promise<{
          platform: string
          customTitleBar: boolean
          overlay: boolean
          hiddenInset: boolean
        }>
        setTitleTheme?(dark: boolean): Promise<{ ok: boolean }>
      }
      dialog?: {
        openLocalPaths?(opts?: {
          title?: string
          files?: boolean
          directories?: boolean
          multi?: boolean
        }): Promise<{ canceled: boolean; paths: string[] }>
        saveLocalPath?(opts?: {
          title?: string
          defaultPath?: string
        }): Promise<{ canceled: boolean; path: string | null }>
        pickLocalDirectory?(opts?: {
          title?: string
          defaultPath?: string
        }): Promise<{ canceled: boolean; path: string | null }>
      }
      windowControls?: {
        minimize(): Promise<{ ok: boolean }>
        maximizeToggle(): Promise<{ maximized: boolean }>
        close(): Promise<{ ok: boolean }>
        isMaximized(): Promise<{ maximized: boolean }>
        onMaximized(cb: (maximized: boolean) => void): () => void
      }
      clipboard?: {
        readText(): string
        writeText(text: string): void
      }
      ai?: {
        detect(): Promise<{
          agents: { id: string; name: string; path: string; mcp: string }[]
          platform: string
        }>
        start(opts?: { cols?: number; rows?: number; clientId?: string }): Promise<{
          ok: boolean
          needsChoice?: boolean
          error?: string
          clusterCount?: number
          clusters?: { context: string; profile: string; label: string }[]
          workspace?: string
          agent?: { id: string; name: string; path: string; mcp: string }
          detect?: {
            agents: { id: string; name: string; path: string; mcp: string }[]
            platform: string
          }
        }>
        input(data: string): Promise<boolean>
        resize(cols: number, rows: number): Promise<boolean>
        stop(): Promise<{ ok: boolean }>
        respondApproval(payload: { id: string; approved: boolean; message?: string }): Promise<{ ok: boolean }>
        onOutput(cb: (data: string) => void): () => void
        onExit(cb: (info: { exitCode?: number; signal?: number }) => void): () => void
        onApprovalNeeded?(cb: (info: {
          id: string
          tool: string
          summary: string
          detail: string
        }) => void): () => void
      }
    }
  }
}
