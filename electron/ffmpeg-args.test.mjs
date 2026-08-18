import test from 'node:test'
import assert from 'node:assert/strict'
import { validateFFmpegArgs } from './ffmpeg-args.mjs'

test('accepts the editor-owned relative FFmpeg workflow', () => {
  assert.doesNotThrow(() => validateFFmpegArgs([
    '-y', '-i', 'in0', '-filter_complex', '[0:v]scale=1920:1080[v]',
    '-map', '[v]', '-c:v', 'h264_videotoolbox', '-t', '2.000', 'out.mp4',
  ]))
  assert.doesNotThrow(() => validateFFmpegArgs([
    '-v', 'error', '-i', 'out.mp4', '-map', '0:v:0', '-frames:v', '1', '-f', 'null', '-',
  ]))
})

test('rejects filesystem, network and filter-script escape attempts', () => {
  const invalid = [
    ['-i', '/Users/example/private.mov', 'out.mp4'],
    ['-i', '../private.mov', 'out.mp4'],
    ['-i', 'https://example.com/video.mp4', 'out.mp4'],
    ['-filter_complex_script', 'graph.txt', 'out.mp4'],
    ['-i', 'in0', '-vf', 'movie=/Users/example/private.mov', 'out.mp4'],
  ]
  for (const args of invalid) assert.throws(() => validateFFmpegArgs(args), /허용되지|잘못|안전/)
})
