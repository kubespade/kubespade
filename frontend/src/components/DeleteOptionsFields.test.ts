import { describe, expect, it } from 'vitest'
import { DEFAULT_DELETE_FORM, deleteFormToOpts } from './DeleteOptionsFields'

describe('deleteFormToOpts', () => {
  it('defaults to foreground cascade only', () => {
    expect(deleteFormToOpts(DEFAULT_DELETE_FORM)).toEqual({
      force: false,
      propagation: 'Foreground',
    })
  })

  it('passes grace and force', () => {
    expect(deleteFormToOpts({
      force: true,
      gracePeriod: '15',
      propagation: 'Orphan',
    })).toEqual({
      force: true,
      gracePeriod: 15,
      propagation: 'Orphan',
    })
  })

  it('ignores blank grace', () => {
    expect(deleteFormToOpts({
      force: false,
      gracePeriod: '  ',
      propagation: 'Background',
    }).gracePeriod).toBeUndefined()
  })
})
