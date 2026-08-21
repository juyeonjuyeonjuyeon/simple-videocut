import { describe, expect, it } from 'vitest'
import { BASIC_MOTION_OPTIONS, basicMotionFadeIn, basicMotionFrames, isBasicMotionPreset } from './basic-motion'

describe('basic motion presets', () => {
  it('keeps the supported preset list intentionally small', () => {
    expect(BASIC_MOTION_OPTIONS.map((option) => option.value)).toEqual(['none', 'fade', 'rise', 'slide-left', 'drift'])
    expect(isBasicMotionPreset('rise')).toBe(true)
    expect(isBasicMotionPreset('bounce-3d')).toBe(false)
  })

  it('uses two bounded position frames at most', () => {
    for (const option of BASIC_MOTION_OPTIONS) {
      const frames = basicMotionFrames(option.value, 0.03, 0.98, 120)
      expect(frames.length).toBeLessThanOrEqual(2)
      expect(frames.every((frame) => frame.time >= 0 && frame.time <= 120 && frame.x >= 0 && frame.x <= 1 && frame.y >= 0 && frame.y <= 1)).toBe(true)
    }
  })

  it('caps entrance fades and leaves drift fully opaque', () => {
    expect(basicMotionFadeIn('rise', 30)).toBe(0.45)
    expect(basicMotionFadeIn('fade', 0.2)).toBe(0.1)
    expect(basicMotionFadeIn('drift', 5)).toBe(0)
  })
})
