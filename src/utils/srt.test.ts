import { describe, expect, it } from 'vitest'
import { parseSrt, stringifySrt } from './srt'

describe('SRT captions', () => {
  it('parses UTF-8 BOM, CRLF, multiline text, and comma or dot milliseconds', () => {
    const cues = parseSrt('\uFEFF1\r\n00:00:01,250 --> 00:00:03,500\r\n첫 줄\r\n둘째 줄\r\n\r\n00:00:04.020 --> 00:00:05.1\r\nEnglish line\r\n')

    expect(cues).toEqual([
      { start: 1.25, end: 3.5, text: '첫 줄\n둘째 줄' },
      { start: 4.02, end: 5.1, text: 'English line' },
    ])
  })

  it('writes deterministic UTF-8 SRT in chronological order', () => {
    const srt = stringifySrt([
      { start: 3.1, end: 4, text: '둘' },
      { start: 0.25, end: 1.5, text: '하나\nOne' },
    ])

    expect(srt).toBe('1\r\n00:00:00,250 --> 00:00:01,500\r\n하나\r\nOne\r\n\r\n2\r\n00:00:03,100 --> 00:00:04,000\r\n둘\r\n')
    expect(parseSrt(srt)).toEqual([
      { start: 0.25, end: 1.5, text: '하나\nOne' },
      { start: 3.1, end: 4, text: '둘' },
    ])
  })

  it('rejects malformed and reversed timestamps with a useful line reference', () => {
    expect(() => parseSrt('1\nnot a timestamp\n내용')).toThrow(/2번째 줄/)
    expect(() => parseSrt('1\n00:00:03,000 --> 00:00:02,000\n내용')).toThrow(/종료 시간/)
  })
})
