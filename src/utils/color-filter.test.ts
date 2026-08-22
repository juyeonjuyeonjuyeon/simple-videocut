import { describe, expect, it } from 'vitest'
import { colorFilterCss, ffmpegColorFilter, resolveVisualFilter, svgColorMatrixValues, visualFilterMatrix } from './color-filter'

describe('visual color filters', () => {
  it('keeps zero strength mathematically identical to the original', () => {
    expect(visualFilterMatrix({ filterPreset: 'vivid', filterAmount: 0 })).toEqual(visualFilterMatrix({ filterPreset: 'none', filterAmount: 100 }))
    expect(ffmpegColorFilter({ filterPreset: 'warm', filterAmount: 0 })).toBe('')
    expect(colorFilterCss('clip:1', { filterPreset: 'cool', filterAmount: 0 })).toBe('none')
  })

  it('uses one shared matrix for SVG preview and FFmpeg export', () => {
    const settings = { filterPreset: 'mono' as const, filterAmount: 60 }
    const matrix = visualFilterMatrix(settings)
    expect(svgColorMatrixValues(settings).split(' ').map(Number)).toEqual(matrix)
    const ffmpeg = ffmpegColorFilter(settings)
    expect(ffmpeg).toContain(`rr=${matrix[0]}`)
    expect(ffmpeg).toContain(`gg=${matrix[6]}`)
    expect(ffmpeg).toContain(`bb=${matrix[12]}`)
  })

  it('sanitizes restored settings and DOM identifiers', () => {
    expect(resolveVisualFilter({ filterPreset: 'unknown' as 'none', filterAmount: 500 })).toEqual({ filterPreset: 'none', filterAmount: 100 })
    expect(colorFilterCss('clip:unsafe value', { filterPreset: 'warm', filterAmount: 50 })).toBe('url(#simplecut-color-clip-unsafe-value)')
  })

  it('keeps every look compatible with preview and export matrices', () => {
    for (const preset of ['cinema', 'sunset', 'aqua', 'vintage', 'dream', 'noir'] as const) {
      expect(visualFilterMatrix({ filterPreset: preset, filterAmount: 100 })).toHaveLength(20)
      expect(ffmpegColorFilter({ filterPreset: preset, filterAmount: 100 })).toContain('colorchannelmixer=')
    }
  })
})
