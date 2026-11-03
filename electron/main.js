const { app, nativeTheme, Menu, dialog, ipcMain } = require('electron')
const { writeStartupLog, startupLogHint, shareLaunchHint } = require('./startupLog')
const { checkAppUpdate } = require('./appUpdate')
const {
  onNativeThemeUpdated,
  registerUpdatePopupIpc,
} = require('./updatePopup')
const {
  getPort,
  getApiToken,
  getBackendPath,
  resolveUserPath,
  startBackend,
  killBackend,
} = require('./backendProcess')
const { getMainWindow, createWindow, applyThemeChrome } = require('./windowManager')
const { registerAppIpc, registerAiIpc } = require('./ipc')

let cachedUserPath = ''
/** @type {ReturnType<import('./ai').createAiSession> | null} */
let aiSession = null

/** Windows/Linux: drop Electron's File/Edit/View bar — it sits under the title
 *  and visually merges with in-app headers (Welcome, etc.). macOS keeps the
 *  system menu bar. */
function setupAppMenu() {
  if (process.platform === 'darwin') return
  Menu.setApplicationMenu(null)
}

process.on('uncaughtException', err => {
  writeStartupLog(`uncaughtException: ${err && err.stack ? err.stack : err}`)
})
process.on('unhandledRejection', reason => {
  writeStartupLog(`unhandledRejection: ${reason && reason.stack ? reason.stack : reason}`)
})

writeStartupLog(`main.js loaded arch=${process.arch} packaged=${app.isPackaged}`)

app.whenReady().then(async () => {
  try {
    writeStartupLog(`KubeSpade starting platform=${process.platform} arch=${process.arch} packaged=${app.isPackaged}`)
    writeStartupLog(`execPath=${process.execPath}`)
    writeStartupLog(`resourcesPath=${process.resourcesPath}`)
    const sharePath = shareLaunchHint()
    if (sharePath) {
      dialog.showErrorBox(
        'Run KubeSpade from a local disk',
        `This copy is on a shared or network folder:\n${sharePath}\n\nOn Parallels, the Windows Desktop is often the Mac Desktop (\\\\Mac\\...). Copy the .exe to C:\\ (or another local NTFS disk) and run it from there.`,
      )
    }
    setupAppMenu()
    cachedUserPath = resolveUserPath()
    const { createAiSession } = require('./ai')
    aiSession = createAiSession({
      getPort,
      getToken: getApiToken,
      getPathEnv: () => cachedUserPath || resolveUserPath(),
      getBackendPath: () => getBackendPath(app),
      sendToRenderer: (channel, payload) => {
        const mainWindow = getMainWindow()
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(channel, payload)
        }
      },
    })
    registerAppIpc(app, ipcMain)
    registerUpdatePopupIpc(app, ipcMain, checkAppUpdate)
    registerAiIpc(ipcMain, () => aiSession)
    await startBackend(app)
    createWindow(app, getPort)
    nativeTheme.on('updated', () => {
      applyThemeChrome()
      onNativeThemeUpdated()
    })
  } catch (err) {
    writeStartupLog(`FATAL: ${err && err.stack ? err.stack : err}`)
    dialog.showErrorBox(
      'KubeSpade failed to start',
      `${err.message || err}\n\nLog files (check all):\n${startupLogHint()}\n\nIf SmartScreen blocked the app, choose More info → Run anyway.`,
    )
    app.quit()
  }
})

app.on('window-all-closed', () => {
  const stopAi = aiSession ? aiSession.stop() : Promise.resolve()
  void stopAi.finally(() => {
    killBackend()
    app.quit()
  })
})

app.on('before-quit', () => {
  if (aiSession) void aiSession.stop()
  killBackend()
})
