import { expect, test } from '@playwright/test'

const image = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#cf7a7d"/></svg>',
)

test('inspector shows focused tabs for media and text selections', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Inspector structure is covered once on desktop')

  await page.goto('/')
  await page.locator('header input[type=file]').nth(1).setInputFiles({
    name: 'layer.svg', mimeType: 'image/svg+xml', buffer: image,
  })

  const tabs = page.getByRole('tablist', { name: '속성 종류' })
  await expect(tabs.getByRole('tab')).toHaveText(['기본', '변형', '스타일', '시간'])
  await expect(tabs.getByRole('tab', { name: '기본' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('heading', { name: '기본 정보' })).toBeVisible()
  await expect(page.getByText('가로 위치', { exact: true })).toHaveCount(0)

  await tabs.getByRole('tab', { name: '변형' }).click()
  await expect(page.getByText('가로 위치', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: '자르기' })).toBeVisible()
  await expect(page.locator('.inspector').getByRole('textbox', { name: '이름', exact: true })).toHaveCount(0)

  await tabs.getByRole('tab', { name: '스타일' }).click()
  await expect(page.getByRole('heading', { name: '마스크 모양' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '테두리' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '그림자' })).toBeVisible()

  await page.getByRole('button', { name: '텍스트', exact: true }).click()
  await expect(tabs.getByRole('tab')).toHaveText(['내용', '스타일', '배치', '시간'])
  await expect(page.getByRole('textbox', { name: '텍스트 내용' })).toBeVisible()

  await tabs.getByRole('tab', { name: '스타일' }).click()
  await expect(page.getByRole('heading', { name: '배경 박스' })).toBeVisible()
  await tabs.getByRole('tab', { name: '배치' }).click()
  await expect(page.getByRole('heading', { name: '움직임' })).toBeVisible()
})
