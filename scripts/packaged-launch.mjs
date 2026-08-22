import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { _electron as electron } from 'playwright'
import { createElectronTestEnvironment } from './electron-test-env.mjs'

const output = process.env.SIMPLECUT_APP_OUTPUT || join(process.cwd(), 'dist', 'mac-arm64')
const appName = readdirSync(output).find((name) => name.endsWith('.app'))
if (!appName) throw new Error('검사할 macOS 앱을 찾지 못했습니다.')
const executableName = appName.slice(0, -4)
const executablePath = join(output, appName, 'Contents', 'MacOS', executableName)

const testEnv = createElectronTestEnvironment('simplecut-launch-test')
const app = await electron.launch({ executablePath, args: testEnv.launchArgs })
try {
  await testEnv.verify(app)
  const page = await app.firstWindow({ timeout: 15_000 })
  await page.waitForLoadState('domcontentloaded')
  const title = await page.title()
  if (!title.includes('SimpleCut')) throw new Error(`예상하지 못한 앱 제목입니다: ${title}`)
  const fonts = await page.evaluate(() => globalThis.simplecutDesktop?.listFonts())
  if (!fonts || fonts.length < 10) throw new Error(`패키지 앱에서 설치 글꼴을 찾지 못했습니다: ${fonts?.length ?? 0}개`)
  process.stdout.write(`${title} · 설치 글꼴 ${fonts.length}개\n`)
} finally {
  await app.close()
  testEnv.cleanup()
}
