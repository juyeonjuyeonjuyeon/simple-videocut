import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'

const require = createRequire(import.meta.url)
const ffmpeg = require('ffmpeg-static') as string

test('mobile Safari restores video and M4A, then exports playable video', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'WebKit mobile recovery regression')

  const temp = mkdtempSync(join(tmpdir(), 'simplecut-web-recovery-'))
  const video = join(temp, 'mobile-source.mp4')
  const audio = join(temp, 'iphone-recording.m4a')
  execFileSync(ffmpeg, [
    '-y', '-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=30',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100', '-t', '1.5',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', video,
  ], { stdio: 'ignore' })
  execFileSync(ffmpeg, [
    '-y', '-f', 'lavfi', '-i', 'sine=frequency=660:sample_rate=44100', '-t', '1.5',
    '-c:a', 'aac', '-vn', audio,
  ], { stdio: 'ignore' })

  try {
    await page.goto('/')
    await page.locator('header input[type=file]').first().setInputFiles(video)
    await page.locator('header input[type=file]').nth(2).setInputFiles(audio)
    await expect(page.getByText('mobile-source.mp4', { exact: false }).first()).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText('iphone-recording.m4a', { exact: false }).first()).toBeVisible({ timeout: 20_000 })
    await page.getByRole('status').filter({ hasText: '저장됨' }).waitFor({ timeout: 20_000 })

    await page.reload()
    await page.getByText('이전에 작업하던 프로젝트가 있어요. 복원할까요?').waitFor({ timeout: 20_000 })
    await page.getByRole('button', { name: '복원', exact: true }).click()
    await expect(page.getByText('mobile-source.mp4', { exact: false }).first()).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText('iphone-recording.m4a', { exact: false }).first()).toBeVisible({ timeout: 20_000 })

    await page.getByRole('button', { name: '내보내기', exact: true }).click()
    await page.getByRole('button', { name: '480p', exact: true }).click()
    await page.getByRole('button', { name: '내보내기 시작' }).click()
    await Promise.race([
      page.locator('.modal__done').waitFor({ state: 'visible', timeout: 180_000 }),
      page.locator('.modal__error').waitFor({ state: 'visible', timeout: 180_000 }).then(async () => {
        throw new Error(`모바일 내보내기 실패: ${await page.locator('.modal__error').textContent()}`)
      }),
    ])

    const preview = page.locator('video.modal__preview')
    await preview.waitFor({ state: 'visible' })
    await expect.poll(() => preview.evaluate((element: HTMLVideoElement) => ({
      duration: element.duration,
      width: element.videoWidth,
      height: element.videoHeight,
    })), { timeout: 20_000 }).toEqual({ duration: 1.5, width: 854, height: 480 })
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
})
