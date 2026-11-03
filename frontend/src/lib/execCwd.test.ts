import { describe, expect, it } from 'vitest'
import { consumeCwdOsc, joinLocalPath, remoteBasename, shortenPodPath } from './execCwd'

describe('consumeCwdOsc', () => {
  it('strips OSC and returns cwd', () => {
    const { text, cwd, carry } = consumeCwdOsc('hi\x1b]7777;cwd=/var/www\x07 there')
    expect(text).toBe('hi there')
    expect(cwd).toBe('/var/www')
    expect(carry).toBe('')
  })

  it('handles ST terminator', () => {
    const { cwd } = consumeCwdOsc('\x1b]7777;cwd=/tmp\x1b\\')
    expect(cwd).toBe('/tmp')
  })

  it('buffers incomplete OSC across chunks', () => {
    const a = consumeCwdOsc('pre\x1b]7777;cwd=/va')
    expect(a.text).toBe('pre')
    expect(a.cwd).toBeUndefined()
    expect(a.carry).toBe('\x1b]7777;cwd=/va')
    const b = consumeCwdOsc('r/www\x07ok', a.carry)
    expect(b.text).toBe('ok')
    expect(b.cwd).toBe('/var/www')
    expect(b.carry).toBe('')
  })

  it('ignores non-absolute paths', () => {
    const { text, cwd } = consumeCwdOsc('\x1b]7777;cwd=relative\x07x')
    expect(text).toBe('x')
    expect(cwd).toBeUndefined()
  })
})

describe('helpers', () => {
  it('shortenPodPath', () => {
    expect(shortenPodPath('/a/b')).toBe('/a/b')
    expect(shortenPodPath('/very/long/path/to/deep/nested/app', 20)).toMatch(/^…/)
  })

  it('joinLocalPath and remoteBasename', () => {
    expect(joinLocalPath('/tmp/out', 'app')).toBe('/tmp/out/app')
    expect(joinLocalPath('C:\\Users\\x', 'f.txt')).toBe('C:\\Users\\x\\f.txt')
    expect(remoteBasename('/var/www/app/')).toBe('app')
    expect(remoteBasename('/')).toBe('root')
  })
})
