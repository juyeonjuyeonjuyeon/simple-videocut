import { describe, expect, it } from 'vitest'
import type { Clip, Overlay, AudioClip } from '../types'
import { audioLength, clipTimelineDuration, fadeLevel, overlayLength, packLanes, parseClock } from './time'

const clip = { trimStart: 2, trimEnd: 12, speed: 2, repeat: 3 } as Clip
const overlay = { trimStart: 1, trimEnd: 5, speed: 0.5, repeat: 2 } as Overlay
const audio = { trimStart: 3, trimEnd: 8, repeat: 4 } as AudioClip

describe('timeline duration helpers', () => {
  it('applies trim, speed and repeat consistently', () => {
    expect(clipTimelineDuration(clip)).toBe(15)
    expect(overlayLength(overlay)).toBe(16)
    expect(audioLength(audio)).toBe(20)
  })

  it('packs only overlapping items into separate lanes', () => {
    expect(packLanes([{ start: 0, end: 2 }, { start: 1, end: 3 }, { start: 3, end: 4 }])).toEqual([0, 1, 0])
  })

  it('parses clock values', () => {
    expect(parseClock('01:02.5')).toBe(62.5)
    expect(parseClock('1:02:03')).toBe(3723)
  })

  it('uses the same bounded fade envelope for preview and export planning', () => {
    expect(fadeLevel(0, 10, 2, 3)).toBe(0)
    expect(fadeLevel(1, 10, 2, 3)).toBeCloseTo(0.5)
    expect(fadeLevel(5, 10, 2, 3)).toBe(1)
    expect(fadeLevel(8.5, 10, 2, 3)).toBeCloseTo(0.5)
    expect(fadeLevel(10, 10, 2, 3)).toBe(0)
  })
})
