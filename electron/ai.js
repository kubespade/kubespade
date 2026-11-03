'use strict'

const fs = require('fs')
const path = require('path')
const http = require('http')
const { detectAiAgents, writeMcpClientConfigs, spawnArgsForAgent } = require('./aiAgents')
const { createApprovalServer } = require('./approvalServer')
const { homeDir } = require('./env')

/** Win32 ConPTY: chunk large pastes so Ink TUIs do not drop input. */
const WIN_PTY_PASTE_CHUNK = 64
const WIN_PTY_PASTE_CHUNK_MIN = 8

let pty = null
let ptyLoadError = ''

/** Load node-pty on first AI use — a bad native .node must not crash app startup. */
function ensurePty() {
  if (pty) return pty
  if (ptyLoadError) return null
  try {
    pty = require('node-pty')
    return pty
  } catch (err) {
    ptyLoadError = err && err.message ? err.message : String(err)
    return null
  }
}

function psSingleQuote(s) {
  return `'${String(s).replace(/'/g, "''")}'`
}

/**
 * Claude / Gemini / Codex / Copilot / Cursor Ink TUIs drop keys and paste
 * under Electron ConPTY. Same host that works for Cursor: PowerShell as the
 * PTY process + winpty, argv like a real console.
 */
function spawnPtyProcess(ptyMod, { agent, spawnFile, agentArgs, spawnOpts }) {
  if (process.platform === 'win32') {
    delete spawnOpts.env.TERM
    delete spawnOpts.env.COLORTERM
    if (agent.id === 'cursor') delete spawnOpts.env.BROWSER
    const root = process.env.SystemRoot || process.env.SYSTEMROOT || 'C:\\Windows'
    const ps = path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    const inner = `& ${psSingleQuote(spawnFile)}${agentArgs.length ? ` ${agentArgs.map(psSingleQuote).join(' ')}` : ''}`
    const psArgs = ['-NoLogo', '-NoProfile', '-Command', inner]
    const file = fs.existsSync(ps) ? ps : 'powershell.exe'
    const trySpawn = (useConpty) => ptyMod.spawn(file, psArgs, {
      ...spawnOpts,
      useConpty,
      conptyInheritCursor: false,
    })
    let winptyErr
    try {
      return trySpawn(false)
    } catch (err) {
      winptyErr = err
    }
    try {
      return trySpawn(true)
    } catch (err) {
      const winptyMsg = winptyErr && winptyErr.message ? winptyErr.message : String(winptyErr || '')
      const conptyMsg = err && err.message ? err.message : String(err)
      const missing = /conpty\.node|pty\.node|winpty/i.test(`${winptyMsg}\n${conptyMsg}`)
      const hint = missing
        ? ' Rebuild Setup/Portable on this Windows arch (x64 vs ARM). A build from macOS omits node-pty natives and the AI tab cannot start.'
        : ''
      throw new Error(`${conptyMsg}${winptyMsg ? ` (winpty: ${winptyMsg})` : ''}${hint}`)
    }
  }
  return ptyMod.spawn(spawnFile, agentArgs, spawnOpts)
}

function resolveWinNativeExe(filePath) {
  if (process.platform !== 'win32' || !filePath) return filePath
  if (/\.exe$/i.test(filePath)) return filePath
  const asExe = filePath.replace(/\.(cmd|bat|ps1)$/i, '.exe')
  if (asExe !== filePath && fs.existsSync(asExe)) return asExe
  const sibling = path.join(path.dirname(filePath), `${path.basename(filePath).replace(/\.(cmd|bat|ps1)$/i, '')}.exe`)
  if (sibling !== filePath && fs.existsSync(sibling)) return sibling
  return filePath
}

function httpJSON(port, token, method, apiPath, body) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : Buffer.from(JSON.stringify(body))
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: apiPath,
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(payload ? {
          'Content-Type': 'application/json',
          'Content-Length': payload.length,
        } : {}),
      },
      timeout: 30_000,
    }, res => {
      const chunks = []
      res.on('data', d => chunks.push(d))
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        let data = null
        try { data = text ? JSON.parse(text) : null } catch { data = { raw: text } }
        if (res.statusCode >= 400) {
          reject(new Error((data && data.error) || text || `HTTP ${res.statusCode}`))
          return
        }
        resolve(data)
      })
    })
    req.on('timeout', () => { req.destroy(); reject(new Error('backend request timed out')) })
    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}

/**
 * @param {{
 *   getPort: () => number,
 *   getToken: () => string,
 *   getPathEnv: () => string,
 *   getBackendPath: () => string,
 *   sendToRenderer: (channel: string, payload: unknown) => void,
 * }} deps
 */
function createAiSession(deps) {
  /** @type {import('node-pty').IPty | null} */
  let proc = null
  let ptyGen = 0
  const approval = createApprovalServer({
    sendToRenderer: deps.sendToRenderer,
  })
  const stopApprovalServer = () => approval.stop()
  const startApprovalServer = () => approval.start()
  const respondApproval = (id, approved, message) => approval.respond(id, approved, message)

  async function wipeWorkspace() {
    const port = deps.getPort()
    const token = deps.getToken()
    if (!port || !token) return
    try {
      await httpJSON(port, token, 'DELETE', '/api/ai/workspace')
    } catch {
      // best-effort
    }
  }

  function stopPty() {
    ptyGen += 1
    if (!proc) return
    const p = proc
    proc = null
    const pid = p.pid
    try { p.kill('SIGKILL') } catch { /* ignore */ }
    if (pid) {
      try { process.kill(pid, 'SIGKILL') } catch { /* ignore */ }
      try { process.kill(-pid, 'SIGKILL') } catch { /* ignore */ }
    }
  }

  async function stop() {
    stopPty()
    stopApprovalServer()
    await wipeWorkspace()
  }

  function detect() {
    return detectAiAgents(deps.getPathEnv())
  }

  /** @param {ReturnType<typeof detectAiAgents>} detected @param {string | undefined} clientId */
  function pickAgent(detected, clientId) {
    if (!detected.agents.length) {
      return {
        ok: false,
        error: 'No supported AI CLI found on this system. Install Claude Code, Gemini CLI, Codex CLI, GitHub Copilot, or Cursor Agent and ensure it is on your PATH.',
        detect: detected,
      }
    }
    if (clientId) {
      const match = detected.agents.find(a => a.id === clientId)
      if (!match) {
        return {
          ok: false,
          error: `AI client “${clientId}” is not installed.`,
          detect: detected,
        }
      }
      return { ok: true, agent: match, detect: detected }
    }
    if (detected.agents.length > 1) {
      return {
        ok: false,
        needsChoice: true,
        error: 'Multiple AI clients found. Choose one to continue.',
        detect: detected,
      }
    }
    return { ok: true, agent: detected.agents[0], detect: detected }
  }

  /** @param {ReturnType<typeof detectAiAgents>} detected */
  function requirePty(detected) {
    const ptyMod = ensurePty()
    if (ptyMod) return { ok: true, ptyMod }
    let msg = ptyLoadError
      ? `Local terminal support (node-pty) failed to load: ${ptyLoadError}`
      : 'Local terminal support (node-pty) is unavailable in this build.'
    if (/invalid ELF header|ELF/i.test(ptyLoadError || '')) {
      msg += ' This Linux package was not built on a matching Linux host (often a Mac-packaged .deb). Reinstall a build from Ubuntu x64/arm64: ./build-linux.sh'
    } else if (process.platform === 'win32' && /conpty\.node|pty\.node|Cannot find module/i.test(ptyLoadError || '')) {
      msg += ' Rebuild Setup/Portable on this Windows arch (x64 vs ARM). A build from macOS omits node-pty natives and the AI tab cannot start.'
    }
    return { ok: false, error: msg, detect: detected }
  }

  /** @param {ReturnType<typeof detectAiAgents>} detected */
  function requireBackend(detected) {
    const port = deps.getPort()
    const token = deps.getToken()
    if (!port || !token) {
      return { ok: false, error: 'Backend is not ready.', detect: detected }
    }
    const backendPath = deps.getBackendPath()
    if (!backendPath || !fs.existsSync(backendPath)) {
      return { ok: false, error: 'KubeSpade backend binary not found (needed for MCP).', detect: detected }
    }
    return { ok: true, port, token, backendPath }
  }

  /**
   * @param {number} port
   * @param {string} token
   * @param {ReturnType<typeof detectAiAgents>} detected
   */
  async function createWorkspace(port, token, detected) {
    try {
      const workspace = await httpJSON(port, token, 'POST', '/api/ai/workspace')
      return { ok: true, workspace }
    } catch (err) {
      return { ok: false, error: err.message || String(err), detect: detected }
    }
  }

  /** @param {ReturnType<typeof detectAiAgents>} detected */
  async function beginApproval(detected) {
    try {
      const info = await startApprovalServer()
      return { ok: true, approval: info }
    } catch (err) {
      await wipeWorkspace()
      return { ok: false, error: 'Failed to start approval server: ' + (err.message || err), detect: detected }
    }
  }

  /**
   * @param {{
   *   workspace: { path: string, shellKubeconfig?: string },
   *   backendPath: string,
   *   approval: { url: string, token: string },
   *   agentId: string,
   *   pathEnv: string,
   *   detected: ReturnType<typeof detectAiAgents>,
   * }} args
   */
  async function writeMcpConfig(args) {
    try {
      const mcpMeta = writeMcpClientConfigs({
        workspacePath: args.workspace.path,
        backendPath: args.backendPath,
        approvalUrl: args.approval.url,
        approvalToken: args.approval.token,
        agentId: args.agentId,
        pathEnv: args.pathEnv,
      })
      return { ok: true, mcpMeta }
    } catch (err) {
      stopApprovalServer()
      await wipeWorkspace()
      return { ok: false, error: 'Failed to write MCP config: ' + (err.message || err), detect: args.detected }
    }
  }

  /**
   * @param {{
   *   ptyMod: import('node-pty'),
   *   agent: { id: string, path: string },
   *   workspace: { path: string, shellKubeconfig?: string, clusterCount?: number, clusters?: unknown[] },
   *   mcpMeta: unknown,
   *   pathEnv: string,
   *   cols: number,
   *   rows: number,
   *   detected: ReturnType<typeof detectAiAgents>,
   * }} args
   */
  async function spawnAgentSession(args) {
    const shellKubeconfig = args.workspace.shellKubeconfig || path.join(args.workspace.path, 'kubeconfig.empty')
    const env = {
      ...process.env,
      PATH: args.pathEnv,
      HOME: homeDir(),
      USERPROFILE: process.env.USERPROFILE || homeDir(),
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      // Keep UTF-8 for pbcopy / CLI clipboard helpers (Cyrillic etc. from AI TUIs).
      LANG: process.env.LANG || 'en_US.UTF-8',
      LC_ALL: process.env.LC_ALL || process.env.LANG || 'en_US.UTF-8',
      // Don't inherit Cursor/VS Code TERM_PROGRAM — Claude Code special-cases those.
      TERM_PROGRAM: 'kubespade',
      // Empty kubeconfig on purpose — cluster access only via MCP, not shell kubectl / ~/.kube/config.
      KUBECONFIG: shellKubeconfig,
      BROWSER: process.env.BROWSER || (process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open'),
    }
    delete env.TERM_PROGRAM_VERSION
    // Interactive CLIs (Gemini OAuth) break when CI is set.
    delete env.CI
    delete env.CONTINUOUS_INTEGRATION
    if (args.agent.id === 'gemini') {
      env.GEMINI_CLI_TRUST_WORKSPACE = 'true'
    }

    const agentArgs = spawnArgsForAgent(args.agent.id, args.mcpMeta || {})
    const gen = ++ptyGen
    const spawnFile = resolveWinNativeExe(args.agent.path)

    try {
      proc = spawnPtyProcess(args.ptyMod, {
        agent: args.agent,
        spawnFile,
        agentArgs,
        spawnOpts: {
          name: 'xterm-256color',
          cols: Math.max(40, args.cols | 0),
          rows: Math.max(10, args.rows | 0),
          cwd: args.workspace.path,
          env,
        },
      })
    } catch (err) {
      stopApprovalServer()
      await wipeWorkspace()
      let msg = err.message || String(err)
      if (/conpty\.node|pty\.node/i.test(msg) && !/Rebuild Setup/i.test(msg)) {
        msg += ' Rebuild Setup/Portable on this Windows arch (x64 vs ARM). A build from macOS omits node-pty natives.'
      }
      return { ok: false, error: msg, detect: args.detected }
    }

    proc.onData(data => {
      if (gen !== ptyGen) return
      deps.sendToRenderer('ai:output', data)
    })
    proc.onExit(({ exitCode, signal }) => {
      if (gen !== ptyGen) return
      proc = null
      deps.sendToRenderer('ai:exit', { exitCode, signal })
      stopApprovalServer()
      wipeWorkspace().catch(() => {})
    })

    return {
      ok: true,
      detect: args.detected,
      agent: args.agent,
      clusterCount: args.workspace.clusterCount || 0,
      clusters: args.workspace.clusters || [],
      workspace: args.workspace.path,
    }
  }

  /**
   * @param {{ cols?: number, rows?: number, clientId?: string }} opts
   */
  async function start(opts = {}) {
    if (proc) {
      stopPty()
      stopApprovalServer()
      await wipeWorkspace()
    }

    // detect → pick agent → pty → backend → workspace → approval → mcp → spawn
    const pathEnv = deps.getPathEnv()
    const detected = detectAiAgents(pathEnv)

    const picked = pickAgent(detected, opts.clientId)
    if (!picked.ok) return picked

    const ptyReady = requirePty(detected)
    if (!ptyReady.ok) return ptyReady

    const backend = requireBackend(detected)
    if (!backend.ok) return backend

    const ws = await createWorkspace(backend.port, backend.token, detected)
    if (!ws.ok) return ws

    const approval = await beginApproval(detected)
    if (!approval.ok) return approval

    const mcp = await writeMcpConfig({
      workspace: ws.workspace,
      backendPath: backend.backendPath,
      approval: approval.approval,
      agentId: picked.agent.id,
      pathEnv,
      detected,
    })
    if (!mcp.ok) return mcp

    return await spawnAgentSession({
      ptyMod: ptyReady.ptyMod,
      agent: picked.agent,
      workspace: ws.workspace,
      mcpMeta: mcp.mcpMeta,
      pathEnv,
      cols: opts.cols || 120,
      rows: opts.rows || 30,
      detected,
    })
  }

  function write(data) {
    if (!proc) return false
    const s = String(data)
    try {
      // ConPTY/Ink often drop a single large paste; small writes land.
      if (process.platform === 'win32' && s.length > WIN_PTY_PASTE_CHUNK_MIN) {
        const n = WIN_PTY_PASTE_CHUNK
        for (let i = 0; i < s.length; i += n) proc.write(s.slice(i, i + n))
        return true
      }
      proc.write(s)
      return true
    } catch {
      return false
    }
  }

  function resize(cols, rows) {
    if (!proc) return false
    const c = Math.max(40, cols | 0)
    const r = Math.max(10, rows | 0)
    if (proc.cols === c && proc.rows === r) return true
    try {
      proc.resize(c, r)
      return true
    } catch {
      return false
    }
  }

  return { detect, start, write, resize, stop, respondApproval }
}

module.exports = { createAiSession, detectAiAgents }
