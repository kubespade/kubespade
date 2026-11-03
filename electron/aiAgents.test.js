'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const {
  writeMcpClientConfigs,
  spawnArgsForAgent,
  ensureCodexTrustedProject,
} = require('./aiAgents')

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

test('spawnArgsForAgent(codex) skips interactive approvals', () => {
  assert.deepEqual(
    spawnArgsForAgent('codex', {}),
    ['--ask-for-approval', 'never', '--sandbox', 'workspace-write'],
  )
})

test('spawnArgsForAgent(claude) loads MCP config + allowlist', () => {
  assert.deepEqual(
    spawnArgsForAgent('claude', { claudeMcpConfigPath: '/tmp/mcp.json' }),
    [
      '--mcp-config', '/tmp/mcp.json',
      '--strict-mcp-config',
      '--allowedTools',
      'mcp__kubespade,mcp__kubespade__*,mcp__kubespade__kubespade_list_clusters,mcp__kubespade__kubespade_get,mcp__kubespade__kubespade_describe,mcp__kubespade__kubespade_logs,mcp__kubespade__kubespade_apply,mcp__kubespade__kubespade_delete',
    ],
  )
})

test('spawnArgsForAgent(cursor) trusts workspace without interactive MCP', () => {
  const args = spawnArgsForAgent('cursor', { workspacePath: '/tmp/ws' })
  assert.ok(args.includes('--trust'))
  assert.ok(args.includes('--approve-mcps'))
  assert.ok(args.includes('--force'))
  if (process.platform !== 'win32') {
    assert.deepEqual(args.slice(-2), ['--workspace', '/tmp/ws'])
  }
})

test('spawnArgsForAgent(copilot) allows kubespade tool', () => {
  assert.deepEqual(
    spawnArgsForAgent('copilot', { copilotMcpConfigPath: '/tmp/.mcp.json' }),
    ['--additional-mcp-config', '@/tmp/.mcp.json', '--allow-tool', 'kubespade'],
  )
  assert.deepEqual(spawnArgsForAgent('copilot', {}), ['--allow-tool', 'kubespade'])
})

test('spawnArgsForAgent(gemini) needs no extra argv', () => {
  assert.deepEqual(spawnArgsForAgent('gemini', {}), [])
})

test('ensureCodexTrustedProject appends projects trust block', () => {
  const home = tmpDir('ks-codex-home-')
  const workspace = tmpDir('ks-codex-ws-')
  const prevHome = process.env.HOME
  const prevProfile = process.env.USERPROFILE
  process.env.HOME = home
  process.env.USERPROFILE = home
  try {
    ensureCodexTrustedProject(workspace)
    const raw = fs.readFileSync(path.join(home, '.codex', 'config.toml'), 'utf8')
    const header = `[projects.${JSON.stringify(path.resolve(workspace))}]`
    assert.ok(raw.includes(header), 'expected projects header')
    assert.ok(raw.includes('trust_level = "trusted"'))

    // Idempotent — second call does not duplicate the section.
    ensureCodexTrustedProject(workspace)
    const again = fs.readFileSync(path.join(home, '.codex', 'config.toml'), 'utf8')
    assert.equal(again.split(header).length - 1, 1)
  } finally {
    process.env.HOME = prevHome
    process.env.USERPROFILE = prevProfile
  }
})

test('writeMcpClientConfigs(codex) writes project MCP + trusts workspace', () => {
  const home = tmpDir('ks-codex-home2-')
  const workspace = tmpDir('ks-codex-ws2-')
  const prevHome = process.env.HOME
  const prevProfile = process.env.USERPROFILE
  process.env.HOME = home
  process.env.USERPROFILE = home
  try {
    const backendPath = path.join(workspace, 'fake-backend')
    fs.writeFileSync(backendPath, '#!/bin/sh\n', { mode: 0o755 })
    writeMcpClientConfigs({
      workspacePath: workspace,
      backendPath,
      approvalUrl: 'http://127.0.0.1:9',
      approvalToken: 'tok',
      agentId: 'codex',
      pathEnv: process.env.PATH,
    })
    const toml = fs.readFileSync(path.join(workspace, '.codex', 'config.toml'), 'utf8')
    assert.match(toml, /\[mcp_servers\.kubespade\]/)
    assert.match(toml, /default_tools_approval_mode = "approve"/)
    assert.match(toml, /approval_policy = "never"/)
    assert.match(toml, /KUBESPADE_APPROVAL_TOKEN = "tok"/)
    const userCfg = fs.readFileSync(path.join(home, '.codex', 'config.toml'), 'utf8')
    assert.match(userCfg, /trust_level = "trusted"/)
  } finally {
    process.env.HOME = prevHome
    process.env.USERPROFILE = prevProfile
  }
})
