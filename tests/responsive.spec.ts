import { expect, test, type Page } from '@playwright/test'
import { fileURLToPath } from 'node:url'

const appIcon = fileURLToPath(new URL('../public/app-icon.svg', import.meta.url))

async function addTestImage(page: Page) {
  await page.locator('header input[type=file]').first().setInputFiles(appIcon)
  await expect(page.locator('.timeline__track .clip')).toHaveCount(1)
}

test('editor shell fits the viewport and exposes primary controls', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('button', { name: '재생', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '프로젝트 홈 열기', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '실행 취소' })).toBeVisible()

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
  expect(overflow).toBe(false)
})

test('phone uses a bottom property sheet without pushing away the timeline', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await addTestImage(page)

  await expect(page.getByRole('complementary', { name: '편집 속성' })).toBeHidden()
  await page.getByRole('button', { name: '편집', exact: true }).click()

  const inspector = page.getByRole('complementary', { name: '편집 속성' })
  const timeline = page.locator('.timeline')
  const preview = page.locator('.preview')
  await expect(inspector).toBeVisible()

  const [position, inspectorBox, timelineBox, previewBox] = await Promise.all([
    inspector.evaluate((element) => getComputedStyle(element).position),
    inspector.boundingBox(),
    timeline.boundingBox(),
    preview.boundingBox(),
  ])
  expect(position).toBe('fixed')
  expect(inspectorBox).not.toBeNull()
  expect(timelineBox).not.toBeNull()
  expect(previewBox).not.toBeNull()
  expect(Math.abs((inspectorBox?.y ?? 0) + (inspectorBox?.height ?? 0) - (timelineBox?.y ?? 0))).toBeLessThanOrEqual(2)
  expect(previewBox?.height ?? 0).toBeGreaterThan(180)
  expect(timelineBox?.height ?? 0).toBeGreaterThanOrEqual(200)
})

test('phone landscape keeps the preview visible', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 })
  await page.goto('/')
  await addTestImage(page)

  const previewBox = await page.locator('.preview').boundingBox()
  const timelineBox = await page.locator('.timeline').boundingBox()
  expect(previewBox).not.toBeNull()
  expect(timelineBox).not.toBeNull()
  expect(previewBox?.height ?? 0).toBeGreaterThan(80)
  expect(timelineBox?.height ?? Infinity).toBeLessThanOrEqual(140)
})

test('iPad portrait overlays one panel instead of shrinking the editor into three columns', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 1366 })
  await page.goto('/')
  await addTestImage(page)

  await expect(page.getByRole('complementary', { name: '편집 속성' })).toBeHidden()
  await page.getByRole('button', { name: '편집', exact: true }).click()
  const inspector = page.getByRole('complementary', { name: '편집 속성' })
  await expect(inspector).toBeVisible()
  await expect.poll(() => inspector.evaluate((element) => getComputedStyle(element).position)).toBe('fixed')

  const stageWidth = await page.locator('.stage').evaluate((element) => element.getBoundingClientRect().width)
  const previewColumnWidth = await page.locator('.stage__preview').evaluate((element) => element.getBoundingClientRect().width)
  expect(stageWidth).toBe(1024)
  expect(previewColumnWidth).toBe(1024)

  await page.getByRole('button', { name: '왼쪽 미디어 패널 열기·닫기' }).click()
  await expect(inspector).toBeHidden()
  await expect(page.getByRole('complementary', { name: '프로젝트 미디어' })).toBeVisible()
})
