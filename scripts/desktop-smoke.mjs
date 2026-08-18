import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { _electron as electron } from 'playwright'
import { createElectronTestEnvironment } from './electron-test-env.mjs'

const require = createRequire(import.meta.url)
const ffmpeg = require('ffmpeg-static')
const testEnv = createElectronTestEnvironment('simplecut-smoke-test')
const source = join(testEnv.root, 'smoke-input.mp4')
execFileSync(ffmpeg, [
  '-y', '-f', 'lavfi', '-i', 'color=c=black:s=320x180:r=30',
  '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-t', '1',
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', source,
], { stdio: 'ignore' })
const sourceBytes = [...readFileSync(source)]
const app = await electron.launch({ args: ['.', ...testEnv.launchArgs] })
try {
  await testEnv.verify(app)
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  const result = await page.evaluate(async (inputBytes) => {
    const bridge = globalThis.simplecutDesktop
    if (!bridge || !await bridge.available()) throw new Error('네이티브 FFmpeg 연결을 찾지 못했습니다.')
    await bridge.writeFile('smoke-input.mp4', new Uint8Array(inputBytes))
    const encoder = await bridge.videoEncoder()
    if (encoder !== 'h264_videotoolbox') throw new Error(`VideoToolbox 인코더를 찾지 못했습니다: ${encoder}`)
    const code = await bridge.exec([
      '-y', '-i', 'smoke-input.mp4', '-t', '1',
      '-c:v', encoder, '-b:v', '1M', '-allow_sw', '1', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-movflags', '+faststart', 'smoke.mp4',
    ])
    const bytes = await bridge.readFile('smoke.mp4')
    await bridge.terminate()
    return { code, bytes: bytes.byteLength, encoder, title: globalThis.document.title }
  }, sourceBytes)
  if (result.code !== 0 || result.bytes < 1000) throw new Error(`네이티브 렌더링 결과가 잘못되었습니다: ${JSON.stringify(result)}`)
  process.stdout.write(`${JSON.stringify(result)}\n`)
} finally {
  await app.close()
  testEnv.cleanup()
}
