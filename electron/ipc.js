'use strict'

const { dialog, clipboard } = require('electron')
const { checkAppUpdate } = require('./appUpdate')
const { getMainWindow, applyThemeChrome } = require('./windowManager')

function registerAppIpc(app, ipcMain) {
  // Sync clipboard via main process — preload clipboard can silently fail on Windows.
  ipcMain.on('clipboard:writeText', (e, text) => {
    try {
      const s = String(text ?? '')
      clipboard.writeText(s)
      if (process.platform === 'linux') {
        try { clipboard.writeText(s, 'selection') } catch { /* ignore */ }
      }
      e.returnValue = true
    } catch {
      e.returnValue = false
    }
  })
  ipcMain.on('clipboard:readText', (e) => {
    try {
      e.returnValue = clipboard.readText() || ''
    } catch {
      e.returnValue = ''
    }
  })
  // Claude Code / Ink TUIs attach screenshots on Ctrl+V by reading the OS clipboard.
  ipcMain.on('clipboard:hasImage', (e) => {
    try {
      e.returnValue = !clipboard.readImage().isEmpty()
    } catch {
      e.returnValue = false
    }
  })

  ipcMain.handle('app:checkUpdate', async () => {
    try {
      return await checkAppUpdate(app.getVersion())
    } catch (err) {
      return {
        current: app.getVersion(),
        latest: '',
        updateAvailable: false,
        error: err && err.message ? String(err.message) : 'update check failed',
      }
    }
  })

  ipcMain.handle('app:getWindowChrome', () => ({
    platform: process.platform,
    customTitleBar: process.platform === 'linux',
    overlay: process.platform === 'win32',
    hiddenInset: process.platform === 'darwin',
  }))

  ipcMain.handle('app:setTitleTheme', async (_e, payload) => {
    const dark = !!(payload && payload.dark)
    applyThemeChrome(dark)
    return { ok: true }
  })

  ipcMain.handle('dialog:openLocalPaths', async (_e, opts = {}) => {
    const mainWindow = getMainWindow()
    if (!mainWindow || mainWindow.isDestroyed()) return { canceled: true, paths: [] }
    const allowFiles = opts.files !== false
    const allowDirs = opts.directories !== false
    const multi = !!opts.multi
    const properties = []
    if (allowFiles) properties.push('openFile')
    if (allowDirs) properties.push('openDirectory')
    if (multi) properties.push('multiSelections')
    if (!properties.length) properties.push('openFile')
    const result = await dialog.showOpenDialog(mainWindow, {
      title: opts.title || 'Choose files or folders',
      properties,
    })
    return { canceled: result.canceled, paths: result.canceled ? [] : result.filePaths }
  })

  ipcMain.handle('dialog:saveLocalPath', async (_e, opts = {}) => {
    const mainWindow = getMainWindow()
    if (!mainWindow || mainWindow.isDestroyed()) return { canceled: true, path: null }
    const result = await dialog.showSaveDialog(mainWindow, {
      title: opts.title || 'Save as',
      defaultPath: opts.defaultPath || undefined,
    })
    return { canceled: result.canceled, path: result.canceled ? null : result.filePath }
  })

  ipcMain.handle('dialog:pickLocalDirectory', async (_e, opts = {}) => {
    const mainWindow = getMainWindow()
    if (!mainWindow || mainWindow.isDestroyed()) return { canceled: true, path: null }
    const result = await dialog.showOpenDialog(mainWindow, {
      title: opts.title || 'Choose folder',
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: opts.defaultPath || undefined,
    })
    return {
      canceled: result.canceled,
      path: result.canceled || !result.filePaths.length ? null : result.filePaths[0],
    }
  })

  ipcMain.handle('window:minimize', () => {
    const mainWindow = getMainWindow()
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize()
    return { ok: true }
  })
  ipcMain.handle('window:maximizeToggle', () => {
    const mainWindow = getMainWindow()
    if (!mainWindow || mainWindow.isDestroyed()) return { maximized: false }
    if (mainWindow.isMaximized()) mainWindow.unmaximize()
    else mainWindow.maximize()
    return { maximized: mainWindow.isMaximized() }
  })
  ipcMain.handle('window:close', () => {
    const mainWindow = getMainWindow()
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close()
    return { ok: true }
  })
  ipcMain.handle('window:isMaximized', () => {
    const mainWindow = getMainWindow()
    return {
      maximized: !!(mainWindow && !mainWindow.isDestroyed() && mainWindow.isMaximized()),
    }
  })
}

function registerAiIpc(ipcMain, getAiSession) {
  ipcMain.handle('ai:detect', async () => getAiSession().detect())
  ipcMain.handle('ai:start', async (_e, opts) => getAiSession().start(opts || {}))
  // Fire-and-forget — invoke() round-trip per keystroke drops input in Ink TUIs.
  ipcMain.on('ai:input', (_e, data) => { getAiSession().write(data) })
  ipcMain.handle('ai:resize', async (_e, size) => {
    const cols = size && size.cols
    const rows = size && size.rows
    return getAiSession().resize(cols, rows)
  })
  ipcMain.handle('ai:stop', async () => {
    await getAiSession().stop()
    return { ok: true }
  })
  ipcMain.handle('ai:approval-respond', async (_e, payload) => {
    const id = payload && payload.id
    const approved = !!(payload && payload.approved)
    const message = payload && payload.message
    return { ok: getAiSession().respondApproval(id, approved, message) }
  })
}

module.exports = {
  registerAppIpc,
  registerAiIpc,
}
