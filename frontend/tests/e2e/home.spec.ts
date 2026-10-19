import { expect, test, type Page } from '@playwright/test'

test.describe.configure({ mode: 'serial' })
test.setTimeout(60_000)

const stage = (page: Page) => page.locator('[data-globe-stage]')
const cityPoints = (page: Page) => stage(page).locator('[data-city-point]')
const cityPoint = (page: Page, city: string) =>
  stage(page).locator(`[data-city-point][aria-label^="${city}"]`)

async function gotoHome(page: Page, query = '') {
  await page.goto(`/${query}`)
  // 首次并行启动时 Vite 需要现场编译 Three/Fiber；给样式注入留出冷启动时间。
  await expect(stage(page)).toBeVisible({ timeout: 20_000 })
}

async function waitForSettledHome(page: Page) {
  await gotoHome(page)
  await expect(stage(page)).toHaveAttribute('data-opening', 'false', { timeout: 12_000 })
  await expect(cityPoints(page)).toHaveCount(4)
  await page.waitForTimeout(350)
}

test('桌面地球、城市点位与无自动旋转', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await waitForSettledHome(page)

  const box = await stage(page).boundingBox()
  expect(box?.width).toBe(1440)
  expect(box?.height).toBe(900)

  await expect(cityPoints(page)).toHaveCount(4)
  await expect(stage(page).locator('[data-city-point][data-front="true"]')).toHaveCount(4)
  await expect(cityPoint(page, '北京市')).toHaveCount(1)
  await expect(cityPoint(page, '北京市')).toHaveAttribute('data-work-count', '3')
  await expect(cityPoint(page, '上海市')).toHaveCount(1)
  await expect(cityPoint(page, '杭州市')).toHaveCount(1)
  await expect(cityPoint(page, '深圳市')).toHaveCount(1)
  // 广州中心缺失：不能补默认坐标造一个点。
  await expect(stage(page).locator('[data-city-id="440100"]')).toHaveCount(0)

  await expect(stage(page).locator('[data-city-point][aria-hidden="true"]')).toHaveCount(0)
  await expect(page.getByText('拖动旋转 · 滚轮缩放 · 方向键微调')).toBeVisible()

  const before = await cityPoint(page, '北京市').boundingBox()
  await page.waitForTimeout(1200)
  const after = await cityPoint(page, '北京市').boundingBox()
  expect(before).not.toBeNull()
  expect(after).not.toBeNull()
  expect(Math.abs((after?.x ?? 0) - (before?.x ?? 0))).toBeLessThan(1.5)
  expect(Math.abs((after?.y ?? 0) - (before?.y ?? 0))).toBeLessThan(1.5)
})

test('点击城市点打开气泡并调整镜头', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await waitForSettledHome(page)

  const beijing = cityPoint(page, '北京市')
  await beijing.click()

  await expect(stage(page)).toHaveAttribute('data-selected-city', '110100')
  await expect(beijing).toHaveAttribute('aria-pressed', 'true')
  const bubble = stage(page).locator('[data-city-bubble]')
  await expect(bubble).toBeVisible()
  await expect(bubble.getByRole('heading', { name: '北京市' })).toBeVisible()
  await expect(bubble.locator('[data-bubble-work]')).toHaveCount(3)

  await page.waitForTimeout(850)
  await page.mouse.click(120, 700)
  await expect(stage(page)).toHaveAttribute('data-selected-city', '')
  await expect(bubble).toHaveCount(0, { timeout: 2000 })
})

test('滚轮只在球体有焦点且指针位于球体上时缩放', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await waitForSettledHome(page)

  const point = cityPoint(page, '北京市')
  const before = await point.boundingBox()
  await page.mouse.move(720, 450)
  await page.mouse.wheel(0, -120)
  await page.waitForTimeout(250)
  const unfocused = await point.boundingBox()
  expect(unfocused?.x).toBeCloseTo(before?.x ?? 0, 0)

  await page.mouse.click(900, 700)
  await page.mouse.move(720, 450)
  await page.mouse.wheel(0, -120)
  await page.waitForTimeout(250)
  const zoomed = await point.boundingBox()
  expect((zoomed?.x ?? 0) - (before?.x ?? 0)).toBeGreaterThan(2)

  await page.mouse.move(100, 700)
  await page.mouse.wheel(0, -120)
  await page.waitForTimeout(250)
  const outside = await point.boundingBox()
  expect(outside?.x).toBeCloseTo(zoomed?.x ?? 0, 0)
})

test('背面城市点不误命中，键盘聚焦时先转向可见', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await waitForSettledHome(page)

  const beijing = cityPoint(page, '北京市')
  const oldBox = await beijing.boundingBox()
  expect(oldBox).not.toBeNull()

  await page.mouse.move(500, 700)
  await page.mouse.down()
  await page.mouse.move(1200, 700, { steps: 8 })
  await page.mouse.up()
  await expect(beijing).toHaveAttribute('data-front', 'false', { timeout: 3000 })
  await expect(beijing).not.toHaveAttribute('aria-hidden', 'true')
  await expect(beijing).toHaveCSS('visibility', 'visible')
  await expect(beijing).toHaveCSS('opacity', '0')
  await expect(beijing).toHaveCSS('pointer-events', 'none')

  await page.mouse.click(oldBox!.x + 24, oldBox!.y + 24)
  await expect(stage(page)).toHaveAttribute('data-selected-city', '')

  await beijing.focus()
  await expect(beijing).toHaveAttribute('data-front', 'true', { timeout: 3000 })
  await expect(stage(page).locator('[data-city-bubble]')).toBeVisible()
  await expect(stage(page).locator('[data-city-bubble]')).toHaveAttribute('data-city-id', '110100')
})

test('开场中拖动立即接管，且不会重播', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await gotoHome(page)
  await expect(stage(page)).toHaveAttribute('data-opening', 'true')
  await expect(cityPoints(page)).toHaveCount(4, { timeout: 3000 })

  await page.mouse.move(300, 600)
  await page.mouse.down()
  await page.mouse.move(700, 600, { steps: 5 })
  await page.mouse.up()

  await expect(stage(page)).toHaveAttribute('data-opening', 'false', { timeout: 3000 })
  await expect(cityPoints(page)).toHaveCount(4)
  await expect(page.getByText('拖动旋转 · 滚轮缩放 · 方向键微调')).toBeVisible()
})

test('返回首页恢复视角并且不重播开场', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await waitForSettledHome(page)

  const initialBox = await cityPoint(page, '北京市').boundingBox()
  await page.mouse.click(120, 650)
  await page.keyboard.press('+')
  await page.keyboard.press('+')
  await page.waitForTimeout(250)
  const zoomedBox = await cityPoint(page, '北京市').boundingBox()
  expect(zoomedBox).not.toBeNull()
  expect((zoomedBox?.x ?? 0) - (initialBox?.x ?? 0)).toBeGreaterThan(5)

  await page.getByRole('link', { name: '全部作品' }).click()
  await expect(page.getByRole('heading', { name: '全部作品' })).toBeVisible()
  await page.goBack()

  await expect(stage(page)).toBeVisible()
  await expect(stage(page)).toHaveAttribute('data-opening', 'false')
  await expect(cityPoints(page)).toHaveCount(4)
  await expect(cityPoint(page, '北京市')).toHaveAttribute('data-front', 'true')
  await page.waitForTimeout(250)
  const restoredBox = await cityPoint(page, '北京市').boundingBox()
  expect(restoredBox?.x).toBeCloseTo(zoomedBox?.x ?? 0, 0)
  expect(restoredBox?.y).toBeCloseTo(zoomedBox?.y ?? 0, 0)
})

test('无城市点仍说明目录有作品，并可进入完整目录', async ({ page }) => {
  await gotoHome(page, '?mockScenario=globe-empty')
  await expect(stage(page)).toHaveAttribute('data-opening', 'false', { timeout: 12_000 })
  await expect(page.getByText('当前没有可用的城市点位')).toBeVisible()
  await expect(page.getByText(/这不表示没有作品/)).toBeVisible()

  await page.getByRole('link', { name: '前往全部作品' }).click()
  await expect(page.getByRole('heading', { name: '全部作品' })).toBeVisible()
  await expect(page.locator('a[href^="/works/"]')).toHaveCount(10)
})

test('城市点读取失败不自动重试，手动重试恢复', async ({ page }) => {
  await gotoHome(page, '?mockScenario=list-failure')
  await expect(page.getByText('城市点位读取失败')).toBeVisible()
  await expect(page.getByText(/这里不会自动重试/)).toBeVisible()
  await page.waitForTimeout(1200)
  await expect(page.getByText('城市点位读取失败')).toBeVisible()

  await page.evaluate(() => {
    const controls = (
      window as unknown as { __mockControls?: { setScenario: (value: string) => void } }
    ).__mockControls
    controls?.setScenario('normal')
  })
  await page.getByRole('button', { name: '手动重试' }).click()
  await expect(page.getByText('城市点位读取失败')).toHaveCount(0)
  await expect(cityPoints(page)).toHaveCount(4)
})

test('WebGL 不可用保留导航与完整目录入口', async ({ page }) => {
  await page.addInitScript(() => {
    HTMLCanvasElement.prototype.getContext = (() =>
      null) as typeof HTMLCanvasElement.prototype.getContext
  })
  await page.goto('/')

  await expect(page.getByText('三维场景不可用')).toBeVisible()
  await expect(page.getByText('当前浏览器无法显示地球场景')).toBeVisible()
  await expect(page.getByText('演示地球 · 正式地理素材待接入')).toHaveCount(0)
  await expect(stage(page)).toHaveCount(0)
  await expect(page.getByRole('link', { name: '地图探索' })).toBeVisible()
  await expect(page.getByRole('link', { name: '全部作品', exact: true })).toBeVisible()

  await page.getByRole('group', { name: '三维地球不可用' }).getByRole('link').click()
  await expect(page.getByRole('heading', { name: '全部作品' })).toBeVisible()
  await expect(page.locator('a[href^="/works/"]')).toHaveCount(10)
})

test('390 与 320 手机构图可用，提示不压住元信息', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await waitForSettledHome(page)

  const stage390 = await stage(page).boundingBox()
  expect(stage390?.width).toBe(390)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390)
  await expect(page.getByText('单指旋转 · 双指缩放')).toBeVisible()

  const hint = await page.getByText('单指旋转 · 双指缩放').boundingBox()
  const meta = await page.getByText('演示地球 · 正式地理素材待接入').boundingBox()
  expect(hint).not.toBeNull()
  expect(meta).not.toBeNull()
  expect((hint?.y ?? 0) + (hint?.height ?? 0)).toBeLessThanOrEqual(meta?.y ?? 0)

  await page.setViewportSize({ width: 320, height: 800 })
  await page.reload()
  await expect(stage(page)).toBeVisible()
  await expect(stage(page)).toHaveAttribute('data-opening', 'false', { timeout: 12_000 })
  const stage320 = await stage(page).boundingBox()
  expect(stage320?.width).toBe(320)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320)
})

test('减少动态模式直接呈现稳定场景，不播放开场', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 1440, height: 900 })
  await gotoHome(page)

  await expect(stage(page)).toHaveAttribute('data-reduced-motion', 'true')
  await expect(stage(page)).toHaveAttribute('data-opening', 'false')
  await expect(cityPoints(page)).toHaveCount(4)
  await expect(cityPoint(page, '北京市')).toHaveAttribute('data-front', 'true')
})

test('首页读取与悬停不下载完整模型、不创建预览会话', async ({ page }) => {
  const requests: string[] = []
  page.on('request', (request) => requests.push(request.url()))

  await page.setViewportSize({ width: 1440, height: 900 })
  await waitForSettledHome(page)
  await cityPoint(page, '北京市').hover()
  await page.waitForTimeout(400)

  const forbidden = requests.filter(
    (url) =>
      /\.(glb|gltf|ply)(\?|$)/i.test(url) ||
      url.includes('/api/preview') ||
      url.includes('/preview-sessions'),
  )
  expect(forbidden).toEqual([])
})
