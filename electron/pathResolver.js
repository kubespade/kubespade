'use strict'

const path = require('path')
const { execFileSync } = require('child_process')
const { homeDir } = require('./env')

function getBackendPath(app) {
  const win = process.platform === 'win32'
  if (app.isPackaged) {
    return path.join(process.resourcesPath, win ? 'backend.exe' : 'backend')
  }
  const name = win ? 'k8s-client-backend.exe' : 'k8s-client-backend'
  return path.join(__dirname, '..', 'backend', name)
}

function resolveUserPath() {
  const home = homeDir()
  if (process.platform === 'win32') {
    const defaults = [
      path.join(home, 'AppData', 'Local', 'Programs', 'Amazon', 'AWSCLIV2'),
      path.join(home, 'AppData', 'Local', 'Google', 'Cloud SDK', 'google-cloud-sdk', 'bin'),
      'C:\\Program Files\\Amazon\\AWSCLIV2',
      'C:\\Program Files (x86)\\Google\\Cloud SDK\\google-cloud-sdk\\bin',
      'C:\\Program Files\\Git\\cmd',
      'C:\\Windows\\System32',
      'C:\\Windows',
    ]
    const parts = [
      ...(process.env.PATH || '').split(';'),
      ...defaults,
    ]
      .map(p => p.trim())
      .filter(Boolean)
    return [...new Set(parts)].join(';')
  }

  const defaults = [
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
    '/usr/local/bin',
    '/usr/local/sbin',
    path.join(home, '.local', 'bin'),
    path.join(home, 'bin'),
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
  ]

  // Never use a login shell (-l): oh-my-zsh / nvm / VPN DNS can hang for tens of seconds
  // and block the Electron window from opening. Prefer a fast non-interactive probe.
  let shellPath = ''
  try {
    const sh = process.env.SHELL || '/bin/zsh'
    shellPath = execFileSync(sh, ['-c', 'echo -n "$PATH"'], {
      encoding: 'utf8',
      timeout: 1500,
      env: {
        HOME: home,
        USER: process.env.USER || '',
        PATH: process.env.PATH || '/usr/bin:/bin',
        TERM: 'dumb',
        SHELL: sh,
        DISABLE_AUTO_UPDATE: 'true',
        DISABLE_AUTO_TITLE: 'true',
        ZSH_DISABLE_COMPFIX: 'true',
      },
    }).trim()
  } catch (_) {
    // ignore — defaults below are enough for local launch
  }

  const parts = [
    ...(shellPath ? shellPath.split(':') : []),
    ...(process.env.PATH || '').split(':'),
    ...defaults,
  ]
    .map(p => p.trim())
    .filter(Boolean)

  return [...new Set(parts)].join(':')
}

function resolveBuildIcon(app, name) {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, name)
  }
  return path.join(__dirname, 'build', name)
}

module.exports = {
  getBackendPath,
  resolveUserPath,
  resolveBuildIcon,
}
