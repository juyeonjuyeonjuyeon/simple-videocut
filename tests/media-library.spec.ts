import { expect, test } from '@playwright/test'
import { fileURLToPath } from 'node:url'

const appIcon = fileURLToPath(new URL('../public/app-icon.svg', import.meta.url))

test('media library keeps one reusable source and restores it with the project', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Media-bin persistence flow is covered once on desktop')

  await page.goto('/')
  await page.locator('header input[type=file]').nth(3).setInputFiles(appIcon)

  const asset = page.locator('.media-asset').filter({ hasText: 'app-icon.svg' })
  await expect(asset).toHaveCount(1)
  await expect(page.locator('.timeline__track .clip')).toHaveCount(0)

  await asset.click()
  await asset.getByRole('button', { name: '메인에 추가' }).click()
  await asset.getByRole('button', { name: '레이어에 추가' }).click()
  await expect(page.locator('.timeline__track .clip')).toHaveCount(1)
  await expect(page.locator('.timeline__lane--overlay .tlclip')).toHaveCount(1)
  await expect(asset).toContainText('2회 사용')

  await page.getByRole('tab', { name: '사용 중' }).click()
  await expect(page.locator('.media-row')).toHaveCount(2)
  await page.getByRole('tab', { name: '보관함' }).click()
  await page.getByRole('status').filter({ hasText: '저장됨' }).waitFor({ timeout: 20_000 })

  await page.reload()
  await page.getByRole('button', { name: '복원', exact: true }).click()
  await expect(page.locator('.media-asset').filter({ hasText: 'app-icon.svg' })).toHaveCount(1)
  await expect(page.locator('.timeline__track .clip')).toHaveCount(1)
  await expect(page.locator('.timeline__lane--overlay .tlclip')).toHaveCount(1)
})

test('pasted Apple-style media is collected in the reusable media bin', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'Clipboard media import is covered once on mobile')

  await page.goto('/')
  await page.evaluate(() => {
    const transfer = new DataTransfer()
    transfer.items.add(new File([
      '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#d77d86"/></svg>',
    ], '붙여넣은 사진.svg', { type: 'image/svg+xml', lastModified: 7 }))
    window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer }))
  })

  await page.getByRole('button', { name: '왼쪽 미디어 패널 열기·닫기' }).click()
  await expect(page.locator('.media-asset').filter({ hasText: '붙여넣은 사진.svg' })).toHaveCount(1)
  await expect(page.locator('.timeline__track .clip')).toHaveCount(0)
})
