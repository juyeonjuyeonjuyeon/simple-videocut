import { expect, test } from '@playwright/test'
import { fileURLToPath } from 'node:url'

const appIcon = fileURLToPath(new URL('../public/app-icon.svg', import.meta.url))

test('timeline context menu groups items and fits a layer to its grouped main clip', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Context-menu grouping geometry is covered once on desktop')

  await page.goto('/')
  await page.locator('header input[type=file]').nth(3).setInputFiles(appIcon)
  const asset = page.locator('.media-asset').filter({ hasText: 'app-icon.svg' })
  await asset.click()
  await asset.getByRole('button', { name: '메인에 추가' }).click()
  await asset.getByRole('button', { name: '레이어에 추가' }).click()

  const main = page.locator('.timeline__track .clip')
  const overlay = page.locator('.timeline__lane--overlay .tlclip')
  await main.click()
  await overlay.click({ modifiers: ['Meta'] })
  await page.getByRole('button', { name: '그룹 만들기 (2)' }).click()
  await expect(page.locator('.timeline-group-badge')).toHaveCount(2)
  await expect(page.locator('.timeline__group-summary')).toContainText('2개')

  await page.getByRole('textbox', { name: '재생 헤드 시간' }).fill('00:01.50')
  await page.getByRole('textbox', { name: '재생 헤드 시간' }).press('Enter')
  await overlay.click({ button: 'right' })
  const menu = page.getByRole('menu')
  await expect(menu.locator('.timeline-menu__label')).toHaveText(['그룹', '위치', '길이 맞춤', '레이어 순서', '트랙 이동', '편집'])
  await menu.getByRole('menuitem', { name: '재생 헤드 위치로 이동' }).click()

  await overlay.click({ button: 'right' })
  await page.getByRole('menuitem', { name: '그룹 기준 항목 구간에 맞춤 (메인 클립)' }).click()
  await expect.poll(async () => {
    const mainBox = await main.boundingBox()
    const overlayBox = await overlay.boundingBox()
    if (!mainBox || !overlayBox) return { x: 999, width: 999 }
    return { x: Math.abs(overlayBox.x - mainBox.x), width: Math.abs(overlayBox.width - mainBox.width) }
  }).toEqual({ x: 0, width: 0 })

  await overlay.click({ button: 'right' })
  await page.getByRole('menuitem', { name: '그룹 해제' }).click()
  await expect(page.locator('.timeline-group-badge')).toHaveCount(0)
})
