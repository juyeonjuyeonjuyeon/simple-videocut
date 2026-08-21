import { describe, expect, it } from 'vitest'
import type { CaptionTrack } from '../types'
import { CAPTION_STYLE_DEFAULTS, captionStyleForCue, normalizeCaptionTrack, resolveCaptionStyle } from './captions'

describe('dedicated caption model', () => {
  it('normalizes unsafe style values without changing the shared defaults', () => {
    const result = resolveCaptionStyle({ size: 3, y: -2, maxWidth: 0.05, lineLimit: 3 })

    expect(result).toMatchObject({ size: 0.16, y: 0.05, maxWidth: 0.2, lineLimit: 3 })
    expect(CAPTION_STYLE_DEFAULTS).toMatchObject({ size: 0.056, y: 0.86, maxWidth: 0.84, lineLimit: 2 })
  })

  it('sorts cues and keeps per-cue style overrides separate from track style', () => {
    const track: CaptionTrack = {
      id: 'captions-1', name: '한국어', language: 'ko', hidden: false, locked: false,
      style: { ...CAPTION_STYLE_DEFAULTS, color: '#ffffff' },
      cues: [
        { id: 'cue-2', text: '둘', start: 2, end: 3, origin: 'manual', style: { color: '#ff0000' } },
        { id: 'cue-1', text: '하나', start: 0, end: 1, origin: 'imported' },
      ],
    }

    const normalized = normalizeCaptionTrack(track)

    expect(normalized.cues.map((cue) => cue.id)).toEqual(['cue-1', 'cue-2'])
    expect(normalized.cues[1].style).toEqual({ color: '#ff0000' })
    expect(captionStyleForCue(normalized, normalized.cues[1]).color).toBe('#ff0000')
    expect(captionStyleForCue(normalized, normalized.cues[0]).color).toBe('#ffffff')
  })
})
