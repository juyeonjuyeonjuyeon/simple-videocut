import { expect, test } from '@playwright/test'

test('project home supports overwrite, save as, and reopening a saved project', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Project persistence flow is covered once on desktop')

  await page.goto('/')
  await page.getByRole('button', { name: '텍스트', exact: true }).click()
  await page.getByRole('button', { name: '프로젝트 홈 열기' }).click()
  await expect(page.getByRole('dialog', { name: '프로젝트 홈' })).toBeVisible()
  await expect(page.getByText('현재 편집으로 돌아가기')).toBeVisible()

  await page.getByRole('button', { name: '프로젝트 저장', exact: true }).click()
  const nameInput = page.getByRole('textbox', { name: '새 프로젝트 이름' })
  await expect(nameInput).toBeVisible()
  await nameInput.fill('저장 검사')
  await page.getByRole('button', { name: '저장', exact: true }).click()
  await expect(nameInput).toBeHidden()

  const textArea = page.locator('.inspector textarea').first()
  await textArea.fill('덮어쓰기 뒤에도 남는 내용')
  await page.keyboard.press('Meta+s')
  await expect(page.getByRole('status')).toContainText('프로젝트 저장됨')

  await page.getByRole('button', { name: '프로젝트 홈 열기' }).click()
  await expect(page.locator('.project-card')).toHaveCount(1)
  await expect(page.locator('.project-card').filter({ hasText: '저장 검사' })).toHaveCount(1)

  await page.getByRole('button', { name: '다른 이름으로 저장', exact: true }).click()
  await nameInput.fill('다른 이름')
  await page.getByRole('button', { name: '새로 저장', exact: true }).click()
  await page.getByRole('button', { name: '프로젝트 홈 열기' }).click()
  await expect(page.locator('.project-card')).toHaveCount(2)

  await page.reload()
  await expect(page.getByRole('dialog', { name: '프로젝트 홈' })).toBeVisible()
  await page.locator('.project-card').filter({ hasText: '저장 검사' }).getByRole('button').first().click()
  await expect(page.locator('.timeline__lane--text .tlclip__body')).toContainText('덮어쓰기 뒤에도 남는 내용')
  await page.locator('.timeline__lane--text .tlclip').click()
  await expect(page.locator('.inspector textarea').first()).toHaveValue('덮어쓰기 뒤에도 남는 내용')
})
