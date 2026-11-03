'use strict'

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { execFileSync } = require('child_process')
const { homeDir } = require('./env')

/**
 * Known local AI coding CLIs we can launch in the in-app terminal.
 * mcp: project MCP config format we write into the ephemeral workspace.
 */
const AGENT_DEFS = [
  {
    id: 'claude',
    name: 'Claude Code',
    binaries: process.platform === 'win32' ? ['claude.exe', 'claude.cmd', 'claude'] : ['claude'],
    mcp: 'claude',
    extras: (home) => [
      path.join(home, '.local', 'bin', 'claude'),
      path.join(home, 'bin', 'claude'),
      '/opt/homebrew/bin/claude',
      '/usr/local/bin/claude',
      path.join(home, '.claude', 'local', 'claude'),
      path.join(home, 'AppData', 'Roaming', 'npm', 'claude.cmd'),
      path.join(home, 'AppData', 'Local', 'Programs', 'claude', 'claude.exe'),
    ],
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    binaries: process.platform === 'win32' ? ['gemini.exe', 'gemini.cmd', 'gemini'] : ['gemini'],
    mcp: 'gemini',
    extras: (home) => [
      path.join(home, '.local', 'bin', 'gemini'),
      path.join(home, 'bin', 'gemini'),
      '/opt/homebrew/bin/gemini',
      '/usr/local/bin/gemini',
      path.join(home, 'AppData', 'Roaming', 'npm', 'gemini.cmd'),
      path.join(home, '.nvm', 'current', 'bin', 'gemini'),
    ],
  },
  {
    id: 'codex',
    name: 'Codex CLI',
    binaries: process.platform === 'win32' ? ['codex.exe', 'codex.cmd', 'codex'] : ['codex'],
    mcp: 'codex',
    extras: (home) => [
      path.join(home, '.local', 'bin', 'codex'),
      path.join(home, 'bin', 'codex'),
      '/opt/homebrew/bin/codex',
      '/usr/local/bin/codex',
      path.join(home, '.npm-global', 'bin', 'codex'),
      path.join(home, 'AppData', 'Roaming', 'npm', 'codex.cmd'),
      path.join(home, 'AppData', 'Roaming', 'npm', 'codex'),
      path.join(home, '.nvm', 'current', 'bin', 'codex'),
      // Official installer often lands here on macOS.
      path.join(home, '.codex', 'bin', 'codex'),
    ],
  },
  {
    id: 'copilot',
    name: 'GitHub Copilot',
    binaries: process.platform === 'win32' ? ['copilot.exe', 'copilot.cmd', 'copilot'] : ['copilot'],
    mcp: 'copilot',
    extras: (home) => [
      path.join(home, '.local', 'bin', 'copilot'),
      path.join(home, 'bin', 'copilot'),
      '/opt/homebrew/bin/copilot',
      '/usr/local/bin/copilot',
      path.join(home, 'AppData', 'Roaming', 'npm', 'copilot.cmd'),
      path.join(home, '.nvm', 'current', 'bin', 'copilot'),
    ],
  },
  {
    id: 'cursor',
    name: 'Cursor Agent',
    // Prefer cursor-agent — bare `agent` is generic and needs fingerprinting.
    binaries: process.platform === 'win32'
      ? ['cursor-agent.exe', 'cursor-agent.cmd', 'cursor-agent', 'agent.exe', 'agent.cmd', 'agent']
      : ['cursor-agent', 'agent'],
    mcp: 'cursor',
    extras: (home) => [
      path.join(home, '.local', 'bin', 'cursor-agent'),
      path.join(home, '.cursor', 'bin', 'cursor-agent'),
      path.join(home, '.local', 'bin', 'agent'),
      path.join(home, '.cursor', 'bin', 'agent'),
      path.join(home, 'bin', 'cursor-agent'),
      path.join(home, 'bin', 'agent'),
      '/opt/homebrew/bin/cursor-agent',
      '/opt/homebrew/bin/agent',
      '/usr/local/bin/cursor-agent',
      '/usr/local/bin/agent',
      path.join(home, 'AppData', 'Local', 'cursor-agent', 'cursor-agent.exe'),
      path.join(home, 'AppData', 'Local', 'Programs', 'cursor', 'resources', 'app', 'bin', 'cursor-agent.exe'),
    ],
  },
]

function pathDirs(pathEnv) {
  const sep = process.platform === 'win32' ? ';' : ':'
  return String(pathEnv || process.env.PATH || '')
    .split(sep)
    .map(p => p.trim())
    .filter(Boolean)
}

function isExecutableFile(filePath) {
  try {
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return false
    try {
      fs.accessSync(filePath, fs.constants.X_OK)
      return true
    } catch {
      return process.platform === 'win32'
    }
  } catch {
    return false
  }
}

function whichBinary(name, pathEnv) {
  try {
    const cmd = process.platform === 'win32' ? 'where' : 'which'
    const out = execFileSync(cmd, [name], {
      encoding: 'utf8',
      timeout: 2000,
      env: { ...process.env, PATH: pathEnv || process.env.PATH },
      windowsHide: true,
    }).trim().split(/\r?\n/)[0]
    if (out && isExecutableFile(out)) return out
  } catch {
    // ignore
  }
  return null
}

/** Bare `agent` is common — confirm it’s Cursor Agent CLI before treating as installed. */
function looksLikeCursorAgent(filePath, pathEnv) {
  const base = path.basename(filePath).toLowerCase().replace(/\.(exe|cmd)$/i, '')
  if (base === 'cursor-agent') return true
  if (String(filePath).toLowerCase().includes(`${path.sep}.cursor${path.sep}`)) return true
  try {
    const out = execFileSync(filePath, ['--help'], {
      encoding: 'utf8',
      timeout: 3000,
      env: { ...process.env, PATH: pathEnv || process.env.PATH },
      windowsHide: true,
    })
    return /approve-mcps|--workspace|Cursor Agent/i.test(out)
  } catch (err) {
    const combined = `${err.stdout || ''}\n${err.stderr || ''}\n${err.message || ''}`
    return /approve-mcps|--workspace|Cursor Agent/i.test(combined)
  }
}

/**
 * @param {string} pathEnv
 * @returns {{ agents: Array<{id:string,name:string,path:string,mcp:string}>, platform: string }}
 */
function detectAiAgents(pathEnv) {
  const home = homeDir()
  const dirs = pathDirs(pathEnv)
  const agents = []

  for (const def of AGENT_DEFS) {
    const candidates = []
    for (const dir of dirs) {
      for (const bin of def.binaries) {
        candidates.push(path.join(dir, bin))
      }
    }
    for (const p of def.extras(home)) candidates.push(p)

    let found = null
    const seen = new Set()
    for (const c of candidates) {
      if (seen.has(c)) continue
      seen.add(c)
      if (!isExecutableFile(c)) continue
      if (def.id === 'cursor' && !looksLikeCursorAgent(c, pathEnv)) continue
      found = c
      break
    }
    if (!found) {
      for (const bin of def.binaries) {
        const base = bin.replace(/\.(exe|cmd)$/i, '')
        const hit = whichBinary(base, pathEnv)
        if (!hit) continue
        if (def.id === 'cursor' && !looksLikeCursorAgent(hit, pathEnv)) continue
        found = hit
        break
      }
    }
    if (found) {
      agents.push({
        id: def.id,
        name: def.name,
        path: found,
        mcp: def.mcp,
      })
    }
  }

  return { agents, platform: process.platform }
}

const KUBESPADE_MCP_TOOLS = [
  'kubespade_list_clusters',
  'kubespade_get',
  'kubespade_describe',
  'kubespade_logs',
  'kubespade_apply',
  'kubespade_delete',
]

function claudeMcpAllowRules() {
  return [
    'mcp__kubespade',
    'mcp__kubespade__*',
    ...KUBESPADE_MCP_TOOLS.map((t) => `mcp__kubespade__${t}`),
  ]
}

function readJsonFile(filePath) {
  try {
    const v = JSON.parse(fs.readFileSync(filePath, 'utf8') || '{}')
    return v && typeof v === 'object' ? v : {}
  } catch {
    return {}
  }
}

/** Project MCP for Copilot is gated on folder trust — pin our stable workspace. */
function ensureCopilotTrustedFolder(workspacePath) {
  const home = homeDir()
  const copilotDir = path.join(home, '.copilot')
  try {
    fs.mkdirSync(copilotDir, { recursive: true, mode: 0o700 })
  } catch {
    return
  }
  const cfgPath = path.join(copilotDir, 'config.json')
  const cfg = readJsonFile(cfgPath)
  const key = Array.isArray(cfg.trusted_folders) && !Array.isArray(cfg.trustedFolders)
    ? 'trusted_folders'
    : 'trustedFolders'
  const list = Array.isArray(cfg[key]) ? cfg[key].map(String) : []
  const resolved = path.resolve(workspacePath)
  if (list.some(p => path.resolve(p) === resolved)) return
  cfg[key] = [...list, resolved]
  try {
    fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), { mode: 0o600 })
  } catch {
    // Non-fatal — user may still confirm trust interactively.
  }
}

/**
 * Codex loads project `.codex/config.toml` only when the cwd is trusted in
 * ~/.codex/config.toml (`[projects."<path>"] trust_level = "trusted"`).
 */
function ensureCodexTrustedProject(workspacePath) {
  const home = homeDir()
  const codexDir = path.join(home, '.codex')
  try {
    fs.mkdirSync(codexDir, { recursive: true, mode: 0o700 })
  } catch {
    return
  }
  const cfgPath = path.join(codexDir, 'config.toml')
  let raw = ''
  try {
    raw = fs.readFileSync(cfgPath, 'utf8')
  } catch {
    // New file.
  }

  const resolved = path.resolve(workspacePath)
  const header = `[projects.${JSON.stringify(resolved)}]`
  if (raw.includes(header)) {
    const start = raw.indexOf(header)
    const after = raw.slice(start + header.length)
    const next = after.search(/\n\[/)
    const sectionBody = next === -1 ? after : after.slice(0, next)
    const rest = next === -1 ? '' : after.slice(next)
    if (/^\s*trust_level\s*=\s*"trusted"\s*$/m.test(sectionBody)) return
    let newBody = sectionBody.replace(/^\s*trust_level\s*=\s*"[^"]*"\s*$/m, 'trust_level = "trusted"')
    if (newBody === sectionBody) {
      newBody = `\ntrust_level = "trusted"\n${sectionBody.replace(/^\n+/, '')}`
    } else if (!newBody.startsWith('\n')) {
      newBody = `\n${newBody}`
    }
    raw = raw.slice(0, start) + header + newBody + rest
  } else {
    raw = `${raw.trimEnd() ? `${raw.trimEnd()}\n\n` : ''}${header}\ntrust_level = "trusted"\n`
  }
  try {
    fs.writeFileSync(cfgPath, raw, { mode: 0o600 })
  } catch {
    // Non-fatal — user may still trust the folder interactively.
  }
}

/** Gemini stdio MCP + server `trust` only apply in a trusted folder. */
function ensureGeminiTrustedFolder(workspacePath) {
  const home = homeDir()
  const geminiDir = path.join(home, '.gemini')
  try {
    fs.mkdirSync(geminiDir, { recursive: true, mode: 0o700 })
  } catch {
    return
  }
  const cfgPath = path.join(geminiDir, 'trustedFolders.json')
  const cfg = readJsonFile(cfgPath)
  const resolved = path.resolve(workspacePath)
  const keys = [...new Set([resolved, resolved.replace(/\\/g, '/')])]
  let changed = false
  for (const key of keys) {
    if (cfg[key] === 'TRUST_FOLDER') continue
    cfg[key] = 'TRUST_FOLDER'
    changed = true
  }
  if (!changed) return
  try {
    fs.writeFileSync(cfgPath, `${JSON.stringify(cfg, null, 2)}\n`, { mode: 0o600 })
  } catch {
    // Non-fatal — GEMINI_CLI_TRUST_WORKSPACE still skips the dialog.
  }
}

function cursorProjectSlugs(workspacePath) {
  const resolved = path.resolve(workspacePath)
  const posix = resolved.replace(/\\/g, '/')
  const slug = (s) => s.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  const slashOnly = (s) => s.replace(/[/\\]/g, '-').replace(/^-/, '')
  // Skip names that cannot be a Windows folder (`C:` / backslash).
  const ok = (s) => s && !/[<>:"/\\|?*]/.test(s)
  return [...new Set([
    slashOnly(resolved),
    slashOnly(posix),
    slug(resolved),
    slug(posix),
  ])].filter(ok)
}

function cursorMcpApprovalKey(serverName, server, cwd) {
  const hash = crypto
    .createHash('sha256')
    .update(JSON.stringify({ path: cwd, server }))
    .digest('hex')
    .slice(0, 16)
  return `${serverName}-${hash}`
}

/** Pre-seed Cursor CLI MCP allow-list so the Approve/Continue/Quit TUI never appears. */
function writeCursorMcpApprovals(workspacePath, stdioServer) {
  const resolved = path.resolve(workspacePath)
  const posix = resolved.replace(/\\/g, '/')
  const env = stdioServer.env || {}
  const sortedEnv = Object.fromEntries(Object.keys(env).sort().map((k) => [k, env[k]]))
  const variants = [
    { command: stdioServer.command, args: stdioServer.args, env },
    { command: stdioServer.command, args: stdioServer.args, env: sortedEnv },
    { command: stdioServer.command, args: stdioServer.args },
  ]
  const keys = new Set()
  for (const cwd of [resolved, posix]) {
    for (const server of variants) {
      keys.add(cursorMcpApprovalKey('kubespade', server, cwd))
    }
  }
  const home = homeDir()
  for (const slug of cursorProjectSlugs(workspacePath)) {
    const dir = path.join(home, '.cursor', 'projects', slug)
    try {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
      const approvalsPath = path.join(dir, 'mcp-approvals.json')
      let existing = []
      try {
        const parsed = JSON.parse(fs.readFileSync(approvalsPath, 'utf8'))
        if (Array.isArray(parsed)) existing = parsed.map(String)
      } catch { /* missing or invalid */ }
      fs.writeFileSync(
        approvalsPath,
        `${JSON.stringify([...new Set([...existing, ...keys])], null, 2)}\n`,
        { mode: 0o600 },
      )
      fs.writeFileSync(path.join(dir, '.workspace-trusted'), '', { mode: 0o600 })
    } catch {
      // Non-fatal — --approve-mcps still skips the prompt.
    }
  }
}

/** Skip Cursor’s per-tool “Run this MCP tool?” — cluster writes still go through in-app Approve. */
function writeCursorCliPermissions(workspacePath) {
  const cursorDir = path.join(workspacePath, '.cursor')
  try {
    fs.mkdirSync(cursorDir, { recursive: true, mode: 0o700 })
    fs.writeFileSync(
      path.join(cursorDir, 'cli.json'),
      `${JSON.stringify({
        permissions: {
          allow: ['Mcp(kubespade:*)'],
          deny: [],
        },
      }, null, 2)}\n`,
      { mode: 0o600 },
    )
  } catch {
    // Non-fatal — --force still skips the prompt.
  }
}

function mcpChildEnv(pathEnv, approvalUrl, approvalToken) {
  const home = homeDir()
  const env = {
    PATH: pathEnv || process.env.PATH || '',
    HOME: home,
    USERPROFILE: process.env.USERPROFILE || home,
    KUBESPADE_APPROVAL_URL: approvalUrl,
    KUBESPADE_APPROVAL_TOKEN: approvalToken,
  }
  // Claude may replace the MCP process env with only these keys.
  // Keep enough for AWS/GCP exec plugins inside client-go.
  if (process.platform === 'win32') {
    for (const k of ['SystemRoot', 'SYSTEMROOT', 'ComSpec', 'PATHEXT', 'TMP', 'TEMP', 'USERNAME', 'USERDOMAIN']) {
      if (process.env[k]) env[k] = process.env[k]
    }
  }
  return env
}

/** Per-agent MCP install + spawn argv — attached onto AGENT_DEFS below. */
function writeClaudeWorkspaceConfig(ctx) {
  const claudeDir = path.join(ctx.workspacePath, '.claude')
  fs.mkdirSync(claudeDir, { recursive: true, mode: 0o700 })
  fs.writeFileSync(
    path.join(claudeDir, 'settings.local.json'),
    JSON.stringify({
      enabledMcpjsonServers: ['kubespade'],
      enableAllProjectMcpServers: true,
      permissions: {
        allow: claudeMcpAllowRules(),
      },
    }, null, 2),
    { mode: 0o600 },
  )
}

function spawnClaudeArgs({ claudeMcpConfigPath }) {
  if (!claudeMcpConfigPath) return []
  // Allow only KubeSpade MCP tools — not Bash/Edit. Cluster writes still hit in-app Approve.
  return [
    '--mcp-config', claudeMcpConfigPath,
    '--strict-mcp-config',
    '--allowedTools', claudeMcpAllowRules().join(','),
  ]
}

function writeGeminiWorkspaceConfig(ctx) {
  const home = homeDir()
  const geminiDir = path.join(ctx.workspacePath, '.gemini')
  fs.mkdirSync(geminiDir, { recursive: true, mode: 0o700 })
  const geminiSettingsPath = path.join(geminiDir, 'settings.json')
  const geminiSettings = readJsonFile(geminiSettingsPath)
  const userSettings = readJsonFile(path.join(home, '.gemini', 'settings.json'))
  geminiSettings.mcpServers = {
    ...(geminiSettings.mcpServers || {}),
    kubespade: { ...ctx.stdioServer, trust: true, allowTools: [...KUBESPADE_MCP_TOOLS] },
  }
  // Project settings without auth.selectedType force a per-project login,
  // even when ~/.gemini already has oauth_creds + selectedType.
  if (userSettings.security && !geminiSettings.security) {
    geminiSettings.security = userSettings.security
  } else if (userSettings.security?.auth && !geminiSettings.security?.auth) {
    geminiSettings.security = { ...(geminiSettings.security || {}), auth: userSettings.security.auth }
  }
  fs.writeFileSync(geminiSettingsPath, JSON.stringify(geminiSettings, null, 2), { mode: 0o600 })
  ensureGeminiTrustedFolder(ctx.workspacePath)
}

function writeCodexWorkspaceConfig(ctx) {
  // Project-scoped config (trusted projects only). Auth stays in ~/.codex.
  const codexDir = path.join(ctx.workspacePath, '.codex')
  fs.mkdirSync(codexDir, { recursive: true, mode: 0o700 })
  const envLines = Object.entries(ctx.serverEnv)
    .map(([k, v]) => `${k} = ${JSON.stringify(String(v))}`)
    .join('\n')
  const enabledTools = KUBESPADE_MCP_TOOLS.map((t) => JSON.stringify(t)).join(', ')
  const toolApproval = KUBESPADE_MCP_TOOLS.flatMap((t) => [
    `[mcp_servers.kubespade.tools.${t}]`,
    'approval_mode = "approve"',
    '',
  ])
  const toml = [
    '# KubeSpade ephemeral workspace — MCP + quiet approvals.',
    '# Cluster writes still require in-app Approve via KUBESPADE_APPROVAL_*.',
    'approval_policy = "never"',
    'sandbox_mode = "workspace-write"',
    '',
    '[mcp_servers.kubespade]',
    `command = ${JSON.stringify(ctx.backendPath)}`,
    'args = ["mcp"]',
    'enabled = true',
    'startup_timeout_sec = 30',
    'tool_timeout_sec = 120',
    `enabled_tools = [${enabledTools}]`,
    'default_tools_approval_mode = "approve"',
    '',
    ...toolApproval,
    '[mcp_servers.kubespade.env]',
    envLines,
    '',
  ].join('\n')
  fs.writeFileSync(path.join(codexDir, 'config.toml'), toml, { mode: 0o600 })
  ensureCodexTrustedProject(ctx.workspacePath)
}

function spawnCodexArgs() {
  // Project .codex/config.toml sets the same; CLI flags cover older builds.
  // MCP tool auto-approve is in config; cluster writes still hit in-app Approve.
  return ['--ask-for-approval', 'never', '--sandbox', 'workspace-write']
}

function writeCopilotWorkspaceConfig(ctx) {
  // Copilot CLI: project .mcp.json (+ optional --additional-mcp-config).
  // Requires type: "local" (stdio). Folder trust gates project MCP.
  const body = {
    mcpServers: {
      kubespade: {
        type: 'local',
        command: ctx.backendPath,
        args: ['mcp'],
        env: ctx.serverEnv,
        tools: ['*'],
      },
    },
  }
  ctx.copilotMcpConfigPath = path.join(ctx.workspacePath, '.mcp.json')
  fs.writeFileSync(ctx.copilotMcpConfigPath, JSON.stringify(body, null, 2), { mode: 0o600 })
  const copilotDir = path.join(ctx.workspacePath, '.copilot')
  fs.mkdirSync(copilotDir, { recursive: true, mode: 0o700 })
  fs.writeFileSync(
    path.join(copilotDir, 'mcp-config.json'),
    JSON.stringify(body, null, 2),
    { mode: 0o600 },
  )
  ensureCopilotTrustedFolder(ctx.workspacePath)
}

function spawnCopilotArgs({ copilotMcpConfigPath }) {
  if (copilotMcpConfigPath) {
    // --allow-tool=kubespade is this MCP server only (not --allow-all-tools).
    return ['--additional-mcp-config', `@${copilotMcpConfigPath}`, '--allow-tool', 'kubespade']
  }
  return ['--allow-tool', 'kubespade']
}

function writeCursorWorkspaceConfig(ctx) {
  // Cursor Agent CLI reads project .cursor/mcp.json (same shape as IDE).
  const cursorDir = path.join(ctx.workspacePath, '.cursor')
  fs.mkdirSync(cursorDir, { recursive: true, mode: 0o700 })
  fs.writeFileSync(
    path.join(cursorDir, 'mcp.json'),
    JSON.stringify(ctx.mcpConfigBody, null, 2),
    { mode: 0o600 },
  )
  writeCursorMcpApprovals(ctx.workspacePath, ctx.stdioServer)
  writeCursorCliPermissions(ctx.workspacePath)
}

function spawnCursorArgs({ workspacePath }) {
  // --trust skips workspace TUI. --approve-mcps skips MCP server Approve/Quit.
  // --force + Mcp(kubespade:*) skip per-tool prompts. Writes still need in-app Approve.
  const args = ['--trust', '--approve-mcps', '--force']
  if (process.platform !== 'win32' && workspacePath) {
    args.push('--workspace', workspacePath)
  }
  return args
}

const AGENT_BEHAVIORS = {
  claude: { writeConfig: writeClaudeWorkspaceConfig, spawnArgs: spawnClaudeArgs },
  gemini: { writeConfig: writeGeminiWorkspaceConfig, spawnArgs: () => [] },
  codex: { writeConfig: writeCodexWorkspaceConfig, spawnArgs: spawnCodexArgs },
  copilot: { writeConfig: writeCopilotWorkspaceConfig, spawnArgs: spawnCopilotArgs },
  cursor: { writeConfig: writeCursorWorkspaceConfig, spawnArgs: spawnCursorArgs },
}

for (const def of AGENT_DEFS) {
  const behavior = AGENT_BEHAVIORS[def.id]
  if (behavior) Object.assign(def, behavior)
}

/**
 * Write client configs only for the selected CLI.
 * Writing .gemini/ for a Claude session makes Gemini treat the folder as a new
 * project (auth wizard) and leftover Gemini PTYs look like "Claude showing Gemini".
 */
function writeMcpClientConfigs({ workspacePath, backendPath, approvalUrl, approvalToken, agentId, pathEnv }) {
  const serverEnv = mcpChildEnv(pathEnv, approvalUrl, approvalToken)
  const stdioServer = {
    command: backendPath,
    args: ['mcp'],
    env: serverEnv,
  }
  const mcpConfigBody = { mcpServers: { kubespade: stdioServer } }
  const claudeMcpConfigPath = path.join(workspacePath, '.kubespade-mcp.json')
  fs.writeFileSync(claudeMcpConfigPath, JSON.stringify(mcpConfigBody, null, 2), { mode: 0o600 })

  const ctx = {
    workspacePath,
    backendPath,
    serverEnv,
    stdioServer,
    mcpConfigBody,
    claudeMcpConfigPath,
    pathEnv,
    copilotMcpConfigPath: null,
  }

  // Default / unset → Claude project settings (same as agentId === 'claude' || !agentId).
  const id = agentId || 'claude'
  const def = AGENT_DEFS.find(d => d.id === id)
  if (def && typeof def.writeConfig === 'function') {
    def.writeConfig(ctx)
  }

  return {
    claudeMcpConfigPath,
    copilotMcpConfigPath: ctx.copilotMcpConfigPath,
    workspacePath,
  }
}

/** Spawn argv extras so the chosen CLI loads KubeSpade tools without interactive MCP prompts. */
function spawnArgsForAgent(agentId, meta) {
  const def = AGENT_DEFS.find(d => d.id === agentId)
  if (def && typeof def.spawnArgs === 'function') {
    return def.spawnArgs(meta || {})
  }
  return []
}

module.exports = {
  AGENT_DEFS,
  detectAiAgents,
  writeMcpClientConfigs,
  spawnArgsForAgent,
  ensureCodexTrustedProject,
}
