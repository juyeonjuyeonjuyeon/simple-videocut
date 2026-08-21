import { expect, test } from '@playwright/test'

test('creates and edits captions through the dedicated list and timeline', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Caption desktop editing flow is covered once')

  await page.goto('/')
  await page.getByRole('button', { name: '자막', exact: true }).click()
  const dialog = page.getByRole('heading', { name: '자막', exact: true }).locator('..').locator('..')
  await expect(page.getByText('자막 트랙을 만들어 시작하세요.')).toBeVisible()
  await page.getByRole('button', { name: '자막 트랙 만들기' }).click()
  await page.getByRole('button', { name: '현재 위치에 자막', exact: true }).click()

  const captionText = page.getByRole('textbox', { name: '1번 자막' })
  await expect(captionText).toBeVisible()
  await captionText.fill('전용 자막 테스트')
  await dialog.getByRole('button', { name: '닫기' }).click()

  await expect(page.locator('.preview__caption')).toContainText('전용 자막 테스트')
  await expect(page.locator('.timeline__lane--caption')).toBeVisible()
  await expect(page.locator('.timeline__lane--caption').getByText(/전용 자막 테스트/)).toBeVisible()
  await page.locator('.timeline__lane--caption').getByText(/전용 자막 테스트/).click()

  const tabs = page.getByRole('tablist', { name: '속성 종류' })
  await expect(tabs.getByRole('tab')).toHaveText(['자막', '스타일', '시간'])
  const inspectorText = page.getByRole('textbox', { name: '자막 내용' })
  await expect(inspectorText).toHaveValue('전용 자막 테스트')
  await inspectorText.fill('수정된 자막')
  await expect(page.locator('.timeline__lane--caption').getByText(/수정된 자막/)).toBeVisible()
  await tabs.getByRole('tab', { name: '스타일' }).click()
  await expect(page.getByRole('heading', { name: '화면 배치와 안전 영역' })).toBeVisible()
  await expect(page.locator('.preview__caption-safe-area')).toBeVisible()
})
