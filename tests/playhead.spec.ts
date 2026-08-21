import { expect, test } from '@playwright/test'

test('playhead supports time entry, frame steps, wide dragging, and empty-track seeking', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Precise pointer geometry is covered once on desktop')

  await page.goto('/')
  await page.getByRole('button', { name: '텍스트', exact: true }).click()

  const playhead = page.getByRole('slider', { name: '타임라인 재생 헤드' })
  const time = page.getByRole('textbox', { name: '재생 헤드 시간' })
  await time.fill('00:01.50')
  await time.press('Enter')
  await expect.poll(async () => Number(await playhead.getAttribute('aria-valuenow'))).toBeCloseTo(1.5, 2)

  await page.getByRole('button', { name: '다음 프레임' }).click()
  await expect.poll(async () => Number(await playhead.getAttribute('aria-valuenow'))).toBeCloseTo(1.5 + 1 / 30, 2)

  const before = await playhead.boundingBox()
  if (!before) throw new Error('재생 헤드 위치를 읽을 수 없습니다.')
  await page.mouse.move(before.x + 2, before.y + 12)
  await page.mouse.down()
  await page.mouse.move(before.x + 42, before.y + 12, { steps: 4 })
  await page.mouse.up()
  const after = await playhead.boundingBox()
  if (!after) throw new Error('이동한 재생 헤드 위치를 읽을 수 없습니다.')
  expect(after.x - before.x).toBeCloseTo(40, 0)

  const emptyTrack = page.locator('.timeline__track')
  const trackBox = await emptyTrack.boundingBox()
  if (!trackBox) throw new Error('타임라인 위치를 읽을 수 없습니다.')
  const targetX = trackBox.x + trackBox.width * 0.72
  await page.mouse.click(targetX, trackBox.y + trackBox.height / 2)
  const sought = await playhead.boundingBox()
  if (!sought) throw new Error('탐색한 재생 헤드 위치를 읽을 수 없습니다.')
  expect(sought.x + sought.width / 2).toBeCloseTo(targetX, 0)
})
