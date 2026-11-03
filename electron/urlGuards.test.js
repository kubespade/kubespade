'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const {
  isLoopbackAppURL,
  isPortForwardURL,
  isSafeExternalURL,
} = require('./urlGuards')

const APP_PORT = 3847

describe('isLoopbackAppURL', () => {
  it('allows loopback on the app port', () => {
    assert.equal(isLoopbackAppURL(`http://127.0.0.1:${APP_PORT}/`, APP_PORT), true)
    assert.equal(isLoopbackAppURL(`http://localhost:${APP_PORT}/foo`, APP_PORT), true)
    assert.equal(isLoopbackAppURL(`http://[::1]:${APP_PORT}/`, APP_PORT), true)
  })

  it('rejects other ports and hosts', () => {
    assert.equal(isLoopbackAppURL('http://127.0.0.1:9999/', APP_PORT), false)
    assert.equal(isLoopbackAppURL('http://example.com/', APP_PORT), false)
    assert.equal(isLoopbackAppURL('https://127.0.0.1:443/', APP_PORT), false)
  })

  it('rejects credentials and bad URLs', () => {
    assert.equal(isLoopbackAppURL(`http://user:pass@127.0.0.1:${APP_PORT}/`, APP_PORT), false)
    assert.equal(isLoopbackAppURL('not a url', APP_PORT), false)
  })
})

describe('isPortForwardURL', () => {
  it('allows loopback with an explicit non-app port', () => {
    assert.equal(isPortForwardURL('http://127.0.0.1:8080/', APP_PORT), true)
    assert.equal(isPortForwardURL('http://localhost:8443/path', APP_PORT), true)
  })

  it('rejects the app port and missing port', () => {
    assert.equal(isPortForwardURL(`http://127.0.0.1:${APP_PORT}/`, APP_PORT), false)
    assert.equal(isPortForwardURL('http://127.0.0.1/', APP_PORT), false)
  })

  it('rejects credentials and non-loopback', () => {
    assert.equal(isPortForwardURL('http://user@127.0.0.1:8080/', APP_PORT), false)
    assert.equal(isPortForwardURL('http://example.com:8080/', APP_PORT), false)
  })
})

describe('isSafeExternalURL', () => {
  it('allows https and mailto', () => {
    assert.equal(isSafeExternalURL('https://kubespade.com/docs'), true)
    assert.equal(isSafeExternalURL('mailto:support@example.com'), true)
  })

  it('allows loopback http for OAuth callbacks', () => {
    assert.equal(isSafeExternalURL('http://127.0.0.1:8765/callback'), true)
    assert.equal(isSafeExternalURL('http://localhost:8765/'), true)
  })

  it('rejects other http and schemes', () => {
    assert.equal(isSafeExternalURL('http://evil.example/'), false)
    assert.equal(isSafeExternalURL('file:///etc/passwd'), false)
    assert.equal(isSafeExternalURL('javascript:alert(1)'), false)
  })
})
