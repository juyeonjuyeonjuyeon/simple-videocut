import { describe, expect, it } from 'vitest'
import { resolveMainPlacement } from './main-placement'

describe('main clip canvas placement', () => {
  it('keeps legacy clips centered and contained inside the canvas', () => {
    expect(resolveMainPlacement({}, 1920, 1080, 1280, 720)).toMatchObject({
      x: 640,
      y: 360,
      width: 1280,
      height: 720,
    })

    expect(resolveMainPlacement({}, 1080, 1920, 1280, 720)).toMatchObject({
      x: 640,
      y: 360,
      width: 405,
      height: 720,
    })
  })

  it('scales from the contained size and supports a free vertical scale', () => {
    expect(resolveMainPlacement({ canvasScale: 0.5 }, 1080, 1920, 1280, 720)).toMatchObject({
      width: 202.5,
      height: 360,
    })

    expect(resolveMainPlacement({ canvasScale: 0.5, canvasScaleY: 0.25, canvasAspectLocked: false }, 1080, 1920, 1280, 720)).toMatchObject({
      width: 202.5,
      height: 180,
    })
  })

  it('uses the cropped and rotated source aspect before fitting', () => {
    const placement = resolveMainPlacement({
      rotate: 90,
      crop: { top: 0, right: 0.25, bottom: 0, left: 0.25 },
    }, 1920, 1080, 1280, 720)

    expect(placement.width).toBeCloseTo(720 * (1080 / 960))
    expect(placement.height).toBe(720)
  })
})
