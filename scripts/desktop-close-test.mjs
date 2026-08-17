import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { _electron as electron } from 'playwright'
import { createElectronTestEnvironment } from './electron-test-env.mjs'

const output = process.env.SIMPLECUT_APP_OUTPUT || join(process.cwd(), 'dist', 'mac-arm64')
const appName = readdirSync(output).find((name) => name === 'SimpleCut.app')
if (!appName) throw new Error('검사할 SimpleCut 앱을 찾지 못했습니다.')
const executable = join(output, appName, 'Contents', 'MacOS', 'SimpleCut')
const testEnv = createElectronTestEnvironment('simplecut-close-test')
const app = await electron.launch({ executablePath: executable, args: testEnv.launchArgs })
const processHandle = app.process()

try {
  await testEnv.verify(app)
  const page = await app.firstWindow({ timeout: 15_000 })
  await page.evaluate(async () => {
    const bridge = globalThis.simplecutDesktop
    if (!bridge) throw new Error('네이티브 FFmpeg 연결을 찾지 못했습니다.')
    await bridge.writeFile('close-test.bin', new Uint8Array([1]))
    const code = await bridge.exec([
      '-y', '-f', 'lavfi', '-i', 'color=c=black:s=32x32:r=1',
      '-t', '0.1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', 'close-test.mp4',
    ])
    if (code !== 0) throw new Error(`닫기 검사 준비 렌더링 실패: ${code}`)
  })
  await page.close()
  await delay(1_000)
  if (app.windows().length !== 0) throw new Error('닫기 후 SimpleCut 창이 남아 있습니다.')
  if (processHandle.exitCode !== null) throw new Error('창 닫기만으로 SimpleCut 앱까지 종료됐습니다.')
  process.stdout.write('창은 닫히고 앱은 Dock에 유지됨\n')
} finally {
  if (processHandle.exitCode === null) await app.close()
  testEnv.cleanup()
}
