import { describe, expect, it } from 'vitest'
import { createProgressReporter, mp4VideoEncodingArgs, parseVideoStreamInfo, shouldNormalizeInput } from './exporter'

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

  it('keeps native desktop inputs in a single final encoding pass', () => {
    expect(shouldNormalizeInput({ codec: 'hevc', width: 3840, height: 2160, hasAudio: true }, 1920, 1080, true)).toBe(false)
  })

  it('uses VideoToolbox with an output-sized bitrate on macOS', () => {
    expect(mp4VideoEncodingArgs(1080, 'h264_videotoolbox')).toEqual(expect.arrayContaining([
      '-c:v', 'h264_videotoolbox', '-b:v', '6M', '-allow_sw', '1', '-pix_fmt', 'yuv420p',
    ]))
  })

  it('reports multi-stage export progress without moving backwards', () => {
    const values: number[] = []
    const progress = createProgressReporter((value) => values.push(value))
    progress.setStage(0.05, 0.2)
    progress.report(0.8)
    progress.setStage(0.25, 0.7)
    progress.report(0.1)
    progress.report(0.5)
    expect(values).toEqual([0.21, 0.32, 0.6])
  })
})
