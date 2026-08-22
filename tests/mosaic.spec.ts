import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'

const require = createRequire(import.meta.url)
const ffmpeg = require('ffmpeg-static') as string

test('multiple mosaic areas persist in preview and export to playable MP4', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Real mosaic render is covered once on desktop')
  test.setTimeout(240_000)
  const temp = mkdtempSync(join(tmpdir(), 'simplecut-mosaic-'))
  const image = join(temp, 'mosaic-source.png')
  execFileSync(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=1', '-frames:v', '1', image], { stdio: 'ignore' })

  try {
    await page.goto('/')
    await page.locator('header input[type=file]').first().setInputFiles(image)
    await page.getByRole('tab', { name: '스타일', exact: true }).click()
    await page.getByRole('button', { name: '영역 모자이크 추가', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '영역 모자이크' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: '영역 추가', exact: true }).click()
    await dialog.locator('.crop-dialog__zoom input[type=range]').fill('34')
    await dialog.getByRole('button', { name: '적용', exact: true }).click()

    await expect(page.locator('.preview__mosaic-layer canvas')).toHaveCount(2)
    await expect(page.getByRole('button', { name: '모자이크 영역 편집 (2)', exact: true })).toBeVisible()
    await page.getByRole('status').filter({ hasText: '저장됨' }).waitFor({ timeout: 20_000 })
    await page.reload()
    await page.getByRole('button', { name: '복원', exact: true }).click()
    await expect(page.locator('.preview__mosaic-layer canvas')).toHaveCount(2)
    await page.locator('.timeline__track .clip').first().click()
    await page.getByRole('tab', { name: '스타일', exact: true }).click()
    await expect(page.getByRole('button', { name: '모자이크 영역 편집 (2)', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '내보내기', exact: true }).click()
    await page.getByRole('button', { name: '480p', exact: true }).click()
    await page.getByRole('button', { name: '내보내기 시작' }).click()
    await Promise.race([
      page.locator('.modal__done').waitFor({ state: 'visible', timeout: 210_000 }),
      page.locator('.modal__error').waitFor({ state: 'visible', timeout: 210_000 }).then(async () => {
        throw new Error(`모자이크 내보내기 실패: ${await page.locator('.modal__error').textContent()}`)
      }),
    ])
    const preview = page.locator('video.modal__preview')
    await preview.waitFor({ state: 'visible' })
    await expect.poll(() => preview.evaluate((video: HTMLVideoElement) => ({
      width: video.videoWidth, height: video.videoHeight, duration: video.duration,
    })), { timeout: 20_000 }).toEqual({ width: 854, height: 480, duration: 5 })
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
})
