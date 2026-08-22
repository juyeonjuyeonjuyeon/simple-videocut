import { describe, expect, it } from 'vitest'
import type { AudioClip, CaptionTrack, Clip } from '../types'
import { CAPTION_STYLE_DEFAULTS, captionSourceBinding, captionStyleForCue, normalizeCaptionTrack, resolveCaptionStyle, syncCaptionTracksToSources, wrapCaptionLines } from './captions'

const sourceClip = (id: string, duration = 2): Clip => ({
  id, kind: 'video', name: `${id}.mp4`, src: '', file: new File([], `${id}.mp4`), sourceSize: 0,
  duration, trimStart: 0, trimEnd: duration, speed: 1, volume: 1, muted: true,
  hasAudio: false, color: '#000', rotate: 0, flipH: false, flipV: false,
  crop: { top: 0, right: 0, bottom: 0, left: 0 }, repeat: 1,
})

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

  it('wraps Korean and English text within a fixed line limit', () => {
    const measure = (text: string) => Array.from(text).length
    expect(wrapCaptionLines('짧은 자막 문장입니다', 6, 2, measure)).toEqual(['짧은 자막', '문장입니다'])
    expect(wrapCaptionLines('one two three four', 7, 2, measure)).toEqual(['one two', 'three…'])
    expect(wrapCaptionLines('ABCDEFGHIJ', 4, 2, measure)).toEqual(['ABCD', 'EFG…'])
  })

  it('keeps cue offsets stable when its source clip or audio moves', () => {
    const clips = [sourceClip('clip-a'), sourceClip('clip-b')]
    const audio: AudioClip = {
      id: 'voice', name: 'voice.m4a', src: '', file: new File([], 'voice.m4a'), sourceSize: 0,
      duration: 4, trimStart: 0, trimEnd: 4, volume: 1, muted: false, color: '#000', start: 1, repeat: 1,
    }
    const source = captionSourceBinding(2.25, 3, clips, [audio], { type: 'clip', id: 'clip-b' })
    const track: CaptionTrack = {
      id: 'track', name: 'linked', language: 'ko', hidden: false, locked: false,
      style: { ...CAPTION_STYLE_DEFAULTS },
      cues: [{ id: 'cue', text: '연결', start: 2.25, end: 3, origin: 'manual', source }],
    }

    const moved = syncCaptionTracksToSources([track], [sourceClip('clip-a', 3), sourceClip('clip-b')], [audio])
    expect(moved[0].cues[0]).toMatchObject({ start: 3.25, end: 4, source: { id: 'clip-b', offsetStart: 0.25, offsetEnd: 1 } })

    const missing = syncCaptionTracksToSources(moved, [sourceClip('clip-a', 3)], [audio])
    expect(missing[0].cues[0]).toMatchObject({ start: 3.25, end: 4 })
    expect(missing[0].cues[0].source).toBeUndefined()
  })
})
