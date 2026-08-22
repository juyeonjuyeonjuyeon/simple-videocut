import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'

test('creates and edits captions through the dedicated list and timeline', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Caption desktop editing flow is covered once')

  await page.goto('/')
  await page.getByRole('button', { name: '자막', exact: true }).click()
  const dialog = page.locator('.caption-dialog__panel')
  await expect(page.getByText('자막 트랙을 만들어 시작하세요.')).toBeVisible()
  await page.getByRole('button', { name: '자막 트랙 만들기' }).click()
  await page.getByRole('button', { name: '현재 위치에 자막', exact: true }).click()

  const captionText = page.getByRole('textbox', { name: '1번 자막' })
  await expect(captionText).toBeVisible()
  await captionText.fill('전용 자막 테스트')
  await page.locator('.caption-dialog input[type=file]').setInputFiles({
    name: 'sample.srt', mimeType: 'application/x-subrip',
    buffer: Buffer.from('1\r\n00:00:01,000 --> 00:00:02,000\r\n가져온 자막\r\n', 'utf8'),
  })
  await expect(dialog.getByRole('status')).toContainText('1개 자막을 가져왔습니다.')
  await expect(page.getByRole('textbox', { name: '2번 자막' })).toHaveValue('가져온 자막')

  await page.evaluate(() => { Reflect.deleteProperty(window, 'showSaveFilePicker') })
  const downloadPromise = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'SRT 내보내기' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('자막 1.srt')
  const downloadedPath = await download.path()
  expect(downloadedPath).not.toBeNull()
  const exported = await readFile(downloadedPath!, 'utf8')
  expect(exported).toContain('\uFEFF1\r\n00:00:00,000 -->')
  expect(exported).toContain('2\r\n00:00:01,000 --> 00:00:02,000\r\n가져온 자막')
  await dialog.getByRole('button', { name: '닫기', exact: true }).click()

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
  await tabs.getByRole('tab', { name: '시간' }).click()
  await expect(page.getByRole('heading', { name: '원본 미디어 연결' })).toBeVisible()
  await expect(page.getByRole('combobox', { name: '자막 원본 연결' })).toHaveValue('')
  await tabs.getByRole('tab', { name: '스타일' }).click()
  await expect(page.getByRole('heading', { name: '화면 배치와 안전 영역' })).toBeVisible()
  await expect(page.locator('.preview__caption-safe-area')).toBeVisible()
})
