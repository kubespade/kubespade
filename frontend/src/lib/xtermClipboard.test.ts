import { describe, expect, it } from 'vitest'
import { decodeOsc52Payload } from './xtermClipboard'

/** UTF-8 string → base64 without Node `Buffer` (frontend tsc has no @types/node). */
function utf8ToBase64(s: string): string {
  const bytes = new TextEncoder().encode(s)
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!)
  return btoa(bin)
}

describe('decodeOsc52Payload', () => {
  it('decodes UTF-8 Cyrillic (not Latin-1 from bare atob)', () => {
    const b64 = utf8ToBase64('Привет')
    expect(decodeOsc52Payload(b64)).toBe('Привет')
    // Bare atob would yield mojibake code units, not this string:
    expect(atob(b64)).not.toBe('Привет')
  })

  it('decodes CJK and emoji', () => {
    const s = '轮询 ✅'
    expect(decodeOsc52Payload(utf8ToBase64(s))).toBe(s)
  })

  it('returns empty for query / empty payload', () => {
    expect(decodeOsc52Payload('')).toBe('')
    expect(decodeOsc52Payload('?')).toBe('')
  })
})
