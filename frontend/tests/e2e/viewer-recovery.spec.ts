import { expect, test, type Page } from '@playwright/test'

// 自包含 GLB，生命周期回归不依赖另行交付的大模型。
function triangleGlb(): Buffer {
  const json = {
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    buffers: [{ byteLength: 36 }], bufferViews: [{ buffer: 0, byteLength: 36 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [-1, 0, 0], max: [1, 1, 0] }],
  }
  const text = Buffer.from(JSON.stringify(json))
  const padded = Buffer.alloc(Math.ceil(text.length / 4) * 4, 32)
  text.copy(padded)
  const binary = Buffer.from(new Float32Array([-1, 0, 0, 1, 0, 0, 0, 1, 0]).buffer)
  const result = Buffer.alloc(28 + padded.length + binary.length)
  result.writeUInt32LE(0x46546c67, 0)
  result.writeUInt32LE(2, 4)
  result.writeUInt32LE(result.length, 8)
  result.writeUInt32LE(padded.length, 12)
  result.writeUInt32LE(0x4e4f534a, 16)
  padded.copy(result, 20)
  result.writeUInt32LE(binary.length, 20 + padded.length)
  result.writeUInt32LE(0x004e4942, 24 + padded.length)
  binary.copy(result, 28 + padded.length)
  return result
}

async function openLocalModel(page: Page) {
  await page.goto('/dev/model-viewer')
  await page.getByLabel('选择本地模型文件').setInputFiles({
    name: 'triangle.glb', mimeType: 'model/gltf-binary', buffer: triangleGlb(),
  })
  await expect(page.locator('[data-viewer-phase="ready"]')).toBeVisible()
}

async function failFirstPreview(page: Page) {
  await page.goto('/works/work_demo_001')
  await page.evaluate(() => {
    const original = window.fetch.bind(window)
    window.fetch = (input, init) => String(input).includes('/__dev/models/')
      ? Promise.resolve(new Response('temporarily unavailable', { status: 503 }))
      : original(input, init)
  })
  await page.getByRole('button', { name: '开始预览' }).click()
  await expect(page.getByText('模型地址不可用')).toBeVisible()
  await page.evaluate(async () => {
    const response = await fetch('/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin' }),
    })
    if (!response.ok) throw new Error('Mock 登录失败')
  })
}

async function allowModelDownload(page: Page) {
  await page.evaluate((bytes) => {
    const original = window.fetch.bind(window)
    window.fetch = (input, init) => String(input).includes('/__dev/models/')
      ? Promise.resolve(new Response(new Uint8Array(bytes)))
      : original(input, init)
  }, Array.from(triangleGlb()))
}

test('下载失败后下架作品，重试重新检查公开状态并拒绝加载', async ({ page }) => {
  await failFirstPreview(page)
  await page.evaluate(async () => {
    const response = await fetch('/api/admin/works/work_demo_001/unpublish', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    })
    if (!response.ok) throw new Error('Mock 下架失败')
  })
  await allowModelDownload(page)
  await page.getByRole('button', { name: '手动重试', exact: true }).click()
  await expect(page.getByText('作品当前不可预览', { exact: true })).toBeVisible()
  await expect(page.locator('[data-viewer-phase]')).toHaveCount(0)
})

test('下载失败后重试重新解析来源，使用最新版本', async ({ page }) => {
  await failFirstPreview(page)
  await page.evaluate(async () => {
    const response = await fetch('/api/admin/works/work_demo_001', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '更新后的院落' }),
    })
    if (!response.ok) throw new Error('Mock 更新失败')
  })
  await allowModelDownload(page)
  await page.getByRole('button', { name: '手动重试', exact: true }).click()
  await expect(page.locator('[data-viewer-phase="ready"]')).toBeVisible()
  expect(await page.evaluate(() => window.__srtpModelViewer!.getDebugState().info?.sourceName)).toBe('更新后的院落')
})

test('模型已就绪时切换 DPR，指标导出保持可用', async ({ page }) => {
  await openLocalModel(page)
  const exportButton = page.getByRole('button', { name: '导出指标 JSON' })
  await expect(exportButton).toBeEnabled()
  await page.getByLabel('DPR 上限').selectOption('1')
  await expect(page.locator('[data-viewer-phase="ready"]')).toBeVisible()
  await expect(exportButton).toBeEnabled()
  const downloaded = page.waitForEvent('download')
  await exportButton.click()
  expect((await downloaded).suggestedFilename()).toMatch(/^model-viewer-metrics-.*\.json$/)
})

test('双指缩放松开一指后，剩余单指继续旋转', async ({ page, context }) => {
  await openLocalModel(page)
  await page.evaluate(() => {
    window.__srtpModelViewer!.setAutoRotate(false)
    window.__srtpModelViewer!.setTouchEnabled(true)
  })
  const box = (await page.locator('canvas').boundingBox())!
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  const cdp = await context.newCDPSession(page)
  const camera = () => page.evaluate(() => window.__srtpModelViewer!.getDebugState().camera.position)
  const beforeSingle = await camera()
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 3 }] })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + 30, y, id: 3 }] })
  await expect.poll(camera).not.toEqual(beforeSingle)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })

  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }, { x: x + 60, y, id: 2 }] })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y, id: 1 }, { x: x + 90, y, id: 2 }] })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ x: x + 90, y, id: 2 }] })
  const beforeRemaining = await camera()
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + 40, y: y + 15, id: 1 }] })
  await expect.poll(camera).not.toEqual(beforeRemaining)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
})
