import { expect, test, type Page } from '@playwright/test'

function adminWorkMutations(page: Page) {
  const requests: Array<{ method: string; url: string }> = []
  page.on('request', (request) => {
    const url = request.url()
    if (!/\/api\/admin\/works(?:\/[^/]+)?$/.test(url)) return
    if (request.method() === 'POST' || request.method() === 'PATCH') {
      requests.push({ method: request.method(), url })
    }
  })
  return requests
}

async function signIn(page: Page) {
  await page.getByLabel('账号', { exact: false }).fill('admin')
  await page.getByLabel('密码', { exact: false }).fill('admin')
  const button = page.getByRole('button', { name: '登录', exact: true })
  // 先等本页完成登录初始化，再按 Enter，避免上一轮竞态。
  await expect(button).toBeEnabled()
  await page.getByLabel('密码', { exact: false }).press('Enter')
}

async function openNew(page: Page) {
  await page.goto('/admin/works/new')
  await expect(page.getByRole('heading', { name: '管理员登录' })).toBeVisible()
  await signIn(page)
  await expect(page).toHaveURL(/\/admin\/works\/new$/)
  await expect(page.getByRole('heading', { name: '新建作品' })).toBeVisible()
}

async function openEdit(page: Page, id: string) {
  await page.goto(`/admin/works/${id}/edit`)
  await expect(page.getByRole('heading', { name: '管理员登录' })).toBeVisible()
  await signIn(page)
  await expect(page).toHaveURL(new RegExp(`/admin/works/${id}/edit$`))
  await expect(page.getByLabel('作品名称')).toBeVisible()
}

test('空草稿只 POST 一次，进入编辑路由后对同一 id PATCH', async ({ page }) => {
  const mutations = adminWorkMutations(page)
  await openNew(page)

  await page.getByRole('button', { name: '保存草稿' }).click()
  await expect(page).toHaveURL(/\/admin\/works\/work_mock_\d+\/edit$/)
  await expect(page.getByRole('heading', { name: '编辑作品' })).toBeVisible()
  const createdId = new URL(page.url()).pathname.split('/')[3]

  expect(mutations.filter((item) => item.method === 'POST')).toHaveLength(1)
  expect(mutations.filter((item) => item.method === 'PATCH')).toHaveLength(0)

  await page.getByLabel('作品名称').fill('浏览器新建草稿')
  await page.getByRole('button', { name: '保存草稿' }).click()
  await expect(page.getByText('已保存当前修改。')).toBeVisible()

  const posts = mutations.filter((item) => item.method === 'POST')
  const patches = mutations.filter((item) => item.method === 'PATCH')
  expect(posts).toHaveLength(1)
  expect(patches).toHaveLength(1)
  expect(patches[0].url.endsWith(`/api/admin/works/${createdId}`)).toBe(true)
})

test('已发布保存校验失败时聚焦首个字段，不提前发布或下架', async ({ page }) => {
  const boundaryRequests: string[] = []
  page.on('request', (request) => {
    if (/\/api\/admin\/works\/[^/]+\/(?:publish|unpublish)$/.test(request.url())) {
      boundaryRequests.push(request.url())
    }
  })
  await openEdit(page, 'work_demo_001')

  const description = page.getByLabel('建筑介绍（纯文字）')
  await expect(description).toHaveValue('传统院落建筑模型，用于展示空间布局与建筑形态。')
  await expect(page.getByRole('button', { name: '保存并更新公开内容' })).toBeVisible()
  await description.fill('')
  await page.getByRole('button', { name: '保存并更新公开内容' }).click()

  await expect(page.getByText('已发布作品必须保留名称、建筑介绍、封面与模型资源。')).toBeVisible()
  await expect(description).toBeFocused()
  await expect(description).toHaveValue('')
  await expect(page.getByText('已发布', { exact: true })).toBeVisible()
  expect(boundaryRequests).toEqual([])
})

test('离开与退出前确认，拒绝退出时零 logout 请求并保留字段', async ({ page }) => {
  await openEdit(page, 'work_demo_001')
  // 建立站内历史，避免把返回目标设为首次打开前的空白文档。
  await page.getByRole('link', { name: '返回作品管理', exact: true }).click()
  await page.getByRole('link', { name: '编辑 院落模型', exact: true }).click()
  const name = page.getByLabel('作品名称')
  await name.fill('浏览器未保存名称')

  let dialogAction: 'dismiss' | 'accept' = 'dismiss'
  const dialogMessages: string[] = []
  page.on('dialog', async (dialog) => {
    dialogMessages.push(dialog.message())
    if (dialogAction === 'accept') await dialog.accept()
    else await dialog.dismiss()
  })

  const logoutRequests: string[] = []
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/api/auth/logout')) {
      logoutRequests.push(request.url())
    }
  })

  await page.getByRole('link', { name: '返回作品管理' }).click()
  await expect.poll(() => dialogMessages.length).toBe(1)
  await expect(page).toHaveURL(/\/admin\/works\/work_demo_001\/edit$/)
  await expect(name).toHaveValue('浏览器未保存名称')

  // 取消导航时不会触发 load，触发真实 history.back 后单独断言拦截结果。
  await page.evaluate(() => window.history.back())
  await expect.poll(() => dialogMessages.length).toBe(2)
  await expect(page).toHaveURL(/\/admin\/works\/work_demo_001\/edit$/)
  await expect(name).toHaveValue('浏览器未保存名称')

  await page.getByRole('button', { name: '退出登录' }).click()
  await expect.poll(() => dialogMessages.length).toBe(3)
  await page.waitForTimeout(100)
  expect(logoutRequests).toHaveLength(0)
  await expect(name).toHaveValue('浏览器未保存名称')
  await expect(page.getByRole('heading', { name: '编辑作品' })).toBeVisible()

  dialogAction = 'accept'
  await page.getByRole('button', { name: '退出登录' }).click()
  await expect(page.getByRole('heading', { name: '管理员登录' })).toBeVisible()
  expect(logoutRequests).toHaveLength(1)
})

test('浏览器刷新触发 beforeunload，取消后保留未保存内容', async ({ page }) => {
  await openEdit(page, 'work_demo_001')
  const name = page.getByLabel('作品名称')
  await name.fill('刷新前的未保存名称')

  let beforeUnloadSeen = false
  page.on('dialog', async (dialog) => {
    if (dialog.type() === 'beforeunload') beforeUnloadSeen = true
    await dialog.dismiss()
  })

  await page.evaluate(() => {
    window.location.reload()
  })
  await expect.poll(() => beforeUnloadSeen).toBe(true)
  await expect(page).toHaveURL(/\/admin\/works\/work_demo_001\/edit$/)
  await expect(name).toHaveValue('刷新前的未保存名称')
})

for (const width of [320, 390, 768, 1440]) {
  test(`编辑表单 ${width}px：任务顺序、操作可达且短视口不遮焦点`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await openNew(page)

    const nameBox = await page.getByLabel('作品名称').boundingBox()
    const modelBox = await page.getByRole('heading', { name: '模型资源' }).boundingBox()
    const descriptionBox = await page.getByLabel('建筑介绍（纯文字）').boundingBox()
    expect(nameBox).not.toBeNull()
    expect(modelBox).not.toBeNull()
    expect(descriptionBox).not.toBeNull()

    if (width >= 1024) {
      expect(modelBox!.x).toBeGreaterThan(nameBox!.x)
      expect(modelBox!.y).toBeLessThan(descriptionBox!.y)
    } else {
      expect(modelBox!.y).toBeGreaterThan(nameBox!.y)
      expect(modelBox!.y).toBeLessThan(descriptionBox!.y)
    }

    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)

    await page.setViewportSize({ width, height: 400 })
    const description = page.getByLabel('建筑介绍（纯文字）')
    await description.focus()
    await description.scrollIntoViewIfNeeded()
    await expect(description).toBeInViewport()

    const save = page.getByRole('button', { name: '保存草稿' })
    await save.scrollIntoViewIfNeeded()
    await expect(save).toBeInViewport()
    expect(await save.boundingBox()).not.toBeNull()
  })
}

test('320px、200% 字号模拟与短视口下不横向溢出，焦点和保存操作可达', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 480 })
  await openNew(page)
  const name = page.getByLabel('作品名称')
  const baseFontSize = await name.evaluate((element) =>
    Number.parseFloat(getComputedStyle(element).fontSize),
  )

  // 通过设计变量把正文/控件字号实际放大到 2 倍；这是布局走查，
  // 不声称完成真实手机或系统级字体缩放验收。
  await page.addStyleTag({
    content: `:root {
      --text-title: 68px; --leading-title: 84px;
      --text-heading: 40px; --leading-heading: 56px;
      --text-body: 32px; --leading-body: 56px;
      --text-label: 28px; --leading-label: 40px;
      --text-caption: 28px; --leading-caption: 44px;
      --text-meta: 24px; --leading-meta: 36px;
    }`,
  })

  const description = page.getByLabel('建筑介绍（纯文字）')
  expect(
    await name.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize)),
  ).toBeGreaterThanOrEqual(baseFontSize * 2 - 1)
  expect(
    await description.evaluate((element) =>
      Number.parseFloat(getComputedStyle(element).fontSize),
    ),
  ).toBeGreaterThanOrEqual(baseFontSize * 2 - 1)

  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true)

  await description.focus()
  await description.scrollIntoViewIfNeeded()
  await expect(description).toBeInViewport()

  const save = page.getByRole('button', { name: '保存草稿' })
  await save.scrollIntoViewIfNeeded()
  await expect(save).toBeInViewport()
})
