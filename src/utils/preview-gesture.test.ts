import { describe, expect, it } from 'vitest'
import { resolveTwoPointerGesture } from './preview-gesture'

describe('preview two-pointer gesture', () => {
  it('combines midpoint movement and pinch scale without drift', () => {
    expect(resolveTwoPointerGesture(
      { x: 0, y: 0 }, { x: 100, y: 0 },
      { x: -40, y: 20 }, { x: 160, y: 20 },
    )).toMatchObject({ deltaX: 10, deltaY: 20, scale: 2, rotation: 0 })
  })

  it('reports a coherent clockwise rotation', () => {
    const gesture = resolveTwoPointerGesture(
      { x: -50, y: 0 }, { x: 50, y: 0 },
      { x: 0, y: -50 }, { x: 0, y: 50 },
    )
    expect(gesture.scale).toBeCloseTo(1)
    expect(gesture.rotation).toBeCloseTo(90)
  })
})
