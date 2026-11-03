'use strict'

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('updatePopup', {
  onInfo(cb) {
    const handler = (_e, info) => cb(info)
    ipcRenderer.on('update-popup:info', handler)
    return () => ipcRenderer.removeListener('update-popup:info', handler)
  },
  onTheme(cb) {
    const handler = (_e, theme) => cb(theme)
    ipcRenderer.on('update-popup:theme', handler)
    return () => ipcRenderer.removeListener('update-popup:theme', handler)
  },
  download() {
    return ipcRenderer.invoke('update-popup:download')
  },
  openRelease() {
    return ipcRenderer.invoke('update-popup:openRelease')
  },
  setExpanded(expanded) {
    return ipcRenderer.invoke('update-popup:setExpanded', Boolean(expanded))
  },
  layout(opts) {
    return ipcRenderer.invoke('update-popup:layout', opts || {})
  },
  dismiss() {
    return ipcRenderer.invoke('update-popup:dismiss')
  },
})
