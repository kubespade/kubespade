'use strict'

const { URL } = require('url')

/** Normalize hostname — some Node versions keep brackets on IPv6 literals. */
function loopbackHost(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '')
  return host === 'localhost' || host === '127.0.0.1' || host === '::1'
}

function isLoopbackAppURL(raw, appPort) {
  let u
  try {
    u = new URL(raw)
  } catch {
    return false
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
  if (u.username || u.password) return false
  if (!loopbackHost(u.hostname)) return false
  const port = u.port ? Number(u.port) : (u.protocol === 'https:' ? 443 : 80)
  return port === appPort
}

/** Active port-forward listener on loopback (not the app backend port). */
function isPortForwardURL(raw, appPort) {
  let u
  try {
    u = new URL(raw)
  } catch {
    return false
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
  if (u.username || u.password) return false
  if (!loopbackHost(u.hostname)) return false
  if (!u.port) return false
  const port = Number(u.port)
  if (!Number.isFinite(port) || port <= 0 || port > 65535) return false
  return port !== appPort
}

function isSafeExternalURL(raw) {
  let u
  try {
    u = new URL(raw)
  } catch {
    return false
  }
  if (u.protocol === 'https:' || u.protocol === 'mailto:') return true
  // OAuth / CLI auth callbacks (Gemini, etc.) often use loopback http.
  if (u.protocol === 'http:') {
    return loopbackHost(u.hostname)
  }
  return false
}

module.exports = {
  isLoopbackAppURL,
  isPortForwardURL,
  isSafeExternalURL,
}
