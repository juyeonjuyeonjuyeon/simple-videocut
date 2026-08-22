import { expect, test } from '@playwright/test'

const squareSvg = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240"><rect width="240" height="240" fill="#cf7a7d"/></svg>',
)

test('crop dialog exposes precise controls, preserves ratios, and only commits on apply', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Precise crop geometry is covered once on desktop')

  await page.goto('/')
  await page.locator('header input[type=file]').nth(1).setInputFiles({
    name: 'square.svg',
    mimeType: 'image/svg+xml',
    buffer: squareSvg,
  })

  await page.getByRole('button', { name: '자르기' }).click()
  const dialog = page.getByRole('dialog', { name: '자르기' })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('테두리로 영역 조절, 안쪽 드래그로 위치 이동')
  await expect(page.locator('.crophandle')).toHaveCount(8)
  await expect(page.locator('.cropedit__grid i')).toHaveCount(4)

  await page.getByRole('button', { name: '16:9', exact: true }).click()
  await expect(page.getByRole('button', { name: '16:9', exact: true })).toHaveClass(/is-active/)
  const before = await page.locator('.cropedit__rect').boundingBox()
  expect(before).not.toBeNull()
  expect(before!.width / before!.height).toBeCloseTo(16 / 9, 1)

  const rightHandle = await page.locator('.crophandle--r').boundingBox()
  expect(rightHandle).not.toBeNull()
  await page.mouse.move(rightHandle!.x + rightHandle!.width / 2, rightHandle!.y + rightHandle!.height / 2)
  await page.mouse.down()
  await page.mouse.move(rightHandle!.x + rightHandle!.width / 2 - 30, rightHandle!.y + rightHandle!.height / 2)
  await page.mouse.up()

  const after = await page.locator('.cropedit__rect').boundingBox()
  expect(after).not.toBeNull()
  expect(after!.width).toBeLessThan(before!.width - 15)
  expect(after!.width / after!.height).toBeCloseTo(16 / 9, 1)

  await dialog.getByRole('button', { name: '취소', exact: true }).click()
  await expect(dialog).toBeHidden()

  await page.getByRole('button', { name: '자르기' }).click()
  await expect(page.locator('.cropedit__rect')).toHaveAttribute('style', /inset: 0%|left: 0%; top: 0%; right: 0%; bottom: 0%/)
  await page.getByRole('button', { name: '1:1', exact: true }).click()
  await dialog.getByRole('button', { name: '적용', exact: true }).click()
  await expect(dialog).toBeHidden()

  await page.getByRole('button', { name: '자르기' }).click()
  const applied = await page.locator('.cropedit__rect').boundingBox()
  expect(applied).not.toBeNull()
  expect(applied!.width / applied!.height).toBeCloseTo(1, 1)
  await page.getByRole('button', { name: '초기화', exact: true }).click()
  await expect(page.locator('.cropedit__rect')).toHaveAttribute('style', /inset: 0%|left: 0%; top: 0%; right: 0%; bottom: 0%/)
  await dialog.getByRole('button', { name: '취소', exact: true }).click()

  await page.getByRole('tab', { name: '변형', exact: true }).click()
  await page.getByRole('button', { name: '자르기 편집창 열기', exact: true }).click()
  await expect(dialog).toBeVisible()
})
