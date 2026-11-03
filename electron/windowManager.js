'use strict'

const { BrowserWindow, shell, nativeTheme, screen } = require('electron')
const path = require('path')
const os = require('os')
const fs = require('fs')
const { chromeColors } = require('./themeColors')
const { checkAppUpdate } = require('./appUpdate')
const { bindUpdatePopupLifecycle } = require('./updatePopup')
const { resolveBuildIcon } = require('./pathResolver')
const {
  isLoopbackAppURL,
  isPortForwardURL,
  isSafeExternalURL,
} = require('./urlGuards')

const TITLE_BAR_HEIGHT = 36
/** Debounce window-state writes while the user is still resizing/moving. */
const WINDOW_STATE_SAVE_DEBOUNCE_MS = 400
const DEFAULT_WINDOW = { width: 1280, height: 900, minWidth: 900, minHeight: 600 }

/** Last title-bar appearance requested by the renderer (Day/Night/System). */
let chromeDarkPreferred = null
let mainWindow = null
let windowStateSaveTimer = null

function getMainWindow() {
  return mainWindow
}

function titleBarColors(dark) {
  // Match app --bg so Win overlay / window chrome sit on the same ghost strip.
  return chromeColors(dark)
}

function windowStatePath(app) {
  try {
    return path.join(app.getPath('userData'), 'window-state.json')
  } catch {
    return path.join(os.tmpdir(), 'kubespade-window-state.json')
  }
}

function loadWindowState(app) {
  try {
    const raw = JSON.parse(fs.readFileSync(windowStatePath(app), 'utf8'))
    if (!raw || typeof raw.width !== 'number' || typeof raw.height !== 'number') return null
    const clamped = clampWindowBounds({
      x: typeof raw.x === 'number' ? raw.x : undefined,
      y: typeof raw.y === 'number' ? raw.y : undefined,
      width: Math.round(raw.width),
      height: Math.round(raw.height),
    })
    if (!clamped) return null
    return {
      ...clamped,
      isMaximized: !!raw.isMaximized,
      isFullScreen: !!raw.isFullScreen,
    }
  } catch {
    return null
  }
}

/** Reject absurd sizes (e.g. bad DPI/WM reports) so restore never opens a giant window. */
function clampWindowBounds(bounds) {
  const width = Math.round(bounds.width)
  const height = Math.round(bounds.height)
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null
  let maxW = 4096
  let maxH = 2160
  try {
    const displays = screen.getAllDisplays()
    if (displays.length) {
      maxW = Math.max(...displays.map(d => d.bounds.x + d.bounds.width)) - Math.min(...displays.map(d => d.bounds.x))
      maxH = Math.max(...displays.map(d => d.bounds.y + d.bounds.height)) - Math.min(...displays.map(d => d.bounds.y))
      // Allow a little slack; refuse anything beyond the virtual desktop.
      maxW = Math.max(maxW, DEFAULT_WINDOW.minWidth)
      maxH = Math.max(maxH, DEFAULT_WINDOW.minHeight)
    }
  } catch { /* keep defaults */ }
  const out = {
    width: Math.min(Math.max(width, DEFAULT_WINDOW.minWidth), maxW),
    height: Math.min(Math.max(height, DEFAULT_WINDOW.minHeight), maxH),
  }
  if (typeof bounds.x === 'number' && Number.isFinite(bounds.x)) out.x = Math.round(bounds.x)
  if (typeof bounds.y === 'number' && Number.isFinite(bounds.y)) out.y = Math.round(bounds.y)
  return out
}

/** True if the window rectangle intersects any display work area. */
function boundsOnScreen(bounds) {
  try {
    return screen.getAllDisplays().some(d => {
      const a = d.workArea
      return (
        bounds.x < a.x + a.width
        && bounds.x + bounds.width > a.x
        && bounds.y < a.y + a.height
        && bounds.y + bounds.height > a.y
      )
    })
  } catch {
    return false
  }
}

function saveWindowState(app) {
  if (!mainWindow || mainWindow.isDestroyed()) return
  try {
    const isMaximized = mainWindow.isMaximized()
    const isFullScreen = mainWindow.isFullScreen()
    const bounds = (isMaximized || isFullScreen) && typeof mainWindow.getNormalBounds === 'function'
      ? mainWindow.getNormalBounds()
      : mainWindow.getBounds()
    const clamped = clampWindowBounds({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
    })
    if (!clamped) return
    const state = {
      ...clamped,
      isMaximized,
      isFullScreen,
    }
    fs.writeFileSync(windowStatePath(app), JSON.stringify(state), { mode: 0o600 })
  } catch (_) { /* ignore */ }
}

function scheduleSaveWindowState(app) {
  if (windowStateSaveTimer) clearTimeout(windowStateSaveTimer)
  windowStateSaveTimer = setTimeout(() => {
    windowStateSaveTimer = null
    saveWindowState(app)
  }, WINDOW_STATE_SAVE_DEBOUNCE_MS)
}

function applyThemeChrome(dark) {
  if (typeof dark === 'boolean') chromeDarkPreferred = dark
  const isDark = typeof chromeDarkPreferred === 'boolean'
    ? chromeDarkPreferred
    : nativeTheme.shouldUseDarkColors
  const colors = titleBarColors(isDark)
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setBackgroundColor(colors.backgroundColor)
    try {
      if (typeof mainWindow.setTitleBarOverlay === 'function' && process.platform === 'win32') {
        mainWindow.setTitleBarOverlay({
          color: colors.color,
          symbolColor: colors.symbolColor,
          height: TITLE_BAR_HEIGHT,
        })
      }
    } catch (_) { /* overlay unsupported */ }
  }
}

function createWindow(app, getPort) {
  const dark = nativeTheme.shouldUseDarkColors
  const colors = titleBarColors(dark)
  const saved = loadWindowState(app)
  const width = Math.max(saved?.width ?? DEFAULT_WINDOW.width, DEFAULT_WINDOW.minWidth)
  const height = Math.max(saved?.height ?? DEFAULT_WINDOW.height, DEFAULT_WINDOW.minHeight)
  const winOpts = {
    width,
    height,
    minWidth: DEFAULT_WINDOW.minWidth,
    minHeight: DEFAULT_WINDOW.minHeight,
    title: 'KubeSpade',
    backgroundColor: colors.backgroundColor,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  }

  if (saved && typeof saved.x === 'number' && typeof saved.y === 'number') {
    const candidate = { x: saved.x, y: saved.y, width, height }
    if (boundsOnScreen(candidate)) {
      winOpts.x = saved.x
      winOpts.y = saved.y
    }
  }

  if (process.platform === 'darwin') {
    winOpts.titleBarStyle = 'hiddenInset'
    winOpts.trafficLightPosition = { x: 14, y: 11 }
  } else if (process.platform === 'win32') {
    // Hidden chrome + native caption buttons (same ghost strip as Mac/Linux).
    winOpts.titleBarStyle = 'hidden'
    winOpts.titleBarOverlay = {
      color: colors.color,
      symbolColor: colors.symbolColor,
      height: TITLE_BAR_HEIGHT,
    }
  } else {
    // Linux: native GNOME frames ignore app colors — frameless + in-app controls.
    winOpts.frame = false
  }

  if (process.platform === 'linux') {
    // Prefer 512 for HiDPI docks; 256 is the common fallback shipped in extraResources.
    const icon512 = resolveBuildIcon(app, path.join('icons', '512x512.png'))
    const icon256 = resolveBuildIcon(app, path.join('icons', '256x256.png'))
    try {
      if (fs.existsSync(icon512)) winOpts.icon = icon512
      else if (fs.existsSync(icon256)) winOpts.icon = icon256
    } catch (_) { /* ignore */ }
  }

  mainWindow = new BrowserWindow(winOpts)
  applyThemeChrome(dark)

  mainWindow.once('ready-to-show', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    if (saved?.isFullScreen) {
      mainWindow.setFullScreen(true)
    } else if (saved?.isMaximized) {
      mainWindow.maximize()
    }
    mainWindow.show()
  })

  mainWindow.loadURL(`http://127.0.0.1:${getPort()}`)

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    const port = getPort()
    if (isLoopbackAppURL(url, port)) {
      return { action: 'allow' }
    }
    if (isPortForwardURL(url, port) || isSafeExternalURL(url)) {
      shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const port = getPort()
    if (!isLoopbackAppURL(url, port)) {
      event.preventDefault()
      if (isPortForwardURL(url, port) || isSafeExternalURL(url)) shell.openExternal(url)
    }
  })

  mainWindow.on('resize', () => scheduleSaveWindowState(app))
  mainWindow.on('move', () => scheduleSaveWindowState(app))
  mainWindow.on('close', () => saveWindowState(app))
  mainWindow.on('closed', () => { mainWindow = null })
  mainWindow.on('maximize', () => {
    scheduleSaveWindowState(app)
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('window:maximized', true)
    }
  })
  mainWindow.on('unmaximize', () => {
    scheduleSaveWindowState(app)
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('window:maximized', false)
    }
  })
  mainWindow.on('enter-full-screen', () => scheduleSaveWindowState(app))
  mainWindow.on('leave-full-screen', () => scheduleSaveWindowState(app))
  bindUpdatePopupLifecycle(app, mainWindow, checkAppUpdate)
}

module.exports = {
  getMainWindow,
  createWindow,
  applyThemeChrome,
}
