'use strict'

const http = require('http')
const crypto = require('crypto')

const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000

/**
 * Loopback HTTP server that pauses MCP write tools until the renderer responds.
 * @param {{ sendToRenderer: (channel: string, payload: unknown) => void }} deps
 */
function createApprovalServer(deps) {
  /** @type {http.Server | null} */
  let server = null
  let token = ''
  /** @type {Map<string, { resolve: (v: any) => void, timer: NodeJS.Timeout }>} */
  const pending = new Map()

  function stop() {
    for (const [id, p] of pending) {
      clearTimeout(p.timer)
      p.resolve({ approved: false, message: 'AI session closed' })
      pending.delete(id)
    }
    if (server) {
      try { server.close() } catch { /* ignore */ }
      server = null
    }
    token = ''
  }

  function start() {
    stop()
    token = crypto.randomBytes(24).toString('hex')
    return new Promise((resolve, reject) => {
      const httpServer = http.createServer((req, res) => {
        const auth = String(req.headers.authorization || '')
        if (auth !== `Bearer ${token}`) {
          res.writeHead(401, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ approved: false, message: 'unauthorized' }))
          return
        }
        if (req.method === 'POST' && req.url === '/approve') {
          const chunks = []
          req.on('data', c => chunks.push(c))
          req.on('end', () => {
            let body = {}
            try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') } catch { body = {} }
            const id = crypto.randomUUID()
            const payload = {
              id,
              tool: body.tool || 'write',
              summary: body.summary || 'Write operation',
              detail: body.detail || '',
            }
            const timer = setTimeout(() => {
              const p = pending.get(id)
              if (!p) return
              pending.delete(id)
              p.resolve({ approved: false, message: 'Approval timed out' })
            }, APPROVAL_TIMEOUT_MS)
            pending.set(id, {
              resolve: (result) => {
                res.writeHead(200, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify(result))
              },
              timer,
            })
            deps.sendToRenderer('ai:approval-needed', payload)
          })
          return
        }
        res.writeHead(404)
        res.end()
      })
      httpServer.listen(0, '127.0.0.1', () => {
        server = httpServer
        const addr = httpServer.address()
        const port = addr && typeof addr === 'object' ? addr.port : 0
        resolve({ url: `http://127.0.0.1:${port}`, token })
      })
      httpServer.on('error', reject)
    })
  }

  function respond(id, approved, message) {
    const p = pending.get(id)
    if (!p) return false
    clearTimeout(p.timer)
    pending.delete(id)
    p.resolve({
      approved: !!approved,
      message: message || (approved ? 'approved' : 'User denied the write operation in KubeSpade.'),
    })
    return true
  }

  return { start, stop, respond }
}

module.exports = {
  createApprovalServer,
  APPROVAL_TIMEOUT_MS,
}
