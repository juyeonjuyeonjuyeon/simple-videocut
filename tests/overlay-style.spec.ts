import { expect, test } from '@playwright/test'

const image = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#cf7a7d"/></svg>',
)

test('overlay style controls apply masks, borders, and shadows to the preview', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Overlay style controls are covered once on desktop')

  await page.goto('/')
  await page.locator('header input[type=file]').nth(1).setInputFiles({
    name: 'styled-layer.svg', mimeType: 'image/svg+xml', buffer: image,
  })

  await page.getByRole('tab', { name: '스타일', exact: true }).click()
  await expect(page.getByRole('radio', { name: '원', exact: true })).toBeVisible()
  await expect(page.getByRole('radio', { name: '타원', exact: true })).toBeVisible()
  await expect(page.getByRole('radio', { name: '하트', exact: true })).toBeVisible()
  await expect(page.getByRole('radio', { name: '별', exact: true })).toBeVisible()

  await page.getByRole('radio', { name: '별', exact: true }).click()
  await page.locator('.ctl').filter({ hasText: '굵기' }).locator('input[type=range]').fill('12')
  await page.locator('.style-select select').selectOption('dashed')
  await page.getByRole('checkbox', { name: '그림자 사용', exact: true }).check()

  const overlay = page.locator('[data-layer-name="styled-layer.svg"]')
  await expect(overlay.locator('.preview__overlay-clip')).toHaveCSS('clip-path', /polygon/)
  await expect(overlay.locator('.preview__overlay-clip')).toHaveCSS('filter', /drop-shadow/)
  await expect(overlay.locator('.preview__overlay-decoration path')).toHaveCount(1)
  const dash = await overlay.locator('.preview__overlay-decoration path').getAttribute('stroke-dasharray')
  const [dashLength, gapLength] = dash!.split(' ').map(Number)
  expect(dashLength).toBeGreaterThan(0)
  expect(dashLength / gapLength).toBeCloseTo(1.5, 3)
})
