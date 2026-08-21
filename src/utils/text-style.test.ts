import { describe, expect, it } from 'vitest'
import { inferTextStylePreset, TEXT_STYLE_OPTIONS, textStylePatch } from './text-style'

describe('text style presets', () => {
  it('changes only existing renderable text style fields', () => {
    for (const option of TEXT_STYLE_OPTIONS) {
      expect(Object.keys(option.patch).sort()).toEqual([
        'box', 'boxAlpha', 'boxColor', 'color', 'colorAlpha', 'shadow', 'shadowBlur', 'shadowColor', 'shadowDist', 'strokeColor', 'strokeWidth',
      ])
      expect(option.patch.color).toMatch(/^#[0-9a-f]{6}$/i)
      expect(option.patch.boxColor).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })

  it('recognizes applied presets and leaves custom styles custom', () => {
    const strawberry = textStylePatch('strawberry')
    expect(inferTextStylePreset(strawberry)).toBe('strawberry')
    expect(inferTextStylePreset({ ...strawberry, boxAlpha: .37 })).toBeNull()
  })

  it('returns fresh patches so edits cannot mutate the preset catalog', () => {
    const first = textStylePatch('default')
    first.color = '#123456'
    expect(textStylePatch('default').color).toBe('#ffffff')
  })
})
