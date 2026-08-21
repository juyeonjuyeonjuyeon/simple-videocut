import { expect, test } from '@playwright/test'

const svg = (color: string) => Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="${color}"/></svg>`,
)

test('selecting a lower overlay never changes the rendered layer order', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Layer stacking is covered once on desktop')

  await page.goto('/')
  await page.locator('header input[type=file]').nth(1).setInputFiles([
    { name: 'lower-red.svg', mimeType: 'image/svg+xml', buffer: svg('#ff0000') },
    { name: 'upper-blue.svg', mimeType: 'image/svg+xml', buffer: svg('#0000ff') },
  ])

  const overlays = page.locator('.preview__overlay')
  await expect(overlays).toHaveCount(2)
  await expect(overlays.nth(0)).toBeVisible()
  await expect(overlays.nth(1)).toBeVisible()

  await page.locator('.tlclip', { hasText: 'lower-red.svg' }).click()

  const controls = page.locator('.preview__overlay-controls')
  await expect(controls).toBeVisible()
  const controlsZ = Number.parseInt(await controls.evaluate((element) => getComputedStyle(element).zIndex), 10)

  const zIndexes = await overlays.evaluateAll((elements) =>
    elements.map((element) => Number.parseInt(getComputedStyle(element).zIndex, 10)),
  )
  expect(zIndexes[0]).toBeLessThan(zIndexes[1])
  expect(controlsZ).toBeGreaterThan(zIndexes[1])

  const lowerRow = await page.locator('.tlclip', { hasText: 'lower-red.svg' }).boundingBox()
  const upperRow = await page.locator('.tlclip', { hasText: 'upper-blue.svg' }).boundingBox()
  expect(lowerRow).not.toBeNull()
  expect(upperRow).not.toBeNull()
  expect(upperRow!.y).toBeLessThan(lowerRow!.y)

  const lowerPreview = page.locator('.preview__overlay[data-layer-name="lower-red.svg"]')
  const upperPreview = page.locator('.preview__overlay[data-layer-name="upper-blue.svg"]')
  await page.locator('.tlclip', { hasText: 'upper-blue.svg' }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: '레이어 한 단계 아래로' }).click()
  await expect.poll(async () => ({
    lower: Number.parseInt(await lowerPreview.evaluate((element) => getComputedStyle(element).zIndex), 10),
    upper: Number.parseInt(await upperPreview.evaluate((element) => getComputedStyle(element).zIndex), 10),
  })).toMatchObject({ lower: 2001, upper: 2000 })

  const loweredUpperRow = await page.locator('.tlclip', { hasText: 'upper-blue.svg' }).boundingBox()
  const raisedLowerRow = await page.locator('.tlclip', { hasText: 'lower-red.svg' }).boundingBox()
  expect(loweredUpperRow!.y).toBeGreaterThan(raisedLowerRow!.y)

  await page.getByRole('button', { name: '실행 취소' }).click()
  await expect.poll(async () => ({
    lower: Number.parseInt(await lowerPreview.evaluate((element) => getComputedStyle(element).zIndex), 10),
    upper: Number.parseInt(await upperPreview.evaluate((element) => getComputedStyle(element).zIndex), 10),
  })).toMatchObject({ lower: 2000, upper: 2001 })

  await page.getByRole('button', { name: '텍스트', exact: true }).click()
  const textTrack = await page.locator('.timeline__lane--text').boundingBox()
  const overlayTrack = await page.locator('.timeline__lane--overlay').boundingBox()
  expect(textTrack).not.toBeNull()
  expect(overlayTrack).not.toBeNull()
  expect(textTrack!.y).toBeLessThan(overlayTrack!.y)
})

test('a cancelled touch never opens the timeline long-press menu', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'Touch cancellation is covered on the mobile project')

  await page.goto('/')
  await page.locator('header input[type=file]').nth(1).setInputFiles({
    name: 'touch-layer.svg',
    mimeType: 'image/svg+xml',
    buffer: svg('#00aa66'),
  })

  const chip = page.locator('.tlclip', { hasText: 'touch-layer.svg' })
  await expect(chip).toBeVisible()
  const box = await chip.boundingBox()
  expect(box).not.toBeNull()
  const point = { clientX: box!.x + box!.width / 2, clientY: box!.y + box!.height / 2 }

  await chip.dispatchEvent('pointerdown', {
    ...point, pointerType: 'touch', pointerId: 7, isPrimary: true, button: 0,
  })
  await chip.dispatchEvent('pointercancel', {
    ...point, pointerType: 'touch', pointerId: 7, isPrimary: true, button: 0,
  })
  await page.waitForTimeout(600)

  await expect(page.getByRole('menu')).toHaveCount(0)
})

test('a cancelled preview drag releases the overlay immediately', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Preview pointer cancellation is covered once on desktop')

  await page.goto('/')
  await page.locator('header input[type=file]').nth(1).setInputFiles({
    name: 'drag-layer.svg',
    mimeType: 'image/svg+xml',
    buffer: svg('#8844cc'),
  })

  const overlay = page.locator('.preview__overlay')
  await expect(overlay).toBeVisible()
  const initialLeft = await overlay.evaluate((element) => getComputedStyle(element).left)
  const box = await overlay.boundingBox()
  expect(box).not.toBeNull()
  const point = { clientX: box!.x + box!.width / 2, clientY: box!.y + box!.height / 2 }

  await overlay.dispatchEvent('pointerdown', {
    ...point, pointerType: 'touch', pointerId: 11, isPrimary: true, button: 0,
  })
  await overlay.dispatchEvent('pointercancel', {
    ...point, pointerType: 'touch', pointerId: 11, isPrimary: true, button: 0,
  })
  await page.evaluate(({ clientX, clientY }) => {
    window.dispatchEvent(new PointerEvent('pointermove', {
      clientX: clientX + 120,
      clientY: clientY + 80,
      pointerType: 'touch',
      pointerId: 11,
      isPrimary: true,
      button: 0,
    }))
  }, point)

  await expect(overlay).toHaveCSS('left', initialLeft)
  await expect.poll(() => page.evaluate(() => document.body.style.userSelect)).toBe('')
})

test('resizing an overlay keeps the opposite corner anchored', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Precise pointer geometry is covered once on desktop')

  await page.goto('/')
  await page.locator('header input[type=file]').nth(1).setInputFiles({
    name: 'resize-layer.svg',
    mimeType: 'image/svg+xml',
    buffer: svg('#cc7722'),
  })

  const controls = page.locator('.preview__overlay-controls')
  const handle = controls.locator('.preview__resize--br')
  await expect(handle).toBeVisible()
  const before = await controls.boundingBox()
  const handleBox = await handle.boundingBox()
  expect(before).not.toBeNull()
  expect(handleBox).not.toBeNull()

  await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2)
  await page.mouse.down()
  await page.mouse.move(handleBox!.x + handleBox!.width / 2 + 80, handleBox!.y + handleBox!.height / 2 + 45)
  await page.mouse.up()

  const after = await controls.boundingBox()
  expect(after).not.toBeNull()
  expect(Math.abs(after!.x - before!.x)).toBeLessThan(2)
  expect(Math.abs(after!.y - before!.y)).toBeLessThan(2)
  expect(after!.width).toBeGreaterThan(before!.width + 50)
})
