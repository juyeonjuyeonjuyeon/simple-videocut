import { expect, test } from '@playwright/test'

test('free fonts can be searched and applied to text', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Font catalog behavior is covered once on desktop')

  await page.goto('/')
  await page.getByRole('button', { name: '텍스트', exact: true }).click()
  await page.getByRole('button', { name: /글꼴 선택:/ }).click()

  await expect(page.getByRole('option', { name: /도현/ })).toBeVisible()
  await page.getByRole('textbox', { name: '글꼴 이름 검색' }).fill('독도')
  await page.getByRole('option', { name: /독도/ }).click()

  await expect(page.getByRole('button', { name: '글꼴 선택: 독도' })).toBeVisible()
  await expect(page.locator('.preview__text').last()).toHaveCSS('font-family', /Dokdo/)
})
