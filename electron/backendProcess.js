'use strict'

const { spawn } = require('child_process')
const http = require('http')
const fs = require('fs')
const crypto = require('crypto')
const { writeStartupLog } = require('./startupLog')
const { homeDir } = require('./env')
const { getBackendPath, resolveUserPath } = require('./pathResolver')

/** How long pollReady waits for /api/groups after the backend binds a port. */
const BACKEND_POLL_READY_MS = 15_000
/** Hard timeout waiting for the K8S_CLIENT_READY stderr line after spawn. */
const BACKEND_READY_LINE_MS = 20_000

let PORT = 0
let API_TOKEN = ''
let backendProcess = null

function getPort() {
  return PORT
}

function getApiToken() {
  return API_TOKEN
}

function backendEnv() {
  const home = homeDir()
  API_TOKEN = crypto.randomBytes(32).toString('hex')
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: process.env.USERPROFILE || home,
    PATH: resolveUserPath(),
    PORT: '0',
    K8S_CLIENT_API_TOKEN: API_TOKEN,
    GIN_MODE: 'release',
    AWS_SDK_LOAD_CONFIG: process.env.AWS_SDK_LOAD_CONFIG || '1',
  }
  if (process.platform === 'darwin' && !process.env.AWS_VAULT_PROMPT) {
    env.AWS_VAULT_PROMPT = 'osascript'
  }
  return env
}

function pollReady() {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + BACKEND_POLL_READY_MS
    const agent = new http.Agent({ keepAlive: false })
    function poll() {
      const req = http.get({
        hostname: '127.0.0.1',
        port: PORT,
        path: '/api/groups',
        headers: { Authorization: `Bearer ${API_TOKEN}` },
        agent,
        timeout: 2000,
      }, res => {
        res.resume()
        if (res.statusCode < 500) resolve()
        else retry()
      })
      req.on('timeout', () => { req.destroy(); retry() })
      req.on('error', retry)
    }
    function retry() {
      if (Date.now() > deadline) {
        reject(new Error('Backend did not become ready within 15 seconds'))
        return
      }
      setTimeout(poll, 250)
    }
    setTimeout(poll, 200)
  })
}

function startBackend(app) {
  return new Promise((resolve, reject) => {
    const backendPath = getBackendPath(app)
    writeStartupLog(`starting backend: ${backendPath}`)
    writeStartupLog(`exists: ${fs.existsSync(backendPath)}`)

    if (!fs.existsSync(backendPath)) {
      reject(new Error(`Backend binary not found:\n${backendPath}`))
      return
    }

    let stderrBuf = ''
    let settled = false

    backendProcess = spawn(backendPath, [], {
      env: backendEnv(),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    function fail(err) {
      if (settled) return
      settled = true
      const detail = stderrBuf.trim() ? `\n\nBackend stderr:\n${stderrBuf.trim().slice(-2000)}` : ''
      reject(new Error(`${err.message || err}${detail}`))
    }

    function onReady(addr) {
      if (settled) return
      const m = String(addr).match(/127\.0\.0\.1:(\d+)/)
      if (!m) return
      PORT = Number(m[1])
      settled = true
      writeStartupLog(`backend ready on port ${PORT}`)
      pollReady().then(resolve).catch(reject)
    }

    function onReadyLine(text) {
      const line = text.split(/\r?\n/).find(l => l.startsWith('K8S_CLIENT_READY '))
      if (line) onReady(line.slice('K8S_CLIENT_READY '.length).trim())
    }

    backendProcess.stdout.on('data', d => {
      const text = d.toString()
      writeStartupLog('[backend stdout] ' + text.trimEnd())
      onReadyLine(text)
    })
    backendProcess.stderr.on('data', d => {
      const text = d.toString()
      stderrBuf += text
      writeStartupLog('[backend stderr] ' + text.trimEnd())
      onReadyLine(text)
    })
    backendProcess.on('error', err => {
      writeStartupLog(`backend spawn error: ${err.message}`)
      fail(err)
    })
    backendProcess.on('exit', (code, signal) => {
      writeStartupLog(`backend exit code=${code} signal=${signal}`)
      if (!settled && code !== 0 && code !== null) {
        fail(new Error(`Backend exited with code ${code}`))
      }
    })

    setTimeout(() => {
      if (!settled) fail(new Error('Backend did not report K8S_CLIENT_READY within 20 seconds'))
    }, BACKEND_READY_LINE_MS)
  })
}

function killBackend() {
  if (!backendProcess) return
  const proc = backendProcess
  backendProcess = null
  if (process.platform === 'win32' && proc.pid) {
    try {
      spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
      return
    } catch (_) { /* fall through */ }
  }
  proc.kill()
}

module.exports = {
  getPort,
  getApiToken,
  getBackendPath,
  resolveUserPath,
  backendEnv,
  startBackend,
  killBackend,
}
