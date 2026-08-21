import { describe, expect, it } from 'vitest'
import type { Overlay } from '../types'
import { maskClipPath, maskPathData, overlayEffectPadding, overlayOutputSize, OVERLAY_STYLE_DEFAULTS } from './overlay-style'

const overlay = {
  scale: 0.5, crop: { top: 0, right: 0, bottom: 0, left: 0 }, rotate: 0,
} as Overlay

describe('overlay visual styles', () => {
  it('builds distinct reusable mask paths', () => {
    expect(maskClipPath('circle')).toContain('closest-side')
    expect(maskPathData('heart', 200, 100)).not.toBe(maskPathData('star', 200, 100))
    expect(maskPathData('rounded', 200, 100)).toContain('Q')
  })

  it('keeps free sizing and rotated source sizing predictable', () => {
    expect(overlayOutputSize(overlay, 1920, 1080, 1280, 720)).toEqual({ width: 640, height: 360 })
    expect(overlayOutputSize({ ...overlay, rotate: 90 }, 1920, 1080, 1280, 720)).toEqual({ width: 640, height: 1138 })
    expect(overlayOutputSize({ ...overlay, scaleY: 0.25, aspectLocked: false }, 1920, 1080, 1280, 720)).toEqual({ width: 640, height: 180 })
  })

  it('adds symmetric room only when a shadow is enabled', () => {
    expect(overlayEffectPadding(OVERLAY_STYLE_DEFAULTS, 720)).toBe(0)
    expect(overlayEffectPadding({ ...OVERLAY_STYLE_DEFAULTS, shadowEnabled: true }, 720)).toBeGreaterThan(20)
  })
})
