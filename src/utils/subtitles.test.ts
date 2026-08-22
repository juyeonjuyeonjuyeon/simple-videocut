import { describe, expect, it } from 'vitest'
import type { TextOverlay } from '../types'
import { parseSubtitleTime, parseSubtitles, serializeSrt } from './subtitles'

const text = (patch: Partial<TextOverlay>): TextOverlay => ({
  id: 't', role: 'caption', text: '안녕', start: 1, end: 2, x: .5, y: .85, size: .07,
  color: '#fff', colorAlpha: 1, box: true, boxColor: '#000', boxAlpha: .5,
  font: 'sans-serif', strokeWidth: 0, strokeColor: '#000', shadow: false,
  shadowColor: '#000', shadowBlur: 0, shadowDist: 0, align: 'center', angle: 0,
  ...patch,
})

describe('subtitle files', () => {
  it('parses SRT and strips markup without losing line breaks', () => {
    const cues = parseSubtitles('\uFEFF1\r\n00:00:01,250 --> 00:00:03,500\r\n<b>안녕</b><br>반가워\r\n\r\n2\r\n00:04.000 --> 00:05.200 position:20%\r\n둘째')
    expect(cues).toEqual([
      { start: 1.25, end: 3.5, text: '안녕\n반가워' },
      { start: 4, end: 5.2, text: '둘째' },
    ])
  })

  it('parses WebVTT identifiers and ignores metadata blocks', () => {
    const cues = parseSubtitles('WEBVTT\n\nNOTE generated\nignored\n\nintro\n00:01.000 --> 00:02.000 align:center\nHello &amp; 안녕')
    expect(cues).toEqual([{ start: 1, end: 2, text: 'Hello & 안녕' }])
  })

  it('rejects malformed times and cues', () => {
    expect(parseSubtitleTime('n/a')).toBeNull()
    expect(parseSubtitles('1\n00:03,000 --> 00:02,000\nbackwards')).toEqual([])
  })

  it('exports only visible caption layers in chronological SRT order', () => {
    const output = serializeSrt([
      text({ id: 'late', start: 65.004, end: 66.1, text: '둘째' }),
      text({ id: 'title', role: 'text', start: 0, end: 1, text: '제목' }),
      text({ id: 'early', start: .5, end: 1.25, text: '첫째' }),
      text({ id: 'hidden', start: 2, end: 3, text: '숨김', hidden: true }),
    ])
    expect(output).toBe('1\n00:00:00,500 --> 00:00:01,250\n첫째\n\n2\n00:01:05,004 --> 00:01:06,100\n둘째\n')
  })
})
