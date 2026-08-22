import { expect, test } from '@playwright/test'

test('display language switches between Korean and English and persists', async ({ page }) => {
  await page.goto('/')

  await expect(page.locator('html')).toHaveAttribute('lang', 'ko')
  await page.getByRole('button', { name: /설정:/ }).click()
  await page.getByRole('button', { name: 'English English interface' }).click()

  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await expect(page).toHaveTitle('SimpleCut — Personal Video Editor')
  await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Main track', exact: true })).toBeVisible()

  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await expect(page.getByRole('button', { name: /Settings:/ })).toBeVisible()

  await page.getByRole('button', { name: /Settings:/ }).click()
  await page.getByRole('button', { name: '한국어 한국어 인터페이스' }).click()
  await expect(page.locator('html')).toHaveAttribute('lang', 'ko')
  await expect(page).toHaveTitle('SimpleCut — 나만의 영상 편집기')
})
