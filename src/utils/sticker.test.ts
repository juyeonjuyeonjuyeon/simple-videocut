import { describe, expect, it } from 'vitest'
import { createStickerPlaceholderFile, isStickerKind, STICKER_OPTIONS, stickerLayers } from './sticker'

describe('built-in stickers', () => {
  it('provides a complete drawable definition for every sticker', () => {
    expect(STICKER_OPTIONS.length).toBeGreaterThanOrEqual(8)
    for (const option of STICKER_OPTIONS) {
      const layers = stickerLayers(option.value)
      expect(layers.length, option.value).toBeGreaterThan(0)
      expect(layers.every((layer) => layer.path.startsWith('M') && !/NaN|undefined/.test(layer.path)), option.value).toBe(true)
      expect(isStickerKind(option.value)).toBe(true)
    }
  })

  it('rejects unknown sticker identifiers and creates a portable placeholder', () => {
    expect(isStickerKind('paid-cloud-sticker')).toBe(false)
    const file = createStickerPlaceholderFile('heart-pop')
    expect(file.type).toBe('image/png')
    expect(file.size).toBeGreaterThan(32)
  })
})
