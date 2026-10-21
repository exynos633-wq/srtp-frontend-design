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
  await expect(page.getByRole('heading', { name: '管理员登录' })).toBeVisible({ timeout: 15_000 })
  await signIn(page)
  await expect(page.getByRole('heading', { name: '作品管理' })).toBeVisible()
}

async function selectModel(page: Page) {
  await page.locator('input[aria-label="选择模型文件"]').setInputFiles({
    name: 'p14-demo-model.glb',
    mimeType: 'model/gltf-binary',
    buffer: Buffer.from('P14 metadata only, no model content'),
  })
  await expect(page.locator('#work-model-asset').getByText('模拟验证通过（ready）')).toBeVisible({
    timeout: 5000,
  })
}

async function selectCover(page: Page) {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  )
  await page.locator('input[aria-label="选择封面文件"]').setInputFiles({
    name: 'p14-demo-cover.png',
    mimeType: 'image/png',
    buffer: png,
  })
  await expect(page.locator('#work-cover-asset').getByText('模拟验证通过（ready）')).toBeVisible({
    timeout: 5000,
  })
}

async function goPublicWorks(page: Page) {
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

async function goHome(page: Page) {
  await page
    .getByRole('navigation', { name: '公开展示区导航' })
    .getByRole('link', { name: '地图探索' })
    .click()
  await expect(page.locator('[data-globe-stage]')).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('[data-globe-stage]')).toHaveAttribute('data-opening', 'false', {
    timeout: 5000,
  })
}

async function goAdmin(page: Page) {
  await page
    .getByRole('navigation', { name: '公开展示区导航' })
    .getByRole('link', { name: '后台管理' })
    .click()
  await expect(page.getByRole('heading', { name: '作品管理' })).toBeVisible()
}

test('P14 完整演示：新建→模拟资源→发布→城市/目录→清空城市→下架→拒绝', async ({ page }) => {
  test.setTimeout(90_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  await openAdmin(page)

  // 先清空杭州唯一演示作品，便于验证“新作品是该城最后一件”时点位移除。
  const hangzhouRow = page.getByRole('row', { name: /模型占位 06/ })
  page.once('dialog', (dialog) => dialog.accept())
  await hangzhouRow.getByRole('button', { name: '下架 模型占位 06' }).click()
  await expect(page.getByText('已下架《模型占位 06》。')).toBeVisible()

  await page.getByRole('link', { name: '新建作品', exact: true }).click()
  await expect(page.getByRole('heading', { name: '新建作品' })).toBeVisible()
  await expect(page.getByRole('button', { name: '发布作品' })).toBeDisabled()
  await expect(page.getByText('开发 Mock · 非真实接口')).toBeVisible()
  await expect(page.getByText(/仅开发环境的上传模拟/)).toBeVisible()

  const name = 'P14 演示冻结作品'
  const description = 'P14 完整演示：模拟上传、城市切换与发布下架。'
  await page.getByLabel('作品名称').fill(name)
  await page.getByLabel('建筑介绍（纯文字）').fill(description)
  await selectModel(page)
  await selectCover(page)
  await page.getByLabel('省份（选填）').selectOption('330000')
  await expect(page.getByLabel('城市（选填）')).toBeEnabled()
  await page.getByLabel('城市（选填）').selectOption('330100')
  await page.getByRole('button', { name: '保存草稿' }).click()
  // 首次保存会从 /new 进入同 id 编辑路由，成功提示可能随路由切换清理。
  await expect(page).toHaveURL(/\/admin\/works\/[^/]+\/edit$/)
  const id = page.url().match(/\/admin\/works\/([^/]+)\/edit$/)?.[1]
  expect(id).toBeTruthy()
  await expect(page.getByText('草稿', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '发布作品' })).toBeEnabled()

  await page.getByRole('button', { name: '发布作品' }).click()
  await expect(page.getByText('已发布作品，公开目录和城市列表已更新。')).toBeVisible()
  await expect(page.getByText('已发布', { exact: true })).toBeVisible()

  await goPublicWorks(page)
  await expect(page.getByText(name, { exact: true })).toBeVisible()
  await goHome(page)
  await expect(page.locator('[data-city-point]')).toHaveCount(4)
  await page.locator('[data-city-point][data-city-id="330100"]').click()
  await expect(page.locator('[data-city-bubble]')).toBeVisible()
  await expect(page.locator('[data-city-bubble]').getByText(name, { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '关闭杭州市作品列表' }).click()

  await goAdmin(page)
  await page.getByRole('link', { name: `编辑 ${name}`, exact: true }).click()
  await page.getByRole('button', { name: '清除城市' }).click()
  await page.getByRole('button', { name: '保存并更新公开内容' }).click()
  await expect(page.getByText('已保存并更新公开内容。')).toBeVisible()
  await goPublicWorks(page)
  const noCityCard = page.getByRole('link', { name: new RegExp(name) })
  await expect(noCityCard).toBeVisible()
  await expect(noCityCard).toContainText('未设置城市')
  await goHome(page)
  await expect(page.locator('[data-city-point]')).toHaveCount(3)
  await expect(page.locator('[data-city-point][data-city-id="330100"]')).toHaveCount(0)

  await goAdmin(page)
  await page.getByRole('link', { name: `编辑 ${name}`, exact: true }).click()
  await page.getByLabel('省份（选填）').selectOption('330000')
  await expect(page.getByLabel('城市（选填）')).toBeEnabled()
  await page.getByLabel('城市（选填）').selectOption('330100')
  await page.getByRole('button', { name: '保存并更新公开内容' }).click()
  await expect(page.getByText('已保存并更新公开内容。')).toBeVisible()
  await goPublicWorks(page)
  await goHome(page)
  await expect(page.locator('[data-city-point][data-city-id="330100"]')).toHaveCount(1)

  await goAdmin(page)
  await page.getByRole('link', { name: `编辑 ${name}`, exact: true }).click()
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: '下架作品' }).click()
  await expect(page.getByText('已下架作品，公开目录和城市列表已更新。')).toBeVisible()
  await expect(page.getByText('已下架', { exact: true })).toBeVisible()

  await goPublicWorks(page)
  await expect(page.getByText(name, { exact: true })).toHaveCount(0)
  await goHome(page)
  await expect(page.locator('[data-city-point]')).toHaveCount(3)
  await expect(page.locator('[data-city-point][data-city-id="330100"]')).toHaveCount(0)

  const publicStatus = await page.evaluate(async (workId) => {
    const response = await fetch(`/api/works/${workId}`)
    return response.status
  }, id!)
  expect(publicStatus).toBe(404)
  await page.evaluate((workId) => {
    window.history.pushState({}, '', `/works/${workId}`)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, id!)
  await expect(page.getByRole('heading', { name: '作品不存在' })).toBeVisible()
  await expect(page.getByRole('button', { name: '开始预览' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: /AI|助手|客服/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /AI|助手|客服/ })).toHaveCount(0)
  await expect(page.getByText('开发 Mock · 非真实接口')).toBeVisible()
})
