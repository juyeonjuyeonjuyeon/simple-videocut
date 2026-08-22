import { describe, expect, it } from 'vitest'
import { appendMosaicFilters } from './mosaic'

describe('appendMosaicFilters', () => {
  it('adds a bounded pixelize branch for every region', () => {
    const filters: string[] = []
    const output = appendMosaicFilters(filters, '[source]', [
      { id: 'face', x: 0.25, y: 0.2, width: 0.3, height: 0.4, pixelSize: 20 },
      { id: 'plate', x: 0.6, y: 0.7, width: 0.3, height: 0.2, pixelSize: 30 },
    ], 'm', 1920, 1080, 1280, 720, 720)
    expect(output).toBe('[mout1]')
    expect(filters.join(';')).toContain('crop=576:432:480:216,pixelize=w=30:h=30:mode=avg')
    expect(filters).toHaveLength(6)
  })

  it('leaves streams untouched when no region exists', () => {
    const filters: string[] = []
    expect(appendMosaicFilters(filters, '[source]', [], 'm', 10, 10, 10, 10, 720)).toBe('[source]')
    expect(filters).toEqual([])
  })
})
