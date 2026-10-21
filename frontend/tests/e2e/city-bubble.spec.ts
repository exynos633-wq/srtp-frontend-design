import { expect, test, type Page } from '@playwright/test'

test.describe.configure({ mode: 'serial' })
test.setTimeout(60_000)

const stage = (page: Page) => page.locator('[data-globe-stage]')
const point = (page: Page, city: string) =>
  stage(page).locator(`[data-city-point][data-city-id="${city}"]`)
const bubble = (page: Page) => stage(page).locator('[data-city-bubble]')

async function installCoverProbe(page: Page) {
  await page.evaluate(() => {
    const target = window as unknown as {
      __coverCloneCount?: number
      __coverProbe?: MutationObserver
    }
    target.__coverCloneCount = 0
    target.__coverProbe?.disconnect()
    target.__coverProbe = new MutationObserver(() => {
      const count = document.querySelectorAll('body > div[aria-hidden="true"] img').length
      target.__coverCloneCount = Math.max(target.__coverCloneCount ?? 0, count)
    })
    target.__coverProbe.observe(document.body, { childList: true, subtree: true })
  })
}

async function gotoHome(page: Page, query = '') {
  await page.goto(`/${query}`)
  await expect(stage(page)).toBeVisible({ timeout: 20_000 })
  await expect(stage(page)).toHaveAttribute('data-opening', 'false', { timeout: 5_000 })
  await expect(stage(page).locator('[data-city-point]')).toHaveCount(4)
  await page.waitForTimeout(300)
}

async function clickPoint(page: Page, city: string) {
  const target = point(page, city)
  const box = await target.boundingBox()
  if (!box) throw new Error(`missing city point ${city}`)
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
}

test('桌面悬停打开唯一气泡，移入卡片不关闭且不移动镜头', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await gotoHome(page)

  const beijing = point(page, '110100')
  const before = await beijing.boundingBox()
  await beijing.hover()
  await expect(bubble(page)).toBeVisible({ timeout: 2000 })
  await expect(bubble(page).getByRole('heading', { name: '北京市' })).toBeVisible()
  await expect(bubble(page).locator('[data-bubble-work]')).toHaveCount(3)
  await expect(page.locator('[data-city-bubble]')).toHaveCount(1)

  const afterHover = await beijing.boundingBox()
  expect(Math.abs((afterHover?.x ?? 0) - (before?.x ?? 0))).toBeLessThan(1.5)
  expect(Math.abs((afterHover?.y ?? 0) - (before?.y ?? 0))).toBeLessThan(1.5)

  await bubble(page).hover()
  await page.waitForTimeout(500)
  await expect(page.locator('[data-city-bubble]')).toHaveCount(1)
  await expect(bubble(page)).toHaveAttribute('data-mode', 'hover')
  await expect(bubble(page)).toHaveAttribute('data-solid', 'false')

  await clickPoint(page, '110100')
  await expect(bubble(page)).toHaveAttribute('data-mode', 'pinned')
  await expect(stage(page)).toHaveAttribute('data-selected-city', '110100')
})

test('点击城市打开气泡、移动镜头，关闭后焦点回到点位', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await gotoHome(page)

  const beijing = point(page, '110100')
  const before = await beijing.boundingBox()
  await clickPoint(page, '110100')
  await expect(bubble(page)).toBeVisible({ timeout: 2000 })
  await expect(stage(page)).toHaveAttribute('data-selected-city', '110100')
  await expect(bubble(page)).toHaveAttribute('data-mode', 'pinned')

  await page.waitForTimeout(900)
  const after = await beijing.boundingBox()
  expect(Math.abs((after?.x ?? 0) - (before?.x ?? 0))).toBeGreaterThan(2)

  const line = page.locator('svg line')
  await expect(line).toHaveCSS('visibility', 'visible')
  const lineBox = await line.boundingBox()
  expect(lineBox).not.toBeNull()
  expect((lineBox?.width ?? 0) + (lineBox?.height ?? 0)).toBeGreaterThan(0)

  await bubble(page).getByRole('button', { name: '关闭北京市作品列表' }).click()
  await expect(page.locator('[data-city-bubble]')).toHaveCount(0, { timeout: 2000 })
  await expect(beijing).toBeFocused()
})

test('键盘顺序为点→关闭→作品，Esc 关闭后不立即重开', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await gotoHome(page)

  const beijing = point(page, '110100')
  await beijing.focus()
  await expect(bubble(page)).toBeVisible()
  await expect(beijing).toBeFocused()

  await page.keyboard.press('Tab')
  await expect(bubble(page).getByRole('button', { name: '关闭北京市作品列表' })).toBeFocused()
  await page.keyboard.press('Tab')
  const firstWork = bubble(page).locator('[data-bubble-work] a').first()
  await expect(firstWork).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(bubble(page).locator('[data-bubble-work] a').nth(1)).toBeFocused()

  await page.keyboard.press('Escape')
  await expect(page.locator('[data-city-bubble]')).toHaveCount(0, { timeout: 2000 })
  await expect(beijing).toBeFocused()
  await page.waitForTimeout(500)
  await expect(page.locator('[data-city-bubble]')).toHaveCount(0)

  await page.keyboard.press('Enter')
  await expect(bubble(page)).toBeVisible({ timeout: 2000 })
})

test('背面城市点可 Tab 到达，先转至可见再打开气泡', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await gotoHome(page)

  await page.mouse.move(500, 700)
  await page.mouse.down()
  await page.mouse.move(1200, 700, { steps: 8 })
  await page.mouse.up()
  const beijing = point(page, '110100')
  await expect(beijing).toHaveAttribute('data-front', 'false')
  await expect(beijing).toHaveCSS('opacity', '0')

  await beijing.focus()
  await expect(beijing).toHaveAttribute('data-front', 'true', { timeout: 3000 })
  await expect(bubble(page)).toBeVisible({ timeout: 2000 })
  await expect(stage(page)).toHaveAttribute('data-selected-city', '110100')
})

test('手机气泡在点位附近且不越界，列表滚动不拖动地球', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await gotoHome(page)

  const beijing = point(page, '110100')
  await clickPoint(page, '110100')
  await expect(bubble(page)).toBeVisible({ timeout: 2000 })
  await expect(bubble(page)).toHaveAttribute('data-solid', 'true')
  await page.waitForTimeout(900)
  const pointBox = await beijing.boundingBox()
  const box = await bubble(page).boundingBox()
  const stageBox = await stage(page).boundingBox()
  expect(box?.width).toBeCloseTo(280, 1)
  expect(box!.x).toBeGreaterThanOrEqual((stageBox?.x ?? 0) + 16 - 1)
  expect(box!.x + box!.width).toBeLessThanOrEqual((stageBox?.x ?? 0) + (stageBox?.width ?? 390) - 16 + 1)
  expect(box!.y).toBeGreaterThanOrEqual(stageBox?.y ?? 0)
  expect(box!.y + box!.height).toBeLessThanOrEqual((stageBox?.y ?? 0) + (stageBox?.height ?? 844) - 16 + 1)
  expect(box!.y).toBeGreaterThan(pointBox!.y)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390)

  const list = bubble(page).locator('ul')
  const scrollState = await list.evaluate((element) => ({
    scrollHeight: element.scrollHeight,
    clientHeight: element.clientHeight,
  }))
  expect(scrollState.scrollHeight).toBeGreaterThanOrEqual(scrollState.clientHeight)

  await page.setViewportSize({ width: 390, height: 430 })
  await expect(bubble(page)).toBeVisible()
  await page.waitForTimeout(400)
  const shortBubble = await bubble(page).boundingBox()
  const shortStage = await stage(page).boundingBox()
  expect(shortBubble!.y + shortBubble!.height).toBeLessThanOrEqual(
    (shortStage?.y ?? 0) + (shortStage?.height ?? 430) - 16 + 1,
  )
  const shortList = bubble(page).locator('ul')
  const canScroll = await shortList.evaluate(
    (element) => element.scrollHeight > element.clientHeight,
  )
  expect(canScroll).toBe(true)
  const before = await beijing.boundingBox()
  await shortList.evaluate((element) => {
    element.scrollTop = 40
  })
  const after = await beijing.boundingBox()
  expect(Math.abs((after?.x ?? 0) - (before?.x ?? 0))).toBeLessThan(1.5)
  expect(Math.abs((after?.y ?? 0) - (before?.y ?? 0))).toBeLessThan(1.5)
})

test('相邻点重叠时按最近点命中，不误开错城市', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await gotoHome(page)

  const shanghai = await point(page, '310100').boundingBox()
  if (!shanghai) throw new Error('missing Shanghai point')
  await page.mouse.click(shanghai.x + shanghai.width / 2, shanghai.y + shanghai.height / 2)
  await expect(bubble(page)).toBeVisible()
  await expect(bubble(page).getByRole('heading', { name: '上海市' })).toBeVisible()
  await expect(stage(page)).toHaveAttribute('data-selected-city', '310100')
})

test('键盘快速切城只保留一个气泡并落在后选城市', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await gotoHome(page)

  await clickPoint(page, '110100')
  await expect(bubble(page)).toBeVisible()
  await expect(bubble(page).getByRole('heading', { name: '北京市' })).toBeVisible()

  await point(page, '310100').focus()
  await page.waitForTimeout(900)
  await expect(page.locator('[data-city-bubble]')).toHaveCount(1)
  await expect(bubble(page).getByRole('heading', { name: '上海市' })).toBeVisible()
  await expect(stage(page)).toHaveAttribute('data-selected-city', '310100')
})

test('拖动立即关闭气泡并接管镜头', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await gotoHome(page)

  await clickPoint(page, '110100')
  await expect(bubble(page)).toBeVisible()
  await page.mouse.move(400, 700)
  await page.mouse.down()
  await page.mouse.move(900, 700, { steps: 8 })
  await page.mouse.up()
  await expect(page.locator('[data-city-bubble]')).toHaveCount(0, { timeout: 2000 })
  await expect(stage(page)).toHaveAttribute('data-selected-city', '')
})

test('城市无作品时说明目录仍有作品并可进入完整目录', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await gotoHome(page, '?mockScenario=city-empty')

  await clickPoint(page, '110100')
  await expect(bubble(page)).toBeVisible()
  await expect(bubble(page).getByText('该城市暂无可浏览的作品')).toBeVisible()
  await expect(bubble(page).locator('[data-bubble-work]')).toHaveCount(0)
  await expect(bubble(page).getByRole('link', { name: '前往全部作品' })).toHaveAttribute(
    'href',
    '/works',
  )
})

test('城市作品读取失败可就地手动重试', async ({ page }) => {
  const requests: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('/api/globe/cities/') && request.url().includes('/works')) {
      requests.push(request.url())
    }
  })
  await page.setViewportSize({ width: 1440, height: 900 })
  await gotoHome(page, '?mockScenario=city-list-failure')

  await clickPoint(page, '110100')
  await expect(bubble(page)).toBeVisible()
  await expect(bubble(page).getByRole('alert')).toContainText('城市作品读取失败')
  await expect(bubble(page).getByRole('button', { name: '手动重试' })).toBeVisible()
  await expect(bubble(page).locator('[data-bubble-work]')).toHaveCount(0)
  const before = requests.length
  await bubble(page).getByRole('button', { name: '手动重试' }).click()
  await expect.poll(() => requests.length).toBeGreaterThan(before)
  await expect(bubble(page).getByRole('alert')).toBeVisible()
})

test('气泡作品链接接入详情页，且只使用被点击封面作为来源', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await gotoHome(page)

  await clickPoint(page, '110100')
  await expect(bubble(page)).toBeVisible()
  await installCoverProbe(page)
  const link = bubble(page).locator('[data-bubble-work] a').first()
  await expect(link).toHaveAttribute('href', '/works/work_demo_001')
  await link.click()
  await expect(page).toHaveURL(/\/works\/work_demo_001$/)
  await expect(page.getByRole('heading', { level: 1, name: '院落模型' })).toBeVisible()
  await expect(page.locator('[data-city-bubble]')).toHaveCount(0)
  // 共享封面代理是短生命周期视觉层，MutationObserver 与断言之间允许一个渲染帧。
  await expect
    .poll(
      () =>
        page.evaluate(
          () => (window as unknown as { __coverCloneCount?: number }).__coverCloneCount ?? 0,
        ),
      { timeout: 3000 },
    )
    .toBe(1)
})
