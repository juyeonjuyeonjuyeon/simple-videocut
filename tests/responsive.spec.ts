import { expect, test } from '@playwright/test'

test('editor shell fits the viewport and exposes primary controls', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('button', { name: '재생', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '프로젝트 열기·관리', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '실행 취소' })).toBeVisible()

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
  expect(overflow).toBe(false)
})
