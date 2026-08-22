import { expect, test } from '@playwright/test'

const image = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#cf7a7d"/></svg>')

test('canvas presets and exact pixel dimensions can be changed at any time', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Canvas settings are covered once on desktop')

  await page.goto('/')
  await page.getByRole('button', { name: '4:5', exact: true }).click()
  await expect(page.getByText('576 × 720 px', { exact: true })).toBeVisible()

  await page.getByRole('spinbutton', { name: '캔버스 너비' }).fill('1200')
  await page.getByRole('spinbutton', { name: '캔버스 높이' }).fill('628')
  await page.getByRole('button', { name: '사용자 크기 적용' }).click()
  await expect(page.getByText('1200 × 628 px', { exact: true })).toBeVisible()

  await page.locator('header input[type=file]').first().setInputFiles({ name: 'canvas.svg', mimeType: 'image/svg+xml', buffer: image })
  await page.getByRole('button', { name: '내보내기', exact: true }).click()
  await expect(page.getByText('1200 × 628 px', { exact: true })).toBeVisible()
})
