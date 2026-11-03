'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')

/** User home across macOS / Windows / Linux. */
function homeDir() {
  return process.env.HOME || process.env.USERPROFILE || os.homedir()
}

function pathSep() {
  return path.sep
}

function readJsonFile(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return fallback
  }
}

/** Short hint when node-pty fails to load or spawn. */
function ptyErrorHint(err) {
  const msg = err && err.message ? err.message : String(err || '')
  if (/Cannot find module|NODE_MODULE_VERSION|was compiled against/i.test(msg)) {
    return 'Rebuild native modules (npm install in electron/) or reinstall the app.'
  }
  return msg
}

module.exports = { homeDir, pathSep, readJsonFile, ptyErrorHint }
