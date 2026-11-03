'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const http = require('http')
const { createApprovalServer } = require('./approvalServer')

function postJSON(url, token, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const req = http.request({
      hostname: u.hostname,
      port: u.port,
      path: u.pathname,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    }, (res) => {
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8')
        let json = null
        try { json = JSON.parse(raw || 'null') } catch { json = raw }
        resolve({ status: res.statusCode, body: json })
      })
    })
    req.on('error', reject)
    req.write(JSON.stringify(body))
    req.end()
  })
}

describe('createApprovalServer', () => {
  it('rejects unauthorized requests', async () => {
    const events = []
    const server = createApprovalServer({
      sendToRenderer: (ch, payload) => events.push({ ch, payload }),
    })
    const { url, token } = await server.start()
    try {
      const res = await postJSON(`${url}/approve`, 'wrong', { tool: 'write' })
      assert.equal(res.status, 401)
      assert.equal(res.body.approved, false)
      assert.equal(events.length, 0)
    } finally {
      server.stop()
    }
    void token
  })

  it('notifies renderer and resolves on respond', async () => {
    const events = []
    const server = createApprovalServer({
      sendToRenderer: (ch, payload) => events.push({ ch, payload }),
    })
    const { url, token } = await server.start()
    try {
      const pending = postJSON(`${url}/approve`, token, {
        tool: 'apply',
        summary: 'Apply manifest',
        detail: 'ns/foo',
      })
      // Wait until the renderer was notified.
      await new Promise((resolve, reject) => {
        const t0 = Date.now()
        const tick = () => {
          if (events.length) return resolve()
          if (Date.now() - t0 > 2000) return reject(new Error('no approval-needed event'))
          setTimeout(tick, 10)
        }
        tick()
      })
      assert.equal(events.length, 1)
      assert.equal(events[0].ch, 'ai:approval-needed')
      assert.equal(events[0].payload.tool, 'apply')
      assert.equal(events[0].payload.summary, 'Apply manifest')
      assert.ok(events[0].payload.id)

      const ok = server.respond(events[0].payload.id, true, 'ok')
      assert.equal(ok, true)
      const res = await pending
      assert.equal(res.status, 200)
      assert.deepEqual(res.body, { approved: true, message: 'ok' })
    } finally {
      server.stop()
    }
  })

  it('stop rejects outstanding approvals', async () => {
    const events = []
    const server = createApprovalServer({
      sendToRenderer: (ch, payload) => events.push({ ch, payload }),
    })
    const { url, token } = await server.start()
    const pending = postJSON(`${url}/approve`, token, { tool: 'write' })
    await new Promise((resolve, reject) => {
      const t0 = Date.now()
      const tick = () => {
        if (events.length) return resolve()
        if (Date.now() - t0 > 2000) return reject(new Error('no approval-needed event'))
        setTimeout(tick, 10)
      }
      tick()
    })
    server.stop()
    const res = await pending
    assert.equal(res.status, 200)
    assert.equal(res.body.approved, false)
    assert.match(String(res.body.message), /closed/i)
  })
})
