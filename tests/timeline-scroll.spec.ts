import { expect, test } from '@playwright/test'
import { fileURLToPath } from 'node:url'

const appIcon = fileURLToPath(new URL('../public/app-icon.svg', import.meta.url))

test('two-finger scrolling moves the timeline while pinch zoom stays explicit', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Trackpad wheel routing is covered once on desktop')

  await page.goto('/')
  await page.locator('header input[type=file]').nth(3).setInputFiles(appIcon)
  const asset = page.locator('.media-asset').filter({ hasText: 'app-icon.svg' })
  await asset.click()
  await asset.getByRole('button', { name: '메인에 추가' }).click()
  const addText = page.getByRole('button', { name: '텍스트', exact: true })
  for (let index = 0; index < 10; index += 1) await addText.click()

  const timeline = page.locator('.timeline__scroll')
  const zoom = page.getByRole('slider', { name: '타임라인 확대 비율' })
  const box = await timeline.boundingBox()
  if (!box) throw new Error('타임라인 영역을 읽을 수 없습니다.')
  expect(await timeline.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true)

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  const initialZoom = await zoom.inputValue()
  await page.mouse.wheel(0, 180)
  await expect.poll(() => timeline.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
  await expect(zoom).toHaveValue(initialZoom)

  await page.getByRole('button', { name: '타임라인 확대', exact: true }).click()
  await expect.poll(() => timeline.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true)
  const zoomBeforeHorizontalPan = await zoom.inputValue()
  await page.mouse.wheel(180, 0)
  await expect.poll(() => timeline.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0)
  await expect(zoom).toHaveValue(zoomBeforeHorizontalPan)

  const verticalPosition = await timeline.evaluate((element) => element.scrollTop)
  await timeline.dispatchEvent('wheel', { deltaX: 0, deltaY: 100, ctrlKey: true })
  await expect.poll(async () => Number(await zoom.inputValue())).toBeLessThan(Number(zoomBeforeHorizontalPan))
  await expect.poll(() => timeline.evaluate((element) => element.scrollTop)).toBeCloseTo(verticalPosition, 0)
})
