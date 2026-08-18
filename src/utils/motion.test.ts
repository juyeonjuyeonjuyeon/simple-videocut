import { describe, expect, it } from 'vitest'
import type { Overlay } from '../types'
import { positionAt, positionExpression } from './motion'

const layer = {
  x: 0.2,
  y: 0.3,
  positionKeyframes: [
    { id: 'a', time: 0, x: 0.1, y: 0.2, easing: 'linear' as const },
    { id: 'b', time: 2, x: 0.9, y: 0.8, easing: 'ease-in-out' as const },
  ],
} as Overlay

describe('position keyframes', () => {
  it('holds endpoints and interpolates the preview position', () => {
    expect(positionAt(layer, -1)).toEqual({ x: 0.1, y: 0.2 })
    expect(positionAt(layer, 1).x).toBeCloseTo(0.5)
    expect(positionAt(layer, 3)).toEqual({ x: 0.9, y: 0.8 })
  })

  it('creates bounded FFmpeg expressions from the same keyframes', () => {
    const expression = positionExpression(layer, 'x', '(t-1)')
    expect(expression).toContain('if(lte(((t-1)),0),0.1')
    expect(expression).toContain('0.9')
    expect(expression).not.toContain('NaN')
  })
})
