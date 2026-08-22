import { describe, expect, it } from 'vitest'
import { createShapePlaceholderFile, resolveShapeStyle, SHAPE_OPTIONS, shapePathData } from './shape'

describe('shape overlays', () => {
  it('builds valid paths for every built-in shape', () => {
    for (const option of SHAPE_OPTIONS) {
      const path = shapePathData(option.value, 320, 180, 4, .2)
      expect(path.startsWith('M '), option.value).toBe(true)
      expect(path).not.toMatch(/NaN|undefined/)
      expect(path.endsWith('Z')).toBe(true)
    }
  })

  it('sanitizes restored style values', () => {
    expect(resolveShapeStyle({ kind: 'circle', fillColor: '#123456', fillOpacity: 3, cornerRadius: -1 })).toEqual({
      kind: 'circle', fillColor: '#123456', fillOpacity: 1, cornerRadius: 0,
    })
    expect(resolveShapeStyle({ kind: 'unknown' as 'circle', fillColor: 'red' })).toMatchObject({ kind: 'rectangle', fillColor: '#e27f92' })
  })

  it('creates a small valid project placeholder image', () => {
    const file = createShapePlaceholderFile('star')
    expect(file.type).toBe('image/png')
    expect(file.size).toBeGreaterThan(32)
  })
})
