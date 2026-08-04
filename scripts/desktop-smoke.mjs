import { _electron as electron } from 'playwright'

const app = await electron.launch({ args: ['.'] })
try {
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  const result = await page.evaluate(async () => {
    const bridge = globalThis.simplecutDesktop
    if (!bridge || !await bridge.available()) throw new Error('네이티브 FFmpeg 연결을 찾지 못했습니다.')
    await bridge.writeFile('seed.bin', new Uint8Array([1]))
    const code = await bridge.exec([
      '-y', '-f', 'lavfi', '-i', 'color=c=black:s=320x180:r=30',
      '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-t', '1',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', 'smoke.mp4',
    ])
    const bytes = await bridge.readFile('smoke.mp4')
    await bridge.terminate()
    return { code, bytes: bytes.byteLength, title: globalThis.document.title }
  })
  if (result.code !== 0 || result.bytes < 1000) throw new Error(`네이티브 렌더링 결과가 잘못되었습니다: ${JSON.stringify(result)}`)
  process.stdout.write(`${JSON.stringify(result)}\n`)
} finally {
  await app.close()
}
