import { describe, expect, it } from 'vitest'
import { canvasDimensionsForPreset, normalizeCanvasDimensions, scaledCanvasDimensions } from './canvas'

describe('canvas dimensions', () => {
  it('supports common landscape, portrait, social, and cinematic presets', () => {
    expect(canvasDimensionsForPreset('4:3', 1080)).toEqual({ width: 1440, height: 1080 })
    expect(canvasDimensionsForPreset('4:5', 1080)).toEqual({ width: 864, height: 1080 })
    expect(canvasDimensionsForPreset('21:9', 1080)).toEqual({ width: 2520, height: 1080 })
  })

  it('keeps custom dimensions codec-safe without changing their intended ratio', () => {
    expect(normalizeCanvasDimensions(1201, 629)).toEqual({ width: 1202, height: 630 })
    expect(scaledCanvasDimensions({ width: 1200, height: 628 }, 314)).toEqual({ width: 600, height: 314 })
  })
})
