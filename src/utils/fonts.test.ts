import { describe, expect, it } from 'vitest'
import { cssFontFamily, firstFontFamily } from './fonts'

describe('font family CSS values', () => {
  it('keeps punctuation in local font family names', () => {
    const value = cssFontFamily('Example, Display')
    expect(value).toContain('"Example, Display"')
    expect(firstFontFamily(value)).toBe('Example, Display')
  })

  it('reads existing single-quoted free font values', () => {
    expect(firstFontFamily("'Noto Sans KR', system-ui, sans-serif")).toBe('Noto Sans KR')
  })
})
