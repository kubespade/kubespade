const { contextBridge, webUtils, ipcRenderer, clipboard } = require('electron')

contextBridge.exposeInMainWorld('kubespade', {
  /** Absolute path for a file chosen via <input type="file"> (Electron desktop only). */
  getPathForFile(file) {
    try {
      return webUtils.getPathForFile(file)
    } catch {
      return null
    }
  },

  clipboard: {
    readText: () => {
      try {
        const viaIpc = ipcRenderer.sendSync('clipboard:readText')
        if (typeof viaIpc === 'string' && viaIpc) return viaIpc
      } catch { /* ignore */ }
      try { return clipboard.readText() || '' } catch { return '' }
    },
    writeText: (text) => {
      const s = String(text ?? '')
      try {
        if (ipcRenderer.sendSync('clipboard:writeText', s)) return
      } catch { /* fall through */ }
      try { clipboard.writeText(s) } catch { /* ignore */ }
    },
    hasImage: () => {
      try {
        return !!ipcRenderer.sendSync('clipboard:hasImage')
      } catch { /* ignore */ }
      try { return !clipboard.readImage().isEmpty() } catch { return false }
    },
  },

  app: {
    checkUpdate: () => ipcRenderer.invoke('app:checkUpdate'),
    showUpdatePopup: (info) => ipcRenderer.invoke('app:showUpdatePopup', info || null),
    getWindowChrome: () => ipcRenderer.invoke('app:getWindowChrome'),
    setTitleTheme: (dark) => ipcRenderer.invoke('app:setTitleTheme', { dark: !!dark }),
  },

  dialog: {
    openLocalPaths: (opts) => ipcRenderer.invoke('dialog:openLocalPaths', opts || {}),
    saveLocalPath: (opts) => ipcRenderer.invoke('dialog:saveLocalPath', opts || {}),
    pickLocalDirectory: (opts) => ipcRenderer.invoke('dialog:pickLocalDirectory', opts || {}),
  },

  windowControls: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximizeToggle: () => ipcRenderer.invoke('window:maximizeToggle'),
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
    onMaximized: (cb) => {
      const handler = (_e, maximized) => cb(!!maximized)
      ipcRenderer.on('window:maximized', handler)
      return () => ipcRenderer.removeListener('window:maximized', handler)
    },
  },

  ai: {
    detect: () => ipcRenderer.invoke('ai:detect'),
    start: (opts) => ipcRenderer.invoke('ai:start', opts || {}),
    input: (data) => { ipcRenderer.send('ai:input', data) },
    resize: (cols, rows) => ipcRenderer.invoke('ai:resize', { cols, rows }),
    stop: () => ipcRenderer.invoke('ai:stop'),
    respondApproval: (payload) => ipcRenderer.invoke('ai:approval-respond', payload),
    onOutput: (cb) => {
      const handler = (_e, data) => cb(data)
      ipcRenderer.on('ai:output', handler)
      return () => ipcRenderer.removeListener('ai:output', handler)
    },
    onExit: (cb) => {
      const handler = (_e, info) => cb(info)
      ipcRenderer.on('ai:exit', handler)
      return () => ipcRenderer.removeListener('ai:exit', handler)
    },
    onApprovalNeeded: (cb) => {
      const handler = (_e, info) => cb(info)
      ipcRenderer.on('ai:approval-needed', handler)
      return () => ipcRenderer.removeListener('ai:approval-needed', handler)
    },
  },
})
