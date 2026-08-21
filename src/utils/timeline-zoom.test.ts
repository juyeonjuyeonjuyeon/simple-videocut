import { describe, expect, it } from 'vitest'
import { timelineWheelZoomFactor } from './timeline-zoom'

describe('timelineWheelZoomFactor', () => {
  it('turns a small trackpad delta into a fine zoom adjustment', () => {
    expect(timelineWheelZoomFactor(-4, 0)).toBeGreaterThan(1)
    expect(timelineWheelZoomFactor(-4, 0)).toBeLessThan(1.01)
    expect(timelineWheelZoomFactor(4, 0)).toBeGreaterThan(0.99)
    expect(timelineWheelZoomFactor(4, 0)).toBeLessThan(1)
  })

  it('keeps one conventional wheel notch noticeable but restrained', () => {
    expect(timelineWheelZoomFactor(-100, 0)).toBeGreaterThan(1.08)
    expect(timelineWheelZoomFactor(-100, 0)).toBeLessThan(1.15)
  })

  it('normalizes line deltas and caps unusually large events', () => {
    expect(timelineWheelZoomFactor(-3, 1)).toBeCloseTo(timelineWheelZoomFactor(-48, 0), 8)
    expect(timelineWheelZoomFactor(-10_000, 0)).toBeCloseTo(timelineWheelZoomFactor(-120, 0), 8)
  })
})
