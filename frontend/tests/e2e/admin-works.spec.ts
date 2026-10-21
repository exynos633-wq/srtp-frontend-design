import { expect, test, type Page } from '@playwright/test'

async function signIn(page: Page) {
  await page.getByLabel('账号', { exact: false }).fill('admin')
  await page.getByLabel('密码', { exact: false }).fill('admin')
  await expect(page.getByRole('button', { name: '登录', exact: true })).toBeEnabled()
  await page.getByLabel('密码', { exact: false }).press('Enter')
}

async function openAdminWorks(page: Page) {
  await page.goto('/admin/works')
  await expect(page.getByRole('heading', { name: '管理员登录' })).toBeVisible()
  await signIn(page)
  await expect(page).toHaveURL(/\/admin\/works$/)
  await expect(page.getByRole('heading', { name: '作品管理' })).toBeVisible()
}

async function createLongDraft(page: Page, name: string) {
  await page.evaluate(async (draftName) => {
    const response = await fetch('/api/admin/works', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: draftName, description: '长标题回归测试。' }),
    })
    if (!response.ok) throw new Error(`创建草稿失败：${response.status}`)
  }, name)
}

test('管理列表区分三种状态，入口完整，发布与下架可用', async ({ page }) => {
  await openAdminWorks(page)

  const table = page.getByRole('table', { name: '管理作品列表' })
  await expect(table).toBeVisible()
  await expect(page.getByRole('heading', { name: '作品管理' })).toBeFocused()
  await expect(page.getByText(/发布前请先保存作品资料/)).toBeVisible()

  const published = table.getByRole('row', { name: /院落模型/ })
  await expect(published.getByText('已发布', { exact: true })).toBeVisible()
  await expect(published.getByText('北京市', { exact: true })).toBeVisible()
  await expect(published.getByText('GLB', { exact: true })).toBeVisible()
  await expect(published.getByRole('link', { name: '编辑 院落模型' })).toHaveAttribute(
    'href',
    '/admin/works/work_demo_001/edit',
  )
  await expect(published.getByRole('link', { name: '预览 院落模型' })).toHaveAttribute(
    'href',
    '/admin/works/work_demo_001/preview',
  )
  await expect(published.getByRole('button', { name: '下架 院落模型' })).toBeEnabled()

  const draft = table.getByRole('row', { name: /待补资源的草稿/ })
  await expect(draft.getByText('草稿', { exact: true })).toBeVisible()
  await expect(draft.getByText('上海市', { exact: true })).toBeVisible()
  await expect(draft.getByText('未设置', { exact: true })).toBeVisible()
  await expect(draft.getByText('缺封面')).toBeVisible()
  await expect(draft.getByRole('button', { name: '发布 待补资源的草稿' })).toBeEnabled()

  const offline = table.getByRole('row', { name: /已下架占位/ })
  await expect(offline.getByText('已下架', { exact: true })).toBeVisible()
  await expect(offline.getByRole('button', { name: '发布 已下架占位' })).toBeEnabled()

  const edit = published.getByRole('link', { name: '编辑 院落模型' })
  await edit.focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/admin\/works\/work_demo_001\/edit$/)
  await expect(page.getByRole('heading', { name: '编辑作品' })).toBeVisible()
})

test('键盘激活预览入口后焦点落在预览主标题', async ({ page }) => {
  await openAdminWorks(page)
  const table = page.getByRole('table', { name: '管理作品列表' })
  await expect(table).toBeVisible()

  const preview = table.getByRole('link', { name: '预览 院落模型' })
  await preview.focus()
  await page.keyboard.press('Enter')

  await expect(page).toHaveURL(/\/admin\/works\/work_demo_001\/preview$/)
  await expect(page.getByRole('heading', { name: '管理员预览' })).toBeFocused()
  await expect(page.getByRole('heading', { name: '院落模型' })).toBeVisible()
  await expect(page.getByRole('button', { name: '开始预览' })).toBeEnabled()
})

test('管理列表空状态与失败重试，登录不被列表故障阻断', async ({ page }) => {
  await page.goto('/admin/works?mockScenario=admin-list-empty')
  await expect(page.getByRole('heading', { name: '管理员登录' })).toBeVisible()
  await signIn(page)
  await expect(page.getByRole('heading', { name: '作品管理' })).toBeVisible()
  await expect(page.getByText(/管理列表暂无作品/)).toBeVisible()
  await expect(page.getByText(/可先新建草稿/)).toBeVisible()
  await expect(page.getByRole('link', { name: '新建作品', exact: true })).toBeVisible()
  await expect(page.getByRole('table', { name: '管理作品列表' })).toHaveCount(0)

  await page.goto('/admin/works?mockScenario=admin-list-failure')
  await expect(page.getByRole('heading', { name: '管理员登录' })).toBeVisible()
  await signIn(page)
  await expect(page.getByText('读取管理作品列表失败。')).toBeVisible()
  await expect(page.getByRole('button', { name: '手动重试' })).toBeVisible()
  await expect(page.getByRole('table', { name: '管理作品列表' })).toHaveCount(0)

  await page.evaluate(() => window.__mockControls?.setScenario('normal'))
  await page.getByRole('button', { name: '手动重试' }).click()
  await expect(page.getByRole('table', { name: '管理作品列表' })).toBeVisible()
  await expect(page.getByRole('row', { name: /院落模型/ })).toBeVisible()
})

test('管理员授权预览草稿走管理接口，不调用公开详情也不下载模型', async ({ page }) => {
  await openAdminWorks(page)
  const requests: string[] = []
  page.on('request', (request) => requests.push(request.url()))

  const draft = page.getByRole('row', { name: /未命名草稿/ })
  await draft.getByRole('link', { name: '预览 未命名草稿' }).click()
  await expect(page).toHaveURL(/\/admin\/works\/work_draft_001\/preview$/)
  await expect(page.getByRole('heading', { name: '管理员预览' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '未命名草稿' })).toBeVisible()
  await expect(page.getByText('封面待预览')).toBeVisible()
  await expect(page.getByRole('button', { name: '开始预览' })).toBeEnabled()

  expect(requests.some((url) => /\/api\/works\/work_draft_001$/.test(url))).toBe(false)
  expect(requests.some((url) => /\.(glb|ply)(\?|$)/.test(url))).toBe(false)

  await page.getByRole('button', { name: '开始预览' }).click()
  await expect(page.getByText('正在准备预览')).toBeVisible()
  expect(requests.some((url) => /\.(glb|ply)(\?|$)/.test(url))).toBe(false)
})

for (const width of [320, 390, 768, 1440]) {
  test(`管理列表 ${width}px 长标题不横向溢出，操作可键盘到达`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/admin/works/new')
    await expect(page.getByRole('heading', { name: '管理员登录' })).toBeVisible()
    await signIn(page)
    await expect(page.getByRole('heading', { name: '新建作品' })).toBeVisible()

    const longName = '超长作品名称用于检查换行与操作完整性'.repeat(4)
    await createLongDraft(page, longName)
    await page.getByRole('link', { name: '返回作品管理', exact: true }).click()
    await expect(page.getByRole('heading', { name: '作品管理' })).toBeVisible()

    const name = page.getByText(longName, { exact: true })
    await expect(name).toBeVisible()
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
    expect(await name.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
      true,
    )

    const row = name.locator('xpath=ancestor::tr')
    const rowDisplay = await row.evaluate((element) => getComputedStyle(element).display)
    expect(rowDisplay).toBe(width >= 1024 ? 'table-row' : 'grid')

    const edit = row.getByRole('link', { name: new RegExp(`^编辑 ${longName.slice(0, 4)}`) })
    await edit.scrollIntoViewIfNeeded()
    await expect(edit).toBeVisible()
    await expect(row.getByRole('link', { name: new RegExp('^预览 ') })).toBeVisible()
    await expect(row.getByRole('button', { name: new RegExp('^发布 ') })).toBeEnabled()

    const box = await edit.boundingBox()
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)

    await edit.focus()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/admin\/works\/[^/]+\/edit$/)
    await expect(page.getByRole('heading', { name: '编辑作品' })).toBeVisible()
  })
}
