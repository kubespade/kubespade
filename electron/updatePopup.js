'use strict'

const { BrowserWindow, shell, nativeTheme } = require('electron')
const path = require('path')
const fs = require('fs')
const { windowBackground } = require('./themeColors')

/** @type {import('electron').BrowserWindow | null} */
let updatePopupWindow = null
/** @type {{ current: string, latest: string, downloadUrl?: string, releaseUrl?: string, releaseNotes?: string } | null} */
let popupInfo = null
/** @type {import('electron').BrowserWindow | null} */
let boundMainWindow = null

function resolveMainWindow() {
  if (boundMainWindow && !boundMainWindow.isDestroyed()) return boundMainWindow
  return BrowserWindow.getAllWindows().find(w => w !== updatePopupWindow) || null
}

function dismissPath(app) {
  return path.join(app.getPath('userData'), 'update-dismissed.txt')
}

function readDismissedVersion(app) {
  try {
    const p = dismissPath(app)
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').trim() : ''
  } catch {
    return ''
  }
}

function writeDismissedVersion(app, version) {
  try {
    fs.writeFileSync(dismissPath(app), String(version || '').trim(), 'utf8')
  } catch { /* ignore */ }
}

function popupHtmlPath() {
  return path.join(__dirname, 'update-popup.html')
}

function popupPreloadPath() {
  return path.join(__dirname, 'update-popup-preload.js')
}

const UPDATE_POPUP_WIDTH = 400
const UPDATE_POPUP_HEIGHT_COMPACT = 248
const UPDATE_POPUP_HEIGHT_NO_NOTES = 180
const UPDATE_POPUP_HEIGHT_EXPANDED = 440

function initialPopupBounds(mainWin, contentH = UPDATE_POPUP_HEIGHT_COMPACT) {
  const popupW = UPDATE_POPUP_WIDTH
  const popupH = Math.max(176, Math.min(520, Math.round(contentH)))
  if (!mainWin || mainWin.isDestroyed()) {
    return { width: popupW, height: popupH, x: undefined, y: undefined }
  }
  const b = mainWin.getBounds()
  return {
    width: popupW,
    height: popupH,
    x: b.x + Math.max(0, b.width - popupW - 24),
    y: b.y + 56,
  }
}

function setPopupContentHeight(contentH) {
  if (!updatePopupWindow || updatePopupWindow.isDestroyed()) return
  const { width, height } = initialPopupBounds(boundMainWindow, contentH)
  try {
    updatePopupWindow.setContentSize(width, height)
  } catch {
    try { updatePopupWindow.setSize(width, height) } catch { /* ignore */ }
  }
}

function setPopupLayout({ hasNotes = false, expanded = false, height } = {}) {
  if (typeof height === 'number' && height > 0) {
    setPopupContentHeight(height)
    return
  }
  // Fallbacks if the renderer does not send a measured height.
  const popupH = !hasNotes
    ? UPDATE_POPUP_HEIGHT_NO_NOTES
    : expanded
      ? UPDATE_POPUP_HEIGHT_EXPANDED
      : UPDATE_POPUP_HEIGHT_COMPACT
  setPopupContentHeight(popupH)
}

function setPopupExpanded(expanded) {
  setPopupLayout({ hasNotes: true, expanded: Boolean(expanded) })
}

function applyPopupTheme(win) {
  const dark = nativeTheme.shouldUseDarkColors
  if (win && !win.isDestroyed()) {
    win.setBackgroundColor(windowBackground(dark))
  }
}

function raiseAboveMain() {
  if (!updatePopupWindow || updatePopupWindow.isDestroyed()) return
  try {
    if (process.platform === 'darwin') {
      updatePopupWindow.setAlwaysOnTop(true, 'floating')
    } else {
      updatePopupWindow.setAlwaysOnTop(true)
    }
    updatePopupWindow.moveTop()
  } catch { /* ignore */ }
}

function closeUpdatePopup() {
  if (!updatePopupWindow || updatePopupWindow.isDestroyed()) {
    updatePopupWindow = null
    popupInfo = null
    return
  }
  updatePopupWindow.close()
}

/**
 * @param {import('electron').App} app
 * @param {import('electron').BrowserWindow | null} mainWin
 * @param {{ updateAvailable?: boolean, latest?: string, current?: string, downloadUrl?: string }} info
 * @param {{ force?: boolean }} [opts] force=true ignores Later-dismiss (Settings / title-bar reopen)
 */
function showUpdatePopup(app, mainWin, info, opts = {}) {
  if (!info?.updateAvailable || !info.latest) return
  if (!opts.force && readDismissedVersion(app) === info.latest) return

  if (mainWin && !mainWin.isDestroyed()) boundMainWindow = mainWin

  popupInfo = {
    current: info.current,
    latest: info.latest,
    downloadUrl: info.downloadUrl,
    releaseUrl: info.releaseUrl,
    releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : '',
  }

  if (updatePopupWindow && !updatePopupWindow.isDestroyed()) {
    updatePopupWindow.webContents.send('update-popup:info', popupInfo)
    raiseAboveMain()
    updatePopupWindow.show()
    updatePopupWindow.focus()
    return
  }

  const bounds = initialPopupBounds(mainWin, UPDATE_POPUP_HEIGHT_COMPACT)
  const winOpts = {
    ...bounds,
    title: 'KubeSpade Update',
    resizable: false,
    minimizable: true,
    maximizable: false,
    fullscreenable: false,
    show: false,
    autoHideMenuBar: true,
    useContentSize: true,
    // Independent of main window movement; still stays above it while open.
    alwaysOnTop: true,
    backgroundColor: windowBackground(nativeTheme.shouldUseDarkColors),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: popupPreloadPath(),
    },
  }

  const win = new BrowserWindow(winOpts)
  if (process.platform === 'darwin') {
    try { win.setAlwaysOnTop(true, 'floating') } catch { /* ignore */ }
  }

  updatePopupWindow = win
  applyPopupTheme(win)

  win.webContents.on('did-finish-load', () => {
    if (win.isDestroyed()) return
    win.webContents.send('update-popup:theme', { dark: nativeTheme.shouldUseDarkColors })
    win.webContents.send('update-popup:info', popupInfo)
    win.show()
    raiseAboveMain()
  })

  win.on('closed', () => {
    updatePopupWindow = null
    popupInfo = null
  })

  void win.loadFile(popupHtmlPath())
}

function registerUpdatePopupIpc(app, ipcMain, checkAppUpdate) {
  ipcMain.handle('update-popup:download', async () => {
    const url = popupInfo?.downloadUrl || 'https://kubespade.com/download.html'
    await shell.openExternal(url)
    return { ok: true }
  })

  ipcMain.handle('update-popup:openRelease', async () => {
    const url = popupInfo?.releaseUrl || 'https://github.com/kubespade/kubespade/releases'
    await shell.openExternal(url)
    return { ok: true }
  })

  ipcMain.handle('update-popup:setExpanded', async (_e, expanded) => {
    setPopupExpanded(Boolean(expanded))
    return { ok: true }
  })

  ipcMain.handle('update-popup:layout', async (_e, opts) => {
    const hasNotes = Boolean(opts && opts.hasNotes)
    const expanded = Boolean(opts && opts.expanded)
    const height = opts && typeof opts.height === 'number' ? opts.height : undefined
    setPopupLayout({ hasNotes, expanded, height })
    return { ok: true }
  })

  ipcMain.handle('update-popup:dismiss', async () => {
    // Later: hide auto-prompt for this version; Settings / title bar can still reopen.
    if (popupInfo?.latest) writeDismissedVersion(app, popupInfo.latest)
    closeUpdatePopup()
    return { ok: true }
  })

  ipcMain.handle('app:promptUpdateIfNeeded', async () => {
    return maybeShowUpdatePopup(app, resolveMainWindow(), checkAppUpdate)
  })

  ipcMain.handle('app:showUpdatePopup', async (_e, cached) => {
    const mainWin = resolveMainWindow()
    try {
      // Prefer the info the UI already has so the button works offline / after Later.
      let info = cached && typeof cached === 'object' && cached.updateAvailable && cached.latest
        ? {
            current: String(cached.current || app.getVersion()),
            latest: String(cached.latest),
            updateAvailable: true,
            releaseUrl: cached.releaseUrl,
            downloadUrl: cached.downloadUrl,
            releaseNotes: typeof cached.releaseNotes === 'string' ? cached.releaseNotes : '',
          }
        : null
      if (!info) {
        info = await checkAppUpdate(app.getVersion())
      } else if (!info.releaseNotes) {
        // Refresh notes if the UI cache predates this field.
        try {
          const fresh = await checkAppUpdate(app.getVersion())
          if (fresh?.latest === info.latest && fresh.releaseNotes) {
            info = { ...info, releaseNotes: fresh.releaseNotes, releaseUrl: fresh.releaseUrl || info.releaseUrl }
          }
        } catch { /* keep cached */ }
      }
      if (!info?.updateAvailable) return info
      showUpdatePopup(app, mainWin, info, { force: true })
      return info
    } catch (err) {
      return {
        current: app.getVersion(),
        latest: '',
        updateAvailable: false,
        error: err && err.message ? String(err.message) : 'update check failed',
      }
    }
  })
}

async function maybeShowUpdatePopup(app, mainWin, checkAppUpdate) {
  try {
    const info = await checkAppUpdate(app.getVersion())
    if (!info?.updateAvailable) return info
    if (readDismissedVersion(app) === info.latest) return info
    showUpdatePopup(app, mainWin, info)
    return info
  } catch (err) {
    return {
      current: app.getVersion(),
      latest: '',
      updateAvailable: false,
      error: err && err.message ? String(err.message) : 'update check failed',
    }
  }
}

function bindUpdatePopupLifecycle(app, mainWin, checkAppUpdate) {
  if (!mainWin || mainWin.isDestroyed()) return
  boundMainWindow = mainWin
  mainWin.once('ready-to-show', () => {
    setTimeout(() => {
      if (mainWin.isDestroyed()) return
      void maybeShowUpdatePopup(app, mainWin, checkAppUpdate)
    }, 600)
  })
  // Keep the independent popup above the main window when the app is used.
  mainWin.on('focus', () => { raiseAboveMain() })
  mainWin.on('show', () => { raiseAboveMain() })
  mainWin.on('closed', () => {
    if (boundMainWindow === mainWin) boundMainWindow = null
    closeUpdatePopup()
  })
}

function onNativeThemeUpdated() {
  applyPopupTheme(updatePopupWindow)
  if (updatePopupWindow && !updatePopupWindow.isDestroyed()) {
    updatePopupWindow.webContents.send(
      'update-popup:theme',
      { dark: nativeTheme.shouldUseDarkColors },
    )
  }
}

module.exports = {
  bindUpdatePopupLifecycle,
  closeUpdatePopup,
  maybeShowUpdatePopup,
  onNativeThemeUpdated,
  readDismissedVersion,
  registerUpdatePopupIpc,
  showUpdatePopup,
  writeDismissedVersion,
}
