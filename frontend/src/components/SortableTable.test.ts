import { describe, expect, it } from 'vitest'

/** Mirror of SortableTable columnsSignature — keep in sync for unit coverage. */
function columnsSignature(columns: { key: string }[]): string {
  return columns.map(c => c.key).join('\0')
}

describe('columnsSignature', () => {
  it('changes when column keys change', () => {
    expect(columnsSignature([{ key: 'a' }, { key: 'b' }])).toBe('a\0b')
    expect(columnsSignature([{ key: 'a' }, { key: 'c' }])).not.toBe(
      columnsSignature([{ key: 'a' }, { key: 'b' }]),
    )
  })
})
