import { describe, expect, it } from 'vitest'
import { parseVideoStreamInfo, shouldNormalizeInput } from './exporter'

describe('FFmpeg input planning', () => {
  it('extracts HEVC codec and dimensions from FFmpeg probe output', () => {
    const info = parseVideoStreamInfo([
      'Stream #0:0: Video: hevc (Main), yuv420p, 3840x2160, 30 fps',
      'Stream #0:1: Audio: aac, 48000 Hz, stereo',
    ])
    expect(info).toEqual({ codec: 'hevc', width: 3840, height: 2160, hasAudio: true })
  })

  it('normalizes HEVC and oversized inputs before the final filter graph', () => {
    expect(shouldNormalizeInput({ codec: 'hevc', width: 1920, height: 1080, hasAudio: true }, 1280, 720)).toBe(true)
    expect(shouldNormalizeInput({ codec: 'h264', width: 3840, height: 2160, hasAudio: true }, 1280, 720)).toBe(true)
    expect(shouldNormalizeInput({ codec: 'h264', width: 1280, height: 720, hasAudio: true }, 1280, 720)).toBe(false)
  })
})
