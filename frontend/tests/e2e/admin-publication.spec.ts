/// <reference types="node" />
import { expect, test, type Page } from '@playwright/test'

async function signIn(page: Page) {
  await page.getByLabel('账号', { exact: false }).fill('admin')
  await page.getByLabel('密码', { exact: false }).fill('admin')
  const button = page.getByRole('button', { name: '登录', exact: true })
  await expect(button).toBeEnabled()
  await page.getByLabel('密码', { exact: false }).press('Enter')
}

async function openAdmin(page: Page) {
  await page.goto('/admin/works')
  await expect(page.getByRole('heading', { name: '管理员登录' })).toBeVisible()
  await signIn(page)
  await expect(page.getByRole('heading', { name: '作品管理' })).toBeVisible()
}

async function createDraftWithAssets(page: Page, name: string) {
  return page.evaluate(async (draftName) => {
    const response = await fetch('/api/admin/works', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: draftName,
        description: 'P13 浏览器发布生命周期。',
        modelAssetId: 'asset_demo_001_model',
        coverAssetId: 'asset_demo_001_cover',
      }),
    })
    if (!response.ok) throw new Error(`创建草稿失败：${response.status}`)
    return ((await response.json()) as { id: string }).id
  }, name)
}

async function openCreatedDraft(page: Page, id: string) {
  // Mock 会话和数据库都在内存中，通过站内导航保留夹具。
  await page.getByRole('link', { name: '新建作品', exact: true }).click()
  await page.getByRole('link', { name: '返回作品管理', exact: true }).click()
  await page.locator(`a[href="/admin/works/${id}/edit"]`).click()
}

async function openPublicWorks(page: Page) {
  await page
    .getByRole('navigation', { name: '管理后台导航' })
    .getByRole('link', { name: '返回公开展示' })
    .click()
  await page
    .getByRole('navigation', { name: '公开展示区导航' })
    .getByRole('link', { name: '全部作品' })
    .click()
  await expect(page).toHaveURL(/\/works$/)
}

async function backToAdmin(page: Page) {
  await page
    .getByRole('navigation', { name: '公开展示区导航' })
    .getByRole('link', { name: '后台管理' })
    .click()
  await expect(page.getByRole('heading', { name: '作品管理' })).toBeVisible()
  await expect(page.getByRole('table', { name: '管理作品列表' })).toBeVisible()
}

async function selectModel(page: Page) {
  return page.locator('input[aria-label="选择模型文件"]').setInputFiles({
    name: 'p13-model.glb',
    mimeType: 'model/gltf-binary',
    buffer: Buffer.from('metadata only'),
  })
}

test('发布无城市作品→公开可见→下架→公开移除，published 资源替换 API 被拒', async ({ page }) => {
  await openAdmin(page)
  const id = await createDraftWithAssets(page, 'P13 发布回归作品')
  await openCreatedDraft(page, id)
  await expect(page.getByLabel('作品名称')).toHaveValue('P13 发布回归作品')

  await page.getByRole('button', { name: '发布作品' }).click()
  await expect(page.getByText('已发布作品，公开目录和城市列表已更新。')).toBeVisible()
  await expect(page.getByRole('button', { name: '下架作品' })).toBeVisible()

  const replacementStatus = await page.evaluate(async (workId) => {
    const response = await fetch(`/api/admin/works/${workId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ modelAssetId: 'asset_demo_002_model' }),
    })
    return response.status
  }, id)
  expect(replacementStatus).toBe(409)

  await openPublicWorks(page)
  await expect(page.getByText('P13 发布回归作品', { exact: true })).toBeVisible()

  await backToAdmin(page)
  const row = page.getByRole('row', { name: /P13 发布回归作品/ })
  page.once('dialog', (dialog) => dialog.accept())
  await row.getByRole('button', { name: '下架 P13 发布回归作品' }).click()
  await expect(page.getByText('已下架《P13 发布回归作品》。')).toBeVisible()

  await openPublicWorks(page)
  await expect(page.getByText('P13 发布回归作品', { exact: true })).toHaveCount(0)
})

test('城市最后一件已发布作品下架后点位消失且不留下失效点', async ({ page }) => {
  await openAdmin(page)
  const row = page.getByRole('row', { name: /模型占位 09/ })
  page.once('dialog', (dialog) => dialog.accept())
  await row.getByRole('button', { name: '下架 模型占位 09' }).click()
  await expect(page.getByText('已下架《模型占位 09》。')).toBeVisible()

  await page
    .getByRole('navigation', { name: '管理后台导航' })
    .getByRole('link', { name: '返回公开展示' })
    .click()
  const stage = page.locator('[data-globe-stage]')
  await expect(stage).toBeVisible({ timeout: 20_000 })
  await expect(stage).toHaveAttribute('data-opening', 'false', { timeout: 5_000 })
  await expect(page.locator('[data-city-point]')).toHaveCount(3)
  await expect(page.locator('[data-city-point][data-city-id="440300"]')).toHaveCount(0)
})

test('下架作品 409 资源占用保持 offline/旧绑定/字段，重试后仍需手动发布', async ({ page }) => {
  await openAdmin(page)
  const id = await createDraftWithAssets(page, 'P13 409 回归草稿')
  const downStatus = await page.evaluate(async (workId) => {
    const response = await fetch(`/api/admin/works/${workId}/unpublish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
    return response.status
  }, id)
  expect(downStatus).toBe(200)

  await page.getByRole('link', { name: '新建作品', exact: true }).click()
  await page.getByRole('link', { name: '返回作品管理', exact: true }).click()
  await page.locator(`a[href="/admin/works/${id}/edit"]`).click()
  await expect(page.getByRole('heading', { name: '编辑作品' })).toBeVisible()
  await expect(page.getByLabel('作品名称')).toHaveValue('P13 409 回归草稿')
  await expect(page.getByText('已下架', { exact: true })).toHaveCount(1)
  await page.evaluate(() => window.__mockControls?.setScenario('model-in-use'))

  const name = page.getByLabel('作品名称')
  await name.fill('P13 409 保留字段')
  await selectModel(page)
  await expect(page.getByText('模拟验证通过（ready）')).toBeVisible({ timeout: 5000 })
  await page.getByRole('button', { name: '保存修改' }).click()
  await expect(page.getByText(/该模型资源正在预览会话中/)).toBeVisible()
  await expect(name).toHaveValue('P13 409 保留字段')
  await expect(page.getByText('已下架', { exact: true })).toHaveCount(1)

  const failed = await page.evaluate(async (workId) => {
    const response = await fetch(`/api/admin/works/${workId}`)
    return response.json() as Promise<{
      status: string
      modelAssetId: string | null
      name: string
    }>
  }, id)
  expect(failed.status).toBe('offline')
  expect(failed.modelAssetId).toBe('asset_demo_001_model')
  expect(failed.name).toBe('P13 409 回归草稿')

  await page.evaluate(() => window.__mockControls?.setScenario('normal'))
  await page.getByRole('button', { name: '保存修改' }).click()
  await expect(page.getByText('已保存当前修改。')).toBeVisible()
  const retried = await page.evaluate(async (workId) => {
    const response = await fetch(`/api/admin/works/${workId}`)
    return response.json() as Promise<{ status: string; modelAssetId: string | null }>
  }, id)
  expect(retried.status).toBe('offline')
  expect(retried.modelAssetId).toMatch(/^asset_mock_upload_model_/)

  await page.getByRole('button', { name: '发布作品' }).click()
  await expect(page.getByText('已发布作品，公开目录和城市列表已更新。')).toBeVisible()
  await expect(page.getByText('已发布', { exact: true })).toBeVisible()
})

test('已开始观看保留，但下架后新的开始申请按公开状态被拒', async ({ page }) => {
  await page.goto('/works/work_demo_001')
  await expect(page.getByRole('heading', { name: '院落模型' })).toBeVisible()
  await page.getByRole('button', { name: '开始预览' }).click()
  await expect(page.getByText('模拟观看画面')).toBeVisible({ timeout: 5000 })

  // 同页直接调用既有管理边界，保留当前 MSW 数据与已开始的观看实例。
  await page.evaluate(async () => {
    const login = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin' }),
    })
    if (!login.ok) throw new Error(`登录失败：${login.status}`)
    const response = await fetch('/api/admin/works/work_demo_001/unpublish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
    if (!response.ok) throw new Error(`下架失败：${response.status}`)
  })

  // 已开始的观看实例不因下架或缓存失效被强行结束。
  await expect(page.getByText('模拟观看画面')).toBeVisible()
  await page.getByRole('button', { name: '结束预览' }).click()
  await page.getByRole('button', { name: '开始预览' }).click()
  await expect(page.getByText('作品当前不可预览')).toBeVisible({ timeout: 5000 })
  await expect(page.getByText(/该作品已不再公开/)).toBeVisible()
  await expect(page.getByText('模拟观看画面')).toHaveCount(0)
})

test('服务端发布边界：缺必填422、无效城市、错误kind与重复发布幂等', async ({ page }) => {
  await openAdmin(page)

  const missing = await page.evaluate(async () => {
    const response = await fetch('/api/admin/works/work_draft_002/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
    const body = await response.json()
    return { status: response.status, fields: body.error?.fields ?? {} }
  })
  expect(missing.status).toBe(422)
  expect(typeof missing.fields.modelAssetId).toBe('string')
  expect(typeof missing.fields.coverAssetId).toBe('string')

  const invalidCity = await page.evaluate(async () => {
    const response = await fetch('/api/admin/works/work_draft_001', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cityId: 'not-a-city' }),
    })
    const body = await response.json()
    return { status: response.status, fields: body.error?.fields ?? {} }
  })
  expect(invalidCity.status).toBe(422)
  expect(typeof invalidCity.fields.cityId).toBe('string')

  const wrongKind = await page.evaluate(async () => {
    const response = await fetch('/api/admin/works/work_draft_001', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ modelAssetId: 'asset_demo_001_cover' }),
    })
    const body = await response.json()
    return { status: response.status, fields: body.error?.fields ?? {} }
  })
  expect(wrongKind.status).toBe(422)
  expect(typeof wrongKind.fields.modelAssetId).toBe('string')

  const id = await createDraftWithAssets(page, '幂等 E2E 作品')
  const first = await page.evaluate(async (workId) => {
    const response = await fetch(`/api/admin/works/${workId}/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
    return response.json() as Promise<{ updatedAt: string; publishedAt: string }>
  }, id)
  const second = await page.evaluate(async (workId) => {
    const response = await fetch(`/api/admin/works/${workId}/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
    return response.json() as Promise<{ updatedAt: string; publishedAt: string }>
  }, id)
  expect(second.updatedAt).toBe(first.updatedAt)
  expect(second.publishedAt).toBe(first.publishedAt)
})

test('已发布作品修改资料与城市后，公开目录和详情使用新值', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openAdmin(page)
  await page.getByRole('link', { name: '编辑 院落模型', exact: true }).click()
  await expect(page.getByRole('heading', { name: '编辑作品' })).toBeVisible()

  const updatedName = 'P13 公开更新院落'
  await page.getByLabel('作品名称').fill(updatedName)
  await page.getByLabel('建筑介绍（纯文字）').fill('更新后的公开介绍。')
  await page.getByLabel('省份（选填）').selectOption('330000')
  await expect(page.getByLabel('城市（选填）')).toBeEnabled()
  await page.getByLabel('城市（选填）').selectOption('330100')
  await page.getByRole('button', { name: '保存并更新公开内容' }).click()
  await expect(page.getByText('已保存并更新公开内容。')).toBeVisible()

  await page
    .getByRole('navigation', { name: '管理后台导航' })
    .getByRole('link', { name: '返回公开展示' })
    .click()
  await page
    .getByRole('navigation', { name: '公开展示区导航' })
    .getByRole('link', { name: '全部作品' })
    .click()
  await expect(page).toHaveURL(/\/works$/)
  const card = page.getByRole('link', { name: new RegExp(updatedName) })
  await expect(card).toBeVisible()
  await expect(card).toContainText('杭州市')
  await card.click()
  await expect(page).toHaveURL(/\/works\/work_demo_001$/)
  await expect(page.getByRole('heading', { level: 1, name: updatedName })).toBeVisible()
  await expect(page.getByText('杭州市', { exact: true })).toBeVisible()
  await expect(page.getByText('更新后的公开介绍。')).toBeVisible()
})

test('未保存文本时发布禁用，保存后才恢复发布入口', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openAdmin(page)
  const id = await createDraftWithAssets(page, 'P13 dirty 回归草稿')
  await openCreatedDraft(page, id)
  await expect(page.getByLabel('作品名称')).toHaveValue('P13 dirty 回归草稿')

  await page.getByLabel('作品名称').fill('P13 dirty 回归草稿（未保存）')
  await expect(page.getByRole('button', { name: '发布作品' })).toBeDisabled()
  await expect(page.getByText(/发布前请先保存当前修改/)).toBeVisible()
  await expect(page.getByText('草稿', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: '保存草稿' }).click()
  await expect(page.getByText('已保存当前修改。')).toBeVisible()
  await expect(page.getByRole('button', { name: '发布作品' })).toBeEnabled()
  await expect(page.getByText('草稿', { exact: true })).toBeVisible()
})

test('慢下架在退出后完成仍刷新公开目录与地球缓存', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  const stage = page.locator('[data-globe-stage]')
  await expect(stage).toBeVisible({ timeout: 20_000 })
  await expect(stage).toHaveAttribute('data-opening', 'false', { timeout: 5_000 })
  await expect(page.locator('[data-city-point]')).toHaveCount(4)

  await page
    .getByRole('navigation', { name: '公开展示区导航' })
    .getByRole('link', { name: '全部作品' })
    .click()
  await expect(page.getByRole('heading', { name: '全部作品' })).toBeVisible()
  await expect(page.getByText('模型占位 09', { exact: true })).toBeVisible()
  await expect(page.getByText('模型占位 09', { exact: true })).toHaveCount(1)

  await page
    .getByRole('navigation', { name: '公开展示区导航' })
    .getByRole('link', { name: '后台管理' })
    .click()
  await expect(page.getByRole('heading', { name: '管理员登录' })).toBeVisible()
  await signIn(page)
  await expect(page.getByRole('table', { name: '管理作品列表' })).toBeVisible()

  // 服务端先提交，再延迟 Response；随后立即退出，形成“已提交但回包晚于登出”。
  await page.evaluate(() => {
    const originalFetch = window.fetch.bind(window)
    window.fetch = async (input, init) => {
      const response = await originalFetch(input, init)
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.includes('/api/admin/works/work_placeholder_009/unpublish')) {
        await new Promise((resolve) => setTimeout(resolve, 1200))
      }
      return response
    }
  })

  const row = page.getByRole('row', { name: /模型占位 09/ })
  page.once('dialog', (dialog) => dialog.accept())
  await row.getByRole('button', { name: '下架 模型占位 09' }).click()
  await page.waitForTimeout(150)
  await page.getByRole('button', { name: '退出登录' }).click()
  await expect(page.getByRole('heading', { name: '管理员登录' })).toBeVisible()
  await page.waitForTimeout(1400)

  await page
    .getByRole('navigation', { name: '公开展示区导航' })
    .getByRole('link', { name: '全部作品' })
    .click()
  await expect(page.getByText('模型占位 09', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: '全部作品' })).toBeVisible()

  await page
    .getByRole('navigation', { name: '公开展示区导航' })
    .getByRole('link', { name: '地图探索' })
    .click()
  await expect(stage).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('[data-city-point]')).toHaveCount(3)
  await expect(page.locator('[data-city-point][data-city-id="440300"]')).toHaveCount(0)
})
