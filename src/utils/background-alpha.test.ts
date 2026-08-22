import { describe, expect, it } from 'vitest'
import { foregroundAlpha } from './background-alpha'

describe('foregroundAlpha', () => {
  it('keeps confident foreground and removes confident background', () => {
    expect(foregroundAlpha(0.95, 35)).toBe(1)
    expect(foregroundAlpha(0.05, 35)).toBe(0)
  })

  it('removes more uncertain pixels as sensitivity rises', () => {
    expect(foregroundAlpha(0.55, 80)).toBeLessThan(foregroundAlpha(0.55, 20))
  })
})
