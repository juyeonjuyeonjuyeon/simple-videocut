import { describe, expect, it } from 'vitest'
import { overlayPreviewZ, packVisualLanes, PREVIEW_Z, textPreviewZ } from './layers'

describe('visual layer order', () => {
  it('keeps later overlays in front and all text above media overlays', () => {
    expect(overlayPreviewZ(0)).toBeLessThan(overlayPreviewZ(1))
    expect(overlayPreviewZ(99)).toBeLessThan(textPreviewZ(0))
    expect(textPreviewZ(0)).toBeLessThan(textPreviewZ(1))
    expect(textPreviewZ(99)).toBeLessThan(PREVIEW_Z.editor)
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
