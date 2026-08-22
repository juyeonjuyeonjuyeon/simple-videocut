import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { copyFileSync } from 'node:fs'
import { join } from 'node:path'
import { _electron as electron } from 'playwright'
import { createElectronTestEnvironment } from './electron-test-env.mjs'

const require = createRequire(import.meta.url)
const ffmpeg = require('ffmpeg-static')
const testEnv = createElectronTestEnvironment('simplecut-e2e')
const temp = testEnv.root
const source = join(temp, 'source.mp4')
const overlay = join(temp, 'overlay-4k-hevc.mov')
const background = join(temp, 'background-4k-hevc.mov')
const audio = join(temp, 'voice.m4a')
execFileSync(ffmpeg, [
  '-y', '-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=30',
  '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100', '-t', '2',
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', source,
], { stdio: 'ignore' })
execFileSync(ffmpeg, [
  '-y', '-f', 'lavfi', '-i', 'testsrc2=s=3840x2160:r=30', '-t', '1',
  '-c:v', 'libx265', '-preset', 'ultrafast', '-crf', '30', '-tag:v', 'hvc1', '-an', overlay,
], { stdio: 'ignore' })
copyFileSync(overlay, background)
execFileSync(ffmpeg, [
  '-y', '-f', 'lavfi', '-i', 'sine=frequency=660:sample_rate=44100', '-t', '6',
  '-c:a', 'aac', '-b:a', '128k', '-vn', audio,
], { stdio: 'ignore' })

let app = await electron.launch({ args: ['.', ...testEnv.launchArgs] })
try {
  await testEnv.verify(app)
  let page = await app.firstWindow()
  await page.locator('header input[type=file]').first().setInputFiles(source)
  await page.getByRole('tab', { name: '시간', exact: true }).click()
  await page.locator('.ctl').filter({ hasText: '시작 트림' }).first().locator('input[type=range]').fill('0.5')
  await page.locator('.ctl').filter({ hasText: '끝 트림' }).first().locator('input[type=range]').fill('1.5')
  const repeatControl = page.locator('.ctl').filter({ hasText: '반복 늘이기' }).first()
  await repeatControl.locator('input[type=number]').fill('3')
  await repeatControl.locator('input[type=number]').blur()
  await page.locator('header input[type=file]').nth(1).setInputFiles([overlay, background])
  await page.getByRole('button', { name: '메인 트랙으로 이동', exact: true }).click()
  await page.getByRole('button', { name: '배경 레이어로 이동', exact: true }).click()
  await page.locator('.tlclip', { hasText: 'overlay-4k-hevc.mov' }).click()
  await page.getByRole('tab', { name: '스타일', exact: true }).click()
  await page.getByRole('radio', { name: '별', exact: true }).click()
  await page.locator('.ctl').filter({ hasText: '굵기' }).locator('input[type=range]').fill('10')
  await page.getByRole('checkbox', { name: '그림자 사용', exact: true }).check()
  await page.locator('header input[type=file]').nth(2).setInputFiles(audio)
  await page.getByRole('tab', { name: '시간', exact: true }).click()
  await page.locator('.ctl').filter({ hasText: '시작 트림' }).first().locator('input[type=range]').fill('1')
  await page.locator('.ctl').filter({ hasText: '끝 트림' }).first().locator('input[type=range]').fill('3')
  const audioRepeatControl = page.locator('.ctl').filter({ hasText: '반복 늘이기' }).first()
  await audioRepeatControl.locator('input[type=number]').fill('2')
  await audioRepeatControl.locator('input[type=number]').blur()
  await page.getByRole('button', { name: '텍스트', exact: true }).click()
  await page.waitForFunction(async () => {
    const projects = await globalThis.simplecutDesktop?.projectLoad('__autosave__')
    const project = projects?.[0]
    return Boolean(project && project.clips.length === 1 && project.clips[0].trimStart === 0.5 && project.clips[0].trimEnd === 1.5 && project.clips[0].repeat === 3 && project.overlays.length === 1 && project.backgrounds.length === 1 && project.audios.length === 1 && project.audios[0].trimStart === 1 && project.audios[0].trimEnd === 3 && project.audios[0].repeat === 2 && project.texts.length === 1 && project.media.every((item) => item.nativeMediaId && item.size > 0 && !('blob' in item)))
  }, null, { timeout: 20_000 })
  await page.getByRole('status').filter({ hasText: '저장됨' }).waitFor({ timeout: 15_000 })
  await page.waitForTimeout(300)
  await app.close()

  app = await electron.launch({ args: ['.', ...testEnv.launchArgs] })
  await testEnv.verify(app)
  page = await app.firstWindow()
  await page.getByText('이전에 작업하던 프로젝트가 있어요. 복원할까요?').waitFor({ timeout: 15_000 })
  await page.getByRole('button', { name: '복원', exact: true }).click()
  for (const name of ['source.mp4', 'overlay-4k-hevc.mov', 'background-4k-hevc.mov', 'voice.m4a']) {
    await page.getByText(name, { exact: false }).first().waitFor({ timeout: 20_000 })
  }
  await page.locator('.tlclip', { hasText: 'overlay-4k-hevc.mov' }).click()
  await page.getByRole('tab', { name: '스타일', exact: true }).click()
  const starMask = page.getByRole('radio', { name: '별', exact: true })
  if (await starMask.getAttribute('aria-checked') !== 'true') throw new Error('오버레이 마스크 설정이 복원되지 않았습니다.')
  if (!await page.getByRole('checkbox', { name: '그림자 사용', exact: true }).isChecked()) throw new Error('오버레이 그림자 설정이 복원되지 않았습니다.')
  const exportButton = page.getByRole('button', { name: '내보내기', exact: true })
  await exportButton.waitFor({ state: 'visible' })
  await exportButton.click()
  await page.getByRole('button', { name: '480p', exact: true }).click()
  await page.getByRole('button', { name: '내보내기 시작' }).click()
  await Promise.race([
    page.locator('.modal__done').waitFor({ state: 'visible', timeout: 180_000 }),
    page.locator('.modal__error').waitFor({ state: 'visible', timeout: 180_000 }).then(async () => {
      throw new Error(`타임라인 내보내기 실패: ${await page.locator('.modal__error').textContent()}`)
    }),
  ])
  const status = await page.locator('.modal__status').textContent()
  if (!status?.includes('완료')) throw new Error(`타임라인 내보내기가 완료되지 않았습니다: ${status}`)
  process.stdout.write(`${status}\n`)
} finally {
  await app.close()
  testEnv.cleanup()
}
