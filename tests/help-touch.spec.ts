import { expect, test } from '@playwright/test'
import { fileURLToPath } from 'node:url'

const appIcon = fileURLToPath(new URL('../public/app-icon.svg', import.meta.url))

test('help is available from the toolbar and keyboard without editing behind dialogs', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Keyboard help flow is covered once on desktop')

  await page.goto('/')
  await page.getByRole('button', { name: '도움말 열기' }).click()
  const dialog = page.getByRole('dialog', { name: '사용 도움말' })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('아이폰·아이패드')
  await expect(dialog).toContainText('⌘/Ctrl + S')

  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await page.keyboard.press('?')
  await expect(dialog).toBeVisible()
  await expect(page.locator('.timeline-marker')).toHaveCount(0)
  await page.keyboard.press('m')
  await expect(page.locator('.timeline-marker')).toHaveCount(0)
})

test('touch users can select several timeline items and reach large trim handles', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'Touch interaction is covered on the mobile project')

  await page.goto('/')
  await page.locator('header input[type=file]').nth(3).setInputFiles(appIcon)
  await page.getByRole('button', { name: '왼쪽 미디어 패널 열기·닫기' }).click()
  const asset = page.locator('.media-asset').filter({ hasText: 'app-icon.svg' })
  await asset.click()
  await asset.getByRole('button', { name: '메인에 추가' }).click()
  await asset.getByRole('button', { name: '레이어에 추가' }).click()
  await page.getByRole('button', { name: '미디어 패널 닫기' }).click()

  const main = page.locator('.timeline__track .clip')
  const overlay = page.locator('.timeline__lane--overlay .tlclip')
  await page.getByRole('button', { name: '여러 항목' }).tap()
  await overlay.tap()
  await main.tap()
  await overlay.tap()
  await expect(page.getByRole('button', { name: '그룹 만들기 (2)' })).toBeVisible()

  const handleWidths = await page.locator('.clip__handle, .tlclip__handle').evaluateAll((handles) =>
    handles.map((handle) => Math.round(handle.getBoundingClientRect().width)))
  expect(handleWidths.length).toBeGreaterThanOrEqual(4)
  expect(Math.min(...handleWidths)).toBeGreaterThanOrEqual(22)

  await page.getByRole('button', { name: '그룹 만들기 (2)' }).tap()
  await expect(page.locator('.timeline-group-badge')).toHaveCount(2)
  await expect(page.getByRole('button', { name: '여러 항목' })).toHaveAttribute('aria-pressed', 'false')
})

test('touch preview handles and playhead have comfortable hit targets', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'desktop', 'Touch target sizing is covered on touch projects')

  await page.goto('/')
  await page.locator('header input[type=file]').nth(3).setInputFiles(appIcon)
  await page.getByRole('button', { name: '왼쪽 미디어 패널 열기·닫기' }).click()
  const asset = page.locator('.media-asset').filter({ hasText: 'app-icon.svg' })
  await asset.click()
  await asset.getByRole('button', { name: '레이어에 추가' }).click()
  await page.getByRole('button', { name: '미디어 패널 닫기' }).click()

  const controls = page.locator('.preview__overlay-controls')
  await expect(controls).toBeVisible()
  const handleSizes = await controls.locator('.preview__resize').evaluateAll((handles) => handles.map((handle) => {
    const rect = handle.getBoundingClientRect()
    return { width: Math.round(rect.width), height: Math.round(rect.height) }
  }))
  expect(handleSizes).toHaveLength(8)
  expect(Math.min(...handleSizes.map((size) => size.width))).toBeGreaterThanOrEqual(44)
  expect(Math.min(...handleSizes.map((size) => size.height))).toBeGreaterThanOrEqual(44)

  const rotateBox = await controls.locator('.preview__rotate').boundingBox()
  const playheadBox = await page.getByRole('slider', { name: '타임라인 재생 헤드' }).boundingBox()
  expect(rotateBox).not.toBeNull()
  expect(playheadBox).not.toBeNull()
  expect(rotateBox!.width).toBeGreaterThanOrEqual(44)
  expect(rotateBox!.height).toBeGreaterThanOrEqual(44)
  expect(playheadBox!.width).toBeGreaterThanOrEqual(48)

  await expect(page.locator('.preview__selection-tools')).toBeHidden()
  await page.getByRole('button', { name: '자르기', exact: true }).tap()
  await expect(page.getByRole('dialog', { name: '자르기', exact: true })).toBeVisible()
})

test('two fingers move, scale, and rotate the selected preview item together', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'desktop', 'Multi-touch preview editing is covered on touch projects')

  await page.goto('/')
  await page.locator('header input[type=file]').nth(3).setInputFiles(appIcon)
  await page.getByRole('button', { name: '왼쪽 미디어 패널 열기·닫기' }).click()
  const asset = page.locator('.media-asset').filter({ hasText: 'app-icon.svg' })
  await asset.click()
  await asset.getByRole('button', { name: '레이어에 추가' }).click()
  await page.getByRole('button', { name: '미디어 패널 닫기' }).click()

  const controls = page.locator('.preview__overlay-controls')
  await expect(controls).toBeVisible()
  const before = await controls.boundingBox()
  if (!before) throw new Error('선택 영역을 읽을 수 없습니다.')
  const center = { x: before.x + before.width / 2, y: before.y + before.height / 2 }
  const first = { x: center.x - Math.min(40, before.width / 4), y: center.y }
  const second = { x: center.x + Math.min(40, before.width / 4), y: center.y }

  await controls.dispatchEvent('pointerdown', { pointerType: 'touch', pointerId: 21, isPrimary: true, button: 0, clientX: first.x, clientY: first.y })
  await controls.dispatchEvent('pointerdown', { pointerType: 'touch', pointerId: 22, isPrimary: false, button: 0, clientX: second.x, clientY: second.y })
  await page.evaluate(({ first, second }) => {
    window.dispatchEvent(new PointerEvent('pointermove', { pointerType: 'touch', pointerId: 21, isPrimary: true, button: 0, clientX: first.x - 28, clientY: first.y - 24 }))
    window.dispatchEvent(new PointerEvent('pointermove', { pointerType: 'touch', pointerId: 22, isPrimary: false, button: 0, clientX: second.x + 28, clientY: second.y + 24 }))
    window.dispatchEvent(new PointerEvent('pointerup', { pointerType: 'touch', pointerId: 21, isPrimary: true, button: 0, clientX: first.x - 28, clientY: first.y - 24 }))
    window.dispatchEvent(new PointerEvent('pointerup', { pointerType: 'touch', pointerId: 22, isPrimary: false, button: 0, clientX: second.x + 28, clientY: second.y + 24 }))
  }, { first, second })

  await expect.poll(async () => (await controls.boundingBox())?.width ?? 0).toBeGreaterThan(before.width * 1.2)
  await expect.poll(() => controls.evaluate((element) => element.getAttribute('style') ?? '')).not.toContain('rotate(0deg)')
})

test('an unrelated second pointer cannot cancel an active playhead drag', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'desktop', 'Pointer identity matters on touch projects')

  await page.goto('/')
  await page.getByRole('button', { name: '텍스트', exact: true }).click()
  const playhead = page.getByRole('slider', { name: '타임라인 재생 헤드' })
  const box = await playhead.boundingBox()
  if (!box) throw new Error('재생 헤드 위치를 읽을 수 없습니다.')
  const start = { x: box.x + box.width / 2, y: box.y + 18 }

  await playhead.dispatchEvent('pointerdown', { pointerType: 'touch', pointerId: 31, isPrimary: true, button: 0, clientX: start.x, clientY: start.y })
  await page.evaluate(({ start }) => {
    window.dispatchEvent(new PointerEvent('pointermove', { pointerType: 'touch', pointerId: 31, isPrimary: true, clientX: start.x + 24, clientY: start.y }))
  }, { start })
  const afterFirstMove = Number(await playhead.getAttribute('aria-valuenow'))
  await page.evaluate(({ start }) => {
    window.dispatchEvent(new PointerEvent('pointerup', { pointerType: 'touch', pointerId: 32, isPrimary: false, clientX: start.x, clientY: start.y }))
    window.dispatchEvent(new PointerEvent('pointermove', { pointerType: 'touch', pointerId: 31, isPrimary: true, clientX: start.x + 48, clientY: start.y }))
    window.dispatchEvent(new PointerEvent('pointerup', { pointerType: 'touch', pointerId: 31, isPrimary: true, clientX: start.x + 48, clientY: start.y }))
  }, { start })

  await expect.poll(async () => Number(await playhead.getAttribute('aria-valuenow'))).toBeGreaterThan(afterFirstMove * 1.8)
})
