import { expect, test, type Page } from '@playwright/test'

async function signIn(page: Page) {
  await page.getByLabel('账号', { exact: false }).fill('admin')
  await page.getByLabel('密码', { exact: false }).fill('admin')
  const button = page.getByRole('button', { name: '登录', exact: true })
  await expect(button).toBeEnabled()
  await page.getByLabel('密码', { exact: false }).press('Enter')
}

test('直达草稿编辑、错误、键盘提交防重复、退出后拒绝草稿，刷新重新检查', async ({ page }) => {
  let requests = 0
  const modelRequests: string[] = []
  page.on('request', (request) => {
    if (request.url().endsWith('/api/auth/login')) requests++
    if (/\.(glb|ply)(\?|$)|preview-sessions/.test(request.url())) modelRequests.push(request.url())
  })
  await page.goto('/admin/works/work_draft_001/edit')
  await expect(page.getByRole('heading', { name: '管理员登录' })).toBeVisible()
  await page.getByLabel('账号', { exact: false }).fill('wrong')
  await page.getByLabel('密码', { exact: false }).fill('wrong')
  await expect(page.getByRole('button', { name: '登录', exact: true })).toBeEnabled()
  await page.getByLabel('密码', { exact: false }).press('Enter')
  await expect(page.getByText('账号或密码不正确。')).toBeVisible()
  await expect(page.getByLabel('密码', { exact: false })).toHaveValue('wrong')
  await signIn(page)
  await page.getByLabel('密码', { exact: false }).press('Enter')
  await expect(page).toHaveURL(/\/admin\/works\/work_draft_001\/edit$/)
  await expect(page.getByRole('heading', { name: '编辑作品' })).toBeVisible()
  expect(requests).toBe(2)
  expect(modelRequests).toEqual([])
  await page.getByRole('link', { name: '返回作品管理', exact: true }).click()
  await expect(page.getByRole('heading', { name: '作品管理' })).toBeVisible()
  await page.getByRole('button', { name: '退出登录' }).click()
  await expect(page.getByRole('heading', { name: '管理员登录' })).toBeVisible()
  const status = await page.evaluate(async () => (await fetch('/api/admin/works/work_draft_001')).status)
  expect(status).toBe(401)
  await page.goBack()
  await expect(page.getByRole('heading', { name: '管理员登录' })).toBeVisible()
  await signIn(page)
  await expect(page.getByRole('heading', { name: '编辑作品' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: '管理员登录' })).toBeVisible()
})

test('会话失效、403保留路径，手动恢复', async ({ page }) => {
  await page.goto('/admin/login')
  await signIn(page)
  await expect(page.getByRole('heading', { name: '作品管理' })).toBeVisible()
  await page.evaluate(() => window.__mockControls?.setScenario('auth-expired'))
  await page.getByRole('link', { name: '新建作品', exact: true }).click()
  await expect(page.getByText('登录已失效，请重新登录。原管理路径已保留。')).toBeVisible()
  await page.evaluate(() => window.__mockControls?.setScenario('normal'))
  await signIn(page)
  await expect(page.getByRole('heading', { name: '新建作品' })).toBeVisible()
  await page.evaluate(() => window.__mockControls?.setScenario('auth-forbidden'))
  await page.getByRole('link', { name: '返回作品管理', exact: true }).click()
  await expect(page.getByText(/无权访问此管理路径/)).toBeVisible()
  await expect(page).toHaveURL(/\/admin\/works$/)
  await page.evaluate(() => window.__mockControls?.setScenario('normal'))
  await page.getByRole('button', { name: '重新检查认证' }).click()
  await expect(page.getByRole('heading', { name: '作品管理' })).toBeVisible()
})

for (const width of [320, 390, 768, 1440]) {
  test(`登录走查 ${width}px，短视口键盘提交与离开保护`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    await page.goto('/admin/login?returnTo=https://example.com')
    await expect(page.getByRole('heading', { name: '管理员登录' })).toBeVisible()
    await page.getByLabel('账号', { exact: false }).fill('admin')
    await page.getByLabel('密码', { exact: false }).fill('admin')
    // 缩短可见视口检查焦点与滚动；不能代替真实手机软键盘验收。
    await page.setViewportSize({ width, height: 400 })
    await page.getByLabel('密码', { exact: false }).focus()
    await expect(page.getByLabel('密码', { exact: false })).toBeInViewport()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    page.once('dialog', (dialog) => dialog.dismiss())
    await page.getByRole('link', { name: '全部作品', exact: true }).click()
    await expect(page).toHaveURL(/\/admin\/login/)
    await signIn(page)
    await expect(page).toHaveURL(/\/admin\/works$/)
    await expect(page.getByRole('button', { name: '退出登录' })).toBeVisible()
  })
}
