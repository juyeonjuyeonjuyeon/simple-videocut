import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { _electron as electron } from 'playwright'

const require = createRequire(import.meta.url)
const ffmpeg = require('ffmpeg-static')
const temp = mkdtempSync(join(tmpdir(), 'simplecut-e2e-'))
const source = join(temp, 'source.mp4')
execFileSync(ffmpeg, [
  '-y', '-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=30',
  '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100', '-t', '2',
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', source,
], { stdio: 'ignore' })

const app = await electron.launch({ args: ['.'] })
try {
  const page = await app.firstWindow()
  await page.locator('header input[type=file]').first().setInputFiles(source)
  const exportButton = page.getByRole('button', { name: '내보내기', exact: true })
  await exportButton.waitFor({ state: 'visible' })
  await exportButton.click()
  await page.getByRole('button', { name: '내보내기 시작' }).click()
  await page.locator('.modal__done').waitFor({ state: 'visible', timeout: 120_000 })
  const status = await page.locator('.modal__status').textContent()
  if (!status?.includes('완료')) throw new Error(`타임라인 내보내기가 완료되지 않았습니다: ${status}`)
  process.stdout.write(`${status}\n`)
} finally {
  app.process().kill('SIGKILL')
  rmSync(temp, { recursive: true, force: true })
}
