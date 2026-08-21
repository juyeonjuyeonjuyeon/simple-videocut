import { describe, expect, it } from 'vitest'
import { normalizeVisualOrder, packVisualLanes, PREVIEW_Z, visualPreviewZ } from './layers'

describe('visual layer order', () => {
  it('uses one explicit order for media and text layers', () => {
    const order = normalizeVisualOrder([{ id: 'image' }], [{ id: 'title' }], [
      { type: 'text', id: 'title' },
      { type: 'overlay', id: 'image' },
    ])
    expect(order).toEqual([
      { type: 'text', id: 'title' },
      { type: 'overlay', id: 'image' },
    ])
    expect(visualPreviewZ(order, { type: 'text', id: 'title' }))
      .toBeLessThan(visualPreviewZ(order, { type: 'overlay', id: 'image' }))
    expect(visualPreviewZ(order, { type: 'overlay', id: 'image' })).toBeLessThan(PREVIEW_Z.editor)
  })

  it('backfills and removes stale entries when old projects are loaded', () => {
    expect(normalizeVisualOrder([{ id: 'image' }], [{ id: 'title' }], [
      { type: 'overlay', id: 'gone' },
    ])).toEqual([
      { type: 'overlay', id: 'image' },
      { type: 'text', id: 'title' },
    ])
  })

  it('shows the frontmost overlapping item in the top timeline row', () => {
    expect(packVisualLanes([
      { start: 0, end: 2 },
      { start: 1, end: 3 },
      { start: 3, end: 4 },
    ])).toEqual([1, 0, 0])
    expect(packVisualLanes([
      { start: 0, end: 4 },
      { start: 0, end: 4 },
      { start: 0, end: 4 },
    ])).toEqual([2, 1, 0])
  })
})
