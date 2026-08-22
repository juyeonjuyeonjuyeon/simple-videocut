import { expect, test } from '@playwright/test'

test('imports SRT as editable caption layers and restores them from autosave', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '자막', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '자막 가져오기·내보내기' })
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('자막 내용').fill('1\n00:00:01,000 --> 00:00:02,500\n첫 번째 자막\n\n2\n00:00:03,000 --> 00:00:04,200\n둘째 자막')
  await expect(dialog.getByText(/2개 자막/)).toBeVisible()
  await dialog.getByRole('radio', { name: /노란 강조/ }).click()
  await dialog.getByRole('button', { name: '2개 가져오기' }).click()

  await expect(page.getByLabel('텍스트 내용')).toHaveValue('첫 번째 자막')
  await expect(page.locator('.timeline__lane--text')).toHaveCount(2)
  await expect(page.locator('.preview__text')).toContainText('첫 번째 자막')

  await expect.poll(async () => page.locator('.save-status').textContent(), { timeout: 5_000 }).toContain('자동 저장됨')
  await page.reload()
  const restore = page.getByRole('button', { name: '복원', exact: true })
  if (await restore.isVisible()) await restore.click()
  else {
    const homeRestore = page.getByRole('button', { name: /자동 저장.*복원|복원/ }).first()
    if (await homeRestore.isVisible()) await homeRestore.click()
  }
  await expect(page.locator('.timeline__lane--text')).toHaveCount(2)
})

test('caption dialog stays usable on phone width', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile')
  await page.goto('/')
  await page.getByRole('button', { name: '자막', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '자막 가져오기·내보내기' })
  await expect(dialog).toBeVisible()
  const box = await dialog.boundingBox()
  expect(box?.x).toBeGreaterThanOrEqual(0)
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(390)
})
