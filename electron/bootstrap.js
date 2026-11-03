'use strict'

// Entry point — log with Node builtins only, before the rest of the app loads.
const path = require('path')
const fs = require('fs')
const os = require('os')
const { app } = require('electron')
const { writeStartupLog, shareLaunchHint: detectShareLaunch } = require('./startupLog')

writeStartupLog(`bootstrap pid=${process.pid} arch=${process.arch} platform=${process.platform}`)
writeStartupLog(`execPath=${process.execPath}`)
writeStartupLog(`cwd=${process.cwd()}`)
writeStartupLog(`PORTABLE_EXECUTABLE_DIR=${process.env.PORTABLE_EXECUTABLE_DIR || ''}`)
writeStartupLog(`PORTABLE_EXECUTABLE_FILE=${process.env.PORTABLE_EXECUTABLE_FILE || ''}`)
writeStartupLog(`APPDATA=${process.env.APPDATA || ''}`)

function portableUserDataDir() {
  const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
  return path.join(local, 'KubeSpadePortableData')
}

// Portable must not share Chromium userData with an installed/unpacked copy.
// Keep it on local NTFS — never next to the .exe on a Parallels/Mac share.
if (process.env.PORTABLE_EXECUTABLE_DIR) {
  try {
    const dir = portableUserDataDir()
    fs.mkdirSync(dir, { recursive: true })
    app.setPath('userData', dir)
    writeStartupLog(`userData(portable)=${dir}`)
  } catch (err) {
    writeStartupLog(`userData(portable) failed: ${err && err.message ? err.message : err}`)
  }
  app.commandLine.appendSwitch('disable-gpu-sandbox')
}

const shareLaunchHint = detectShareLaunch()
if (shareLaunchHint) {
  writeStartupLog(`unreliable FS path: ${shareLaunchHint}`)
}

try {
  require('./main.js')
} catch (err) {
  writeStartupLog(`FATAL bootstrap: ${err && err.stack ? err.stack : err}`)
  throw err
}
