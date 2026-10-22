import { expect, test, type Page } from '@playwright/test'

const directoryCards = (page: Page) => page.locator('a[href^="/works/"]')

async function gotoDirectory(page: Page, query = '') {
  await page.goto(`/works${query}`)
  await expect(page.getByRole('heading', { name: '全部作品' })).toBeVisible()
}

/** 在页面内观察共享封面转场的克隆，避免用固定等待猜测转场是否发生。 */
async function installCoverProbe(page: Page) {
  await page.evaluate(() => {
    interface CloneFacts {
      ariaHidden: string | null
      pointerEvents: string
      interactive: number
    }
    const target = window as unknown as {
      __coverCloneCount?: number
      __coverCloneFacts?: CloneFacts | null
      __coverProbe?: MutationObserver
    }
    target.__coverCloneCount = 0
    target.__coverCloneFacts = null
    target.__coverProbe?.disconnect()
    target.__coverProbe = new MutationObserver(() => {
      const count = document.querySelectorAll('body > div[aria-hidden="true"] img').length
      target.__coverCloneCount = Math.max(target.__coverCloneCount ?? 0, count)
      if (target.__coverCloneFacts) return
      const layer = [...document.querySelectorAll<HTMLElement>('body > div[aria-hidden="true"]')].find(
        (element) => element.querySelector('img'),
      )
      if (!layer) return
      target.__coverCloneFacts = {
        ariaHidden: layer.getAttribute('aria-hidden'),
        pointerEvents: getComputedStyle(layer).pointerEvents,
        interactive: layer.querySelectorAll('a, button, [tabindex]').length,
      }
    })
    target.__coverProbe.observe(document.body, { childList: true, subtree: true })
  })
}

async function readCoverProbe(page: Page) {
  return page.evaluate(
    () => (window as unknown as { __coverCloneCount?: number }).__coverCloneCount ?? 0,
  )
}

async function overlayCount(page: Page) {
  return page.locator('body > div[aria-hidden="true"]').count()
}

test('目录按契约顺序展示 10 件已发布作品与未设置城市', async ({ page }) => {
  await gotoDirectory(page)
  const cards = directoryCards(page)
  await expect(cards).toHaveCount(10)

  await expect(cards.first()).toContainText('院落模型')
  await expect(cards.first()).toContainText('北京市')
  await expect(cards.last()).toContainText('模型占位 10')
  await expect(
    page.locator('ul[aria-label="已发布作品"]').getByText('未设置城市'),
  ).toHaveCount(2)
  await expect(cards.nth(2)).toContainText('未设置城市')

  const displayedOrder = await cards.evaluateAll((links) =>
    links.map((link) => link.getAttribute('href')),
  )
  expect(displayedOrder[0]).toBe('/works/work_demo_001')
  expect(displayedOrder[9]).toBe('/works/work_placeholder_010')

  // 不提供搜索、分类、分页；10 件作品靠页面滚动即可到达。
  await expect(page.getByRole('searchbox')).toHaveCount(0)
  await expect(page.getByRole('navigation', { name: /分页/ })).toHaveCount(0)
})

test('键盘可进入详情，目录返回恢复滚动与入口焦点', async ({ page }) => {
  await gotoDirectory(page)
  const entry = page.locator('a[href="/works/work_placeholder_010"]')
  await entry.scrollIntoViewIfNeeded()
  const scrollBefore = await page.evaluate(() => window.scrollY)
  expect(scrollBefore).toBeGreaterThan(0)

  await entry.focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/works\/work_placeholder_010$/)
  await expect(page.getByRole('heading', { name: '模型占位 10' })).toBeFocused()

  await page.goBack()
  await expect(page.getByRole('heading', { name: '全部作品' })).toBeVisible()
  await expect
    .poll(() => page.evaluate(() => window.scrollY))
    .toBeGreaterThan(scrollBefore - 40)
  await expect(entry).toBeFocused()
})

test('详情未开始时只有封面，不请求完整模型或创建预览会话', async ({ page }) => {
  const requests: string[] = []
  page.on('request', (request) => requests.push(request.url()))

  await page.goto('/works/work_demo_001')
  await expect(page.getByRole('heading', { name: '院落模型' })).toBeVisible()
  await expect(page.getByText('封面待预览')).toBeVisible()
  await expect(page.locator('[data-viewer-canvas]')).toHaveCount(0)

  const modelOrPreview = requests.filter(
    (url) => /\.(glb|ply)(\?|$)/.test(url) || url.includes('/api/preview'),
  )
  expect(modelOrPreview).toEqual([])
})

test('预览状态机：开始后真实加载、结束卸载与重新开始不串状态', async ({ page }) => {
  test.setTimeout(60_000)
  await page.goto('/works/work_demo_001')
  await page.getByRole('button', { name: '开始预览' }).click()
  await expect(page.locator('[data-viewer-phase]')).toHaveCount(1, { timeout: 15_000 })
  await expect(page.getByRole('button', { name: '开始预览' })).toHaveCount(0)
  await expect(page.locator('[data-viewer-phase="ready"]')).toBeVisible({ timeout: 60_000 })
  await expect(page.getByRole('button', { name: '复位视角' })).toBeEnabled()
  await expect(page.getByRole('button', { name: '放大查看' })).toBeEnabled()
  await expect(page.locator('section[aria-label="模型观看区"]')).toHaveCount(1)

  await page.getByRole('button', { name: '结束预览' }).click()
  await expect(page.getByText(/观看实例已释放/).first()).toBeVisible()
  await expect(page.locator('[data-viewer-canvas]')).toHaveCount(0)
  await page.waitForTimeout(800)
  await expect(page.locator('[data-viewer-canvas]')).toHaveCount(0)

  await page.getByRole('button', { name: '开始预览' }).click()
  await expect(page.locator('[data-viewer-phase="ready"]')).toBeVisible({ timeout: 60_000 })
  await expect(page.locator('section[aria-label="模型观看区"]')).toHaveCount(1)
})

test('放大使用同一观看区，Esc 关闭回到放大按钮且不结束预览', async ({ page }) => {
  await page.goto('/works/work_demo_001')
  await page.getByRole('button', { name: '开始预览' }).click()
  await expect(page.locator('[data-viewer-phase="ready"]')).toBeVisible({ timeout: 60_000 })

  await page.getByRole('button', { name: '放大查看' }).click()
  const dialog = page.getByRole('dialog', { name: '放大查看：院落模型' })
  await expect(dialog).toBeVisible()
  await expect(page.getByRole('button', { name: '恢复常规查看' })).toBeFocused()
  await expect(page.locator('section[aria-label^="放大查看"]')).toHaveCount(1)
  // 焦点循环包含 new input/select 等可聚焦控件，Shift+Tab 不能离开对话框。
  await page.keyboard.press('Shift+Tab')
  expect(
    await page.evaluate(() => document.querySelector('[role="dialog"]')?.contains(document.activeElement) ?? false),
  ).toBe(true)

  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('button', { name: '放大查看' })).toBeFocused()
  await expect(page.locator('[data-viewer-phase="ready"]')).toBeVisible()
})

test('目录到详情发生共享封面克隆，结束后不残留遮罩或克隆', async ({ page }) => {
  await gotoDirectory(page)
  await expect(
    page.locator('a[href="/works/work_demo_001"] [data-cover-ready="true"]'),
  ).toHaveCount(1)
  await installCoverProbe(page)
  await page.locator('a[href="/works/work_demo_001"]').click()

  await expect(page).toHaveURL(/\/works\/work_demo_001$/)
  await expect(page.getByRole('heading', { name: '院落模型' })).toBeVisible()
  await expect.poll(() => readCoverProbe(page)).toBeGreaterThan(0)
  await expect(page.getByText('建筑介绍')).toBeVisible()

  // 视觉代理只负责动画：对辅助技术隐藏、不接收指针，也不含可聚焦链接。
  const cloneFacts = await page.evaluate(
    () =>
      (window as unknown as {
        __coverCloneFacts?: {
          ariaHidden: string | null
          pointerEvents: string
          interactive: number
        } | null
      }).__coverCloneFacts ?? null,
  )
  expect(cloneFacts).toEqual({
    ariaHidden: 'true',
    pointerEvents: 'none',
    interactive: 0,
  })

  await expect.poll(() => overlayCount(page), { timeout: 3000 }).toBe(0)
})

test('转场中立即返回或改变窗口尺寸，旧代理会被清理', async ({ page }) => {
  await gotoDirectory(page)
  await expect(
    page.locator('a[href="/works/work_demo_001"] [data-cover-ready="true"]'),
  ).toHaveCount(1)
  await installCoverProbe(page)
  await page.locator('a[href="/works/work_demo_001"]').click()
  await expect(page).toHaveURL(/\/works\/work_demo_001$/)
  await page.goBack()

  await expect(page.getByRole('heading', { name: '全部作品' })).toBeVisible()
  await expect.poll(() => overlayCount(page), { timeout: 3000 }).toBe(0)

  await installCoverProbe(page)
  await page.locator('a[href="/works/work_demo_002"]').click()
  await expect(page).toHaveURL(/\/works\/work_demo_002$/)
  await page.setViewportSize({ width: 900, height: 800 })
  await expect(page.getByRole('heading', { name: '长城模型' })).toBeVisible()
  await expect.poll(() => overlayCount(page), { timeout: 3000 }).toBe(0)
  await expect(page).toHaveURL(/\/works\/work_demo_002$/)
})

test('空、失败与手动重试、封面失败均可演示', async ({ page }) => {
  await gotoDirectory(page, '?mockScenario=empty')
  await expect(page.getByText('暂无已发布作品。新作品发布后会出现在这里，不需要刷新页面。')).toBeVisible()
  await expect(directoryCards(page)).toHaveCount(0)

  await gotoDirectory(page, '?mockScenario=list-failure')
  await expect(page.getByText('读取作品列表失败。')).toBeVisible()
  await expect(page.getByRole('button', { name: '手动重试' })).toBeVisible()
  await expect(directoryCards(page)).toHaveCount(0)

  // 切回正常场景后手动重试才恢复，失败时不会自动回退或自动重试。
  await page.evaluate(() => window.__mockControls?.setScenario('normal'))
  await page.getByRole('button', { name: '手动重试' }).click()
  await expect(directoryCards(page)).toHaveCount(10)

  await gotoDirectory(page, '?mockScenario=cover-failure')
  await expect(directoryCards(page)).toHaveCount(10)
  await expect(page.getByText('封面暂不可用')).toHaveCount(10)
  await expect(page.locator('a[href="/works/work_demo_001"] img')).toHaveCount(0)

  await page.locator('a[href="/works/work_demo_001"]').click()
  await expect(page).toHaveURL(/\/works\/work_demo_001$/)
  await expect(page.getByRole('heading', { level: 1, name: '院落模型' })).toBeVisible()
  await expect(
    page.locator('section[aria-label="模型观看区"]').getByText('封面暂不可用'),
  ).toBeVisible()
  await expect(page.locator('section[aria-label="模型观看区"] img')).toHaveCount(0)
})

test('详情读取失败、404 与手动重试均可用', async ({ page }) => {
  await page.goto('/works/work_demo_001?mockScenario=empty')
  await expect(page.getByRole('heading', { name: '作品不存在' })).toBeVisible()
  await expect(page.getByText('该作品可能未公开、已下架，或编号有误。')).toBeVisible()
  await expect(page.getByRole('button', { name: '开始预览' })).toHaveCount(0)

  await page.goto('/works/work_demo_001?mockScenario=list-failure')
  await expect(page.getByRole('heading', { name: '作品读取失败' })).toBeVisible()
  await expect(page.getByRole('button', { name: '手动重试' })).toBeVisible()
  await page.evaluate(() => window.__mockControls?.setScenario('normal'))
  await page.getByRole('button', { name: '手动重试' }).click()
  await expect(page.getByRole('heading', { level: 1, name: '院落模型' })).toBeVisible()
  await expect(page.getByText('封面待预览')).toBeVisible()
  await expect(page.locator('[data-viewer-canvas]')).toHaveCount(0)

  await page.goto('/works/no-such-work')
  await expect(page.getByRole('heading', { name: '作品不存在' })).toBeVisible()
  await expect(page.getByRole('link', { name: /返回全部作品/ })).toBeVisible()
})

test('预览开始后离开详情再进入另一作品，不串用旧会话', async ({ page }) => {
  await page.goto('/works/work_demo_001')
  await page.getByRole('button', { name: '开始预览' }).click()
  await expect(page.locator('[data-viewer-canvas]')).toHaveCount(1, { timeout: 15_000 })

  await page
    .getByRole('navigation', { name: '公开展示区导航' })
    .getByRole('link', { name: '全部作品' })
    .click()
  await expect(page.getByRole('heading', { name: '全部作品' })).toBeVisible()
  await page.locator('a[href="/works/work_demo_002"]').click()
  await expect(page).toHaveURL(/\/works\/work_demo_002$/)
  await expect(page.getByRole('heading', { level: 1, name: '长城模型' })).toBeVisible()
  await expect(page.getByText('封面待预览')).toBeVisible()
  await expect(page.locator('[data-viewer-canvas]')).toHaveCount(0)
  await expect.poll(() => overlayCount(page), { timeout: 2000 }).toBe(0)
})

test('连续点击两件作品后 URL 与页面一致，旧转场不残留', async ({ page }) => {
  await gotoDirectory(page)
  await installCoverProbe(page)
  await page.evaluate(() => {
    const first = document.querySelector<HTMLAnchorElement>('a[href="/works/work_demo_001"]')
    const second = document.querySelector<HTMLAnchorElement>('a[href="/works/work_demo_002"]')
    first?.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }))
    second?.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }))
  })

  await expect(page).toHaveURL(/\/works\/work_demo_00[12]$/)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page.getByText('建筑介绍')).toBeVisible()
  await expect.poll(() => overlayCount(page), { timeout: 3000 }).toBe(0)
})

test('目录悬停只读取元数据，不下载模型或创建预览会话', async ({ page }) => {
  const requests: string[] = []
  page.on('request', (request) => requests.push(request.url()))
  await gotoDirectory(page)
  await page.locator('a[href="/works/work_demo_001"]').hover()
  await page.waitForTimeout(400)

  const modelOrPreview = requests.filter(
    (url) => /\.(glb|ply)(\?|$)/.test(url) || url.includes('/api/preview'),
  )
  expect(modelOrPreview).toEqual([])
})

test.describe('手机目录布局', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('单列、卡片宽度受控且可滚动到第 10 件', async ({ page }) => {
    await gotoDirectory(page)
    await expect(directoryCards(page)).toHaveCount(10)

    const columns = await page.locator('ul[aria-label="已发布作品"]').evaluate((element) =>
      getComputedStyle(element).gridTemplateColumns.split(' ').filter(Boolean).length,
    )
    expect(columns).toBe(1)

    const firstBox = await directoryCards(page).first().boundingBox()
    expect(firstBox?.width ?? 0).toBeGreaterThan(300)
    expect(firstBox?.width ?? 0).toBeLessThanOrEqual(360)

    const last = page.locator('a[href="/works/work_placeholder_010"]')
    await last.scrollIntoViewIfNeeded()
    await expect(last).toBeVisible()
    await expect(last).toContainText('模型占位 10')
  })

  test('手机也使用同一封面连续转场并清理视觉代理', async ({ page }) => {
    await gotoDirectory(page)
    await expect(
      page.locator('a[href="/works/work_demo_001"] [data-cover-ready="true"]'),
    ).toHaveCount(1)
    await installCoverProbe(page)
    await page.locator('a[href="/works/work_demo_001"]').click()

    await expect(page).toHaveURL(/\/works\/work_demo_001$/)
    await expect(page.getByRole('heading', { level: 1, name: '院落模型' })).toBeVisible()
    await expect.poll(() => readCoverProbe(page)).toBeGreaterThan(0)
    await expect.poll(() => overlayCount(page), { timeout: 3000 }).toBe(0)
  })
})

test.describe('减少动态偏好', () => {
  test.use({ reducedMotion: 'reduce' })

  test('目录不隐藏卡片，详情不播放共享克隆，内容直接可读', async ({ page }) => {
    await gotoDirectory(page)
    await expect(directoryCards(page)).toHaveCount(10)
    const opacity = await page
      .locator('ul[aria-label="已发布作品"] [data-work-card]')
      .first()
      .evaluate((element) => getComputedStyle(element).opacity)
    expect(opacity).toBe('1')

    await installCoverProbe(page)
    await page.locator('a[href="/works/work_demo_001"]').click()
    await expect(page.getByRole('heading', { name: '院落模型' })).toBeVisible()
    await expect(page.getByRole('heading', { name: '建筑介绍' })).toBeVisible()
    expect(await readCoverProbe(page)).toBe(0)
    await expect.poll(() => overlayCount(page), { timeout: 2000 }).toBe(0)

    await page.goto('/works/work_demo_001')
    await expect(page.getByText('封面待预览')).toBeVisible()
    await expect(page.getByRole('heading', { name: '建筑介绍' })).toBeVisible()
    expect(await readCoverProbe(page)).toBe(0)
  })
})