import { describe, expect, it } from 'vitest'
import { cropForAspect, cropSize, moveCrop, resizeCrop, sanitizeCrop, zoomCrop } from './crop'

describe('crop geometry', () => {
  it('never allows an inverted or empty crop', () => {
    const crop = sanitizeCrop({ top: 0.8, right: 0.7, bottom: 0.7, left: 0.8 })
    expect(cropSize(crop).width).toBeCloseTo(0.04)
    expect(cropSize(crop).height).toBeCloseTo(0.04)
  })

  it('moves the kept area without changing its size or leaving the frame', () => {
    const crop = moveCrop({ top: 0.1, right: 0.2, bottom: 0.3, left: 0.2 }, 1, -1)
    expect(cropSize(crop).width).toBeCloseTo(0.6)
    expect(cropSize(crop).height).toBeCloseTo(0.6)
    expect(crop.right).toBeCloseTo(0)
    expect(crop.top).toBeCloseTo(0)
  })

  it('zooms continuously around the existing center', () => {
    const crop = zoomCrop({ top: 0, right: 0, bottom: 0, left: 0 }, 0.5)
    expect(crop).toEqual({ top: 0.25, right: 0.25, bottom: 0.25, left: 0.25 })
  })

  it('creates and preserves common crop aspect ratios', () => {
    const square = cropForAspect({ top: 0, right: 0, bottom: 0, left: 0 }, 16 / 9, 1)
    const size = cropSize(square)
    expect((16 / 9) * size.width / size.height).toBeCloseTo(1)

    const resized = resizeCrop(square, 'br', 0.8, 0.9, 16 / 9, 1)
    const resizedSize = cropSize(resized)
    expect((16 / 9) * resizedSize.width / resizedSize.height).toBeCloseTo(1)
  })

  it('supports independent side handles in free crop mode', () => {
    const crop = resizeCrop({ top: 0, right: 0, bottom: 0, left: 0 }, 'l', 0.3, 0.5, 16 / 9, null)
    expect(crop.left).toBeCloseTo(0.3)
    expect(crop.top).toBe(0)
    expect(crop.bottom).toBe(0)
  })
})
