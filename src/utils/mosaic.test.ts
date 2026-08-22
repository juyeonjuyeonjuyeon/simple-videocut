import { describe, expect, it } from 'vitest'
import { moveMosaicRegion, resizeMosaicRegion, sanitizeMosaicRegion } from './mosaic'

const region = { id: 'face', x: 0.2, y: 0.2, width: 0.4, height: 0.3, pixelSize: 18 }

describe('mosaic regions', () => {
  it('keeps moved regions inside the source frame', () => {
    expect(moveMosaicRegion(region, 0.8, -0.8)).toMatchObject({ x: 0.6, y: 0 })
  })

  it('resizes from each edge while preserving a usable area', () => {
    expect(resizeMosaicRegion(region, 'br', 0.9, 0.95)).toMatchObject({ width: 0.7, height: 0.75 })
    expect(resizeMosaicRegion(region, 'tl', 0.59, 0.49).width).toBeCloseTo(0.03)
  })

  it('clamps imported values and pixel size', () => {
    expect(sanitizeMosaicRegion({ ...region, x: -1, width: 4, pixelSize: 999 })).toMatchObject({ x: 0, width: 1, pixelSize: 80 })
  })
})
