import { expect, test } from '@playwright/test'

const image = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#cf7a7d"/></svg>',
)

test('final preview shows clean output and simulated social layouts', async ({ page }) => {
  await page.goto('/')
  await page.locator('header input[type=file]').first().setInputFiles({
    name: 'preview-main.svg', mimeType: 'image/svg+xml', buffer: image,
  })

  await page.getByRole('button', { name: '미리보기', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '완제품 미리보기' })
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('.preview__overlay-controls, .preview__selection-tools, .preview__text--selected')).toHaveCount(0)

  await dialog.getByRole('tab', { name: 'TikTok' }).click()
  await expect(dialog.locator('.platform-ui--tiktok')).toBeVisible()
  await expect(dialog).toContainText('현재 프로젝트는 16:9입니다.')

  await dialog.getByRole('button', { name: '안전 영역' }).click()
  await expect(dialog.locator('.platform-safe-zone--tiktok')).toBeVisible()
  await dialog.getByRole('button', { name: '앱 UI' }).click()
  await expect(dialog.locator('.platform-ui')).toHaveCount(0)

  await dialog.getByRole('tab', { name: 'YouTube' }).click()
  await expect(dialog.locator('.platform-ui')).toHaveCount(0)
  await dialog.getByRole('button', { name: '앱 UI' }).click()
  await expect(dialog.locator('.platform-ui--youtube')).toBeVisible()
  await dialog.getByRole('slider', { name: '미리보기 재생 위치' }).fill('2')
  await expect(dialog.locator('.showcase-preview__time')).toContainText('00:02.0')

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
  expect(overflow).toBe(false)
})
