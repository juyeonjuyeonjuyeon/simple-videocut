import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'

const require = createRequire(import.meta.url)
const ffmpeg = require('ffmpeg-static') as string

test('exported MP4 keeps the same overlay order as the preview', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The real render comparison runs once on desktop')
  test.setTimeout(240_000)

  const temp = mkdtempSync(join(tmpdir(), 'simplecut-layer-export-'))
  const main = join(temp, 'main.mp4')
  const lower = join(temp, 'lower-red.png')
  const upper = join(temp, 'upper-blue.png')

  execFileSync(ffmpeg, [
    '-y', '-f', 'lavfi', '-i', 'color=c=black:s=320x180:r=30',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100',
    '-t', '0.8', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', main,
  ], { stdio: 'ignore' })
  execFileSync(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'color=c=red:s=320x180', '-frames:v', '1', lower], { stdio: 'ignore' })
  execFileSync(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'color=c=blue:s=320x180', '-frames:v', '1', upper], { stdio: 'ignore' })

  try {
    await page.goto('/')
    await page.locator('header input[type=file]').first().setInputFiles(main)
    await page.locator('header input[type=file]').nth(1).setInputFiles([lower, upper])
    await expect(page.locator('.preview__overlay')).toHaveCount(2)

    await page.locator('.tlclip', { hasText: 'upper-blue.png' }).click()
    await page.getByRole('tab', { name: '스타일', exact: true }).click()
    await page.getByRole('radio', { name: '별', exact: true }).click()
    await page.locator('.ctl').filter({ hasText: '굵기' }).locator('input[type=range]').fill('8')
    await page.getByRole('checkbox', { name: '그림자 사용', exact: true }).check()

    // Selecting the lower layer used to pull it above the real front layer only in the preview.
    await page.locator('.tlclip', { hasText: 'lower-red.png' }).click()
    const lowerZ = Number.parseInt(await page.locator('[data-layer-name="lower-red.png"]').evaluate((element) => getComputedStyle(element).zIndex), 10)
    const upperZ = Number.parseInt(await page.locator('[data-layer-name="upper-blue.png"]').evaluate((element) => getComputedStyle(element).zIndex), 10)
    expect(lowerZ).toBeLessThan(upperZ)

    await page.getByRole('button', { name: '내보내기', exact: true }).click()
    await page.getByRole('button', { name: '480p', exact: true }).click()
    await page.getByRole('button', { name: '내보내기 시작' }).click()
    await Promise.race([
      page.locator('.modal__done').waitFor({ state: 'visible', timeout: 210_000 }),
      page.locator('.modal__error').waitFor({ state: 'visible', timeout: 210_000 }).then(async () => {
        throw new Error(`레이어 내보내기 실패: ${await page.locator('.modal__error').textContent()}`)
      }),
    ])

    const preview = page.locator('video.modal__preview')
    await preview.waitFor({ state: 'visible' })
    const pixels = await preview.evaluate(async (video: HTMLVideoElement) => {
      if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        await new Promise<void>((resolve) => video.addEventListener('loadeddata', () => resolve(), { once: true }))
      }
      video.currentTime = Math.min(0.25, video.duration / 2)
      await new Promise<void>((resolve) => video.addEventListener('seeked', () => resolve(), { once: true }))
      const canvas = document.createElement('canvas')
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      const context = canvas.getContext('2d')!
      context.drawImage(video, 0, 0)
      const sample = (x: number, y: number) => [...context.getImageData(Math.floor(canvas.width * x), Math.floor(canvas.height * y), 1, 1).data]
      return { center: sample(0.5, 0.5), maskedCorner: sample(0.34, 0.34) }
    })

    expect(pixels.center[2]).toBeGreaterThan(180)
    expect(pixels.center[2]).toBeGreaterThan(pixels.center[0] + 100)
    expect(pixels.maskedCorner[0]).toBeGreaterThan(180)
    expect(pixels.maskedCorner[0]).toBeGreaterThan(pixels.maskedCorner[2] + 100)
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
})
