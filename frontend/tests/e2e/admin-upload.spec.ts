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

async function createDraftWithAssets(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const response = await fetch('/api/admin/works', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'E2E 资源草稿',
        description: '用于 P12 上传模拟回归。',
        modelAssetId: 'asset_demo_001_model',
        coverAssetId: 'asset_demo_001_cover',
      }),
    })
    if (!response.ok) throw new Error(`创建草稿失败：${response.status}`)
    const work = (await response.json()) as { id: string }
    return work.id
  })
}

async function openCreatedDraft(page: Page, id: string) {
  // Mock 会话和数据库都在内存中，通过站内导航保留刚创建的夹具。
  await page.getByRole('link', { name: '新建作品', exact: true }).click()
  await page.getByRole('link', { name: '返回作品管理', exact: true }).click()
  await page.locator(`a[href="/admin/works/${id}/edit"]`).click()
}

function selectModel(page: Page) {
  return page.locator('input[aria-label="选择模型文件"]').setInputFiles({
    name: 'mock-model.glb',
    mimeType: 'model/gltf-binary',
    buffer: Buffer.from('development metadata only'),
  })
}

function selectCover(page: Page) {
  // 1x1 有效 PNG：只用于验证浏览器本地 object URL 预览。
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  )
  return page.locator('input[aria-label="选择封面文件"]').setInputFiles({
    name: 'mock-cover.png',
    mimeType: 'image/png',
    buffer: png,
  })
}

test('模型成功封面失败可独立恢复，失败不破坏已保存绑定', async ({ page }) => {
  const modelRequests: string[] = []
  page.on('request', (request) => {
    if (/\.(glb|ply)(\?|$)|preview-sessions/.test(request.url())) modelRequests.push(request.url())
  })
  await openAdmin(page)
  const id = await createDraftWithAssets(page)
  await openCreatedDraft(page, id)
  await expect(page.getByLabel('作品名称')).toHaveValue('E2E 资源草稿')
  await page.evaluate(() => window.__mockControls?.setScenario('upload-cover-failure'))

  await selectModel(page)
  await selectCover(page)

  const modelField = page.locator('#work-model-asset')
  const coverField = page.locator('#work-cover-asset')
  await expect(modelField.getByText('模拟验证通过（ready）')).toBeVisible()
  await expect(coverField.getByText(/模拟服务端验证失败/)).toBeVisible()
  await expect(page.getByAltText('已保存封面')).toBeVisible()
  const localPreview = page.getByAltText('新选择的本地封面预览，尚未保存')
  await expect(localPreview).toBeVisible()
  await expect
    .poll(() => localPreview.evaluate((element) => (element as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0)
  await expect(page.getByText('现有模型资源（GLB）')).toBeVisible()
  expect(modelRequests).toEqual([])

  await page.evaluate(() => window.__mockControls?.setScenario('normal'))
  await coverField.getByRole('button', { name: '重试封面' }).click()
  await expect(coverField.getByText('模拟验证通过（ready）')).toBeVisible()
  await page.getByRole('button', { name: '保存草稿' }).click()
  await expect(page.getByText('已保存当前修改。')).toBeVisible()

  const saved = await page.evaluate(async (workId) => {
    const response = await fetch(`/api/admin/works/${workId}`)
    return response.json() as Promise<Record<string, unknown>>
  }, id)
  expect(saved.modelAssetId).toMatch(/^asset_mock_upload_model_/)
  expect(saved.coverAssetId).toMatch(/^asset_mock_upload_cover_/)
  expect(saved.modelFormat).toBe('glb')
})

test('验证中不能保存，取消新选择恢复旧绑定与保存按钮', async ({ page }) => {
  await openAdmin(page)
  const id = await createDraftWithAssets(page)
  await openCreatedDraft(page, id)
  await expect(page.getByLabel('作品名称')).toHaveValue('E2E 资源草稿')
  await page.evaluate(() => window.__mockControls?.setScenario('upload-validating'))

  await selectModel(page)
  await expect(page.getByText('模拟服务端验证中')).toBeVisible()
  await expect(page.getByRole('button', { name: '保存草稿' })).toBeDisabled()
  await expect(page.getByText(/模型或封面仍在模拟传输或验证中/)).toBeVisible()

  await page.getByRole('button', { name: '取消新模型' }).click()
  await expect(page.getByText('现有模型资源（GLB）')).toBeVisible()
  await expect(page.getByText('已取消新选择；已保存绑定未改变。')).toBeVisible()
  await expect(page.getByRole('button', { name: '保存草稿' })).toBeEnabled()
})

test('选中未保存文件时离开需确认，取消后恢复 clean', async ({ page }) => {
  await openAdmin(page)
  const id = await createDraftWithAssets(page)
  await openCreatedDraft(page, id)
  await expect(page.getByLabel('作品名称')).toHaveValue('E2E 资源草稿')
  await page.evaluate(() => window.__mockControls?.setScenario('upload-validating'))

  await selectCover(page)
  await expect(page.getByText('模拟服务端验证中')).toBeVisible()
  await expect(page.getByText('有未保存的修改')).toBeVisible()

  let dialogs = 0
  page.on('dialog', async (dialog) => {
    dialogs += 1
    await dialog.dismiss()
  })
  await page.getByRole('link', { name: '返回作品管理' }).click()
  await expect.poll(() => dialogs).toBe(1)
  await expect(page).toHaveURL(new RegExp(`/admin/works/${id}/edit$`))
  await expect(page.getByText('mock-cover.png')).toBeVisible()

  await page.getByRole('button', { name: '取消新封面' }).click()
  await expect(page.getByText('有未保存的修改')).toHaveCount(0)
  await expect(page.getByAltText('已保存封面')).toBeVisible()
})

test('新建首次 POST 绑定 ready 资源，进入编辑后 PATCH 同一 id 不丢绑定', async ({ page }) => {
  const mutations: Array<{ method: string; url: string }> = []
  page.on('request', (request) => {
    if (/\/api\/admin\/works(?:\/[^/]+)?$/.test(request.url()) && ['POST', 'PATCH'].includes(request.method())) {
      mutations.push({ method: request.method(), url: request.url() })
    }
  })

  await page.goto('/admin/works/new')
  await expect(page.getByRole('heading', { name: '管理员登录' })).toBeVisible()
  await signIn(page)
  await expect(page.getByRole('heading', { name: '新建作品' })).toBeVisible()

  await selectModel(page)
  await selectCover(page)
  const modelField = page.locator('#work-model-asset')
  const coverField = page.locator('#work-cover-asset')
  await expect(modelField.getByText('模拟验证通过（ready）')).toBeVisible()
  await expect(coverField.getByText('模拟验证通过（ready）')).toBeVisible()

  await page.getByRole('button', { name: '保存草稿' }).click()
  await expect(page).toHaveURL(/\/admin\/works\/work_mock_\d+\/edit$/)
  const createdId = new URL(page.url()).pathname.split('/')[3]
  await expect(page.getByLabel('作品名称')).toBeVisible()
  await expect(page.getByText('现有模型资源（GLB）')).toBeVisible()
  await expect(page.getByAltText('已保存封面')).toBeVisible()

  expect(mutations.filter((item) => item.method === 'POST')).toHaveLength(1)

  await page.getByLabel('作品名称').fill('浏览器新建资源草稿')
  await page.getByRole('button', { name: '保存草稿' }).click()
  await expect(page.getByText('已保存当前修改。')).toBeVisible()
  const patches = mutations.filter((item) => item.method === 'PATCH')
  expect(patches).toHaveLength(1)
  expect(patches[0].url.endsWith(`/api/admin/works/${createdId}`)).toBe(true)
  expect(mutations.filter((item) => item.method === 'POST')).toHaveLength(1)
})

test('普通成功路径在浏览器中依次出现 receiving、validating、ready', async ({ page }) => {
  await openAdmin(page)
  const id = await createDraftWithAssets(page)
  await openCreatedDraft(page, id)
  await expect(page.getByLabel('作品名称')).toHaveValue('E2E 资源草稿')

  await page.evaluate(() => {
    const target = document.querySelector('#work-model-asset')
    const labels = [
      '模拟传输中（仅开发演示）',
      '模拟服务端验证中',
      '模拟验证通过（ready）',
    ]
    const seen: string[] = []
    const state = window as unknown as {
      __uploadStates: string[]
      __uploadObserver: MutationObserver
    }
    state.__uploadStates = seen
    const observer = new MutationObserver(() => {
      const text = target?.textContent ?? ''
      for (const label of labels) {
        if (text.includes(label) && seen.at(-1) !== label) seen.push(label)
      }
    })
    observer.observe(target!, { subtree: true, childList: true, characterData: true })
    state.__uploadObserver = observer
  })

  await selectModel(page)
  await expect(page.locator('#work-model-asset').getByText('模拟验证通过（ready）')).toBeVisible()
  const states = await page.evaluate(
    () => (window as unknown as { __uploadStates: string[] }).__uploadStates,
  )
  const receiving = states.indexOf('模拟传输中（仅开发演示）')
  const validating = states.indexOf('模拟服务端验证中')
  const ready = states.indexOf('模拟验证通过（ready）')
  expect(receiving).toBeGreaterThanOrEqual(0)
  expect(validating).toBeGreaterThan(receiving)
  expect(ready).toBeGreaterThan(validating)
})

test('已发布作品不开放资源替换，仍可保存资料', async ({ page }) => {
  await openAdmin(page)
  await page.getByRole('link', { name: '编辑 院落模型', exact: true }).click()
  await expect(page.getByLabel('作品名称')).toHaveValue('院落模型')
  await expect(page.getByText('已发布或已下架作品的资源替换尚未开放；本页只更新资料。')).toHaveCount(2)
  await expect(page.locator('input[aria-label="选择模型文件"]')).toHaveCount(0)
  await expect(page.locator('input[aria-label="选择封面文件"]')).toHaveCount(0)

  await page.getByLabel('作品名称').fill('E2E 只改资料')
  await page.getByRole('button', { name: '保存并更新公开内容' }).click()
  await expect(page.getByText('已保存并更新公开内容。')).toBeVisible()
})

for (const width of [320, 390]) {
  test(`手机 ${width}px 上传字段与操作可达，不横向溢出`, async ({ page }) => {
    await page.setViewportSize({ width, height: 760 })
    await page.goto('/admin/works/new')
    await expect(page.getByRole('heading', { name: '管理员登录' })).toBeVisible()
    await signIn(page)
    await expect(page.getByRole('heading', { name: '新建作品' })).toBeVisible()

    const modelInput = page.locator('input[aria-label="选择模型文件"]')
    const coverInput = page.locator('input[aria-label="选择封面文件"]')
    await expect(modelInput).toHaveCount(1)
    await expect(coverInput).toHaveCount(1)
    await expect(page.getByRole('button', { name: '选择模型', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '选择封面', exact: true })).toBeVisible()

    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)

    await page.evaluate(() => window.__mockControls?.setScenario('upload-validating'))
    await selectModel(page)
    await expect(page.getByText('模拟服务端验证中')).toBeVisible()
    await expect(page.getByText('mock-model.glb')).toBeVisible()
    const save = page.getByRole('button', { name: '保存草稿' })
    await save.scrollIntoViewIfNeeded()
    await expect(save).toBeDisabled()
    await expect(save).toBeInViewport()
  })
}
