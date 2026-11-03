'use strict'

const fs = require('fs')
const path = require('path')
const os = require('os')

/** Every path we try — user can find at least one after a failed launch. */
function startupLogPaths() {
  const paths = new Set()
  paths.add(path.join(os.tmpdir(), 'kubespade-startup.log'))
  if (process.env.APPDATA) {
    paths.add(path.join(process.env.APPDATA, 'kubespade', 'startup.log'))
    paths.add(path.join(process.env.APPDATA, 'KubeSpade', 'startup.log'))
  }
  if (process.env.LOCALAPPDATA) {
    paths.add(path.join(process.env.LOCALAPPDATA, 'kubespade', 'startup.log'))
    paths.add(path.join(process.env.LOCALAPPDATA, 'KubeSpade', 'startup.log'))
  }
  if (process.env.PORTABLE_EXECUTABLE_DIR) {
    paths.add(path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'kubespade-startup.log'))
  }
  try {
    paths.add(path.join(path.dirname(process.execPath), 'kubespade-startup.log'))
  } catch (_) { /* ignore */ }
  return [...paths]
}

function writeStartupLog(line) {
  const msg = `[${new Date().toISOString()}] ${line}\n`
  for (const p of startupLogPaths()) {
    try {
      fs.mkdirSync(path.dirname(p), { recursive: true })
      fs.appendFileSync(p, msg)
    } catch (_) { /* ignore */ }
  }
  try {
    process.stderr.write(msg)
  } catch (_) { /* ignore */ }
}

function startupLogHint() {
  return startupLogPaths().join('\n')
}

/** Parallels Mac shares / UNC — Electron asar and Chromium profile locks fail here. */
function isUnreliableFsPath(p) {
  if (!p || typeof p !== 'string') return false
  const n = p.replace(/\//g, '\\')
  if (n.startsWith('\\\\')) return true
  const lower = n.toLowerCase()
  if (lower.includes('\\mac\\') || lower.includes('\\psf\\')) return true
  if (/^[a-z]:\\media\\psf\\/i.test(lower)) return true
  return false
}

function shareLaunchHint() {
  return [process.execPath, process.env.PORTABLE_EXECUTABLE_DIR, process.cwd()]
    .filter(Boolean)
    .find(isUnreliableFsPath) || ''
}

module.exports = { startupLogPaths, writeStartupLog, startupLogHint, isUnreliableFsPath, shareLaunchHint }
