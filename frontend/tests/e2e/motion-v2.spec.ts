import { expect, test, type Page } from '@playwright/test'

/**
 * 动效 v2.0（UI设计/动效设计v2.0.md §10）的独立验收。
 *
 * 只做验收观察，不改产品代码：
 * - 稳定态断言与截图分离，截图前显式等到开场/入场时间轴结束，避免把中间帧当结论；
 * - 串行执行，避免多个 WebGL 场景冷启动互相抢 GPU/CPU；
 * - 截图统一用 testInfo.outputPath 落在 test-results/（gitignored）。
 */
test.describe.configure({ mode: 'serial' })
test.setTimeout(120_000)

const stage = (page: Page) => page.locator('[data-globe-stage]')
const directoryCards = (page: Page) => page.locator('a[href^="/works/"]')
const detailLayers = (page: Page) => page.locator('[data-detail-layer]')

/** 提交给 Playwright 截图前，等页面进入可解释的稳定态。 */
async function gotoHome(page: Page, query = '') {
  await page.goto(`/${query}`)
  // 懒加载的 Three/Fiber 在冷启动时可能晚于文案挂载。
  await expect(stage(page)).toBeVisible({ timeout: 30_000 })
}

async function waitForOpeningSettled(page: Page) {
  await expect(stage(page)).toHaveAttribute('data-opening', 'false', { timeout: 20_000 })
  await expect(page.locator('canvas[data-earth-ready="true"]')).toBeVisible({ timeout: 30_000 })
  await expect(stage(page).locator('[data-city-point]')).toHaveCount(4)
}

type LineFacts = {
  text: string
  transform: string
  opacity: string
  /** 内层文字是否被裁切容器（.line / overflow:hidden）切掉。 */
  clipped: boolean
}

async function readHomeLines(page: Page): Promise<LineFacts[]> {
  return page.locator('[data-home-line]').evaluateAll((elements) =>
    elements.map((element) => {
      const inner = element as HTMLElement
      const outer = inner.parentElement
      const innerRect = inner.getBoundingClientRect()
      const outerRect = outer?.getBoundingClientRect()
      return {
        text: inner.textContent?.trim() ?? '',
        transform: getComputedStyle(inner).transform,
        opacity: getComputedStyle(inner).opacity,
        clipped: outerRect
          ? innerRect.top < outerRect.top - 1 ||
            innerRect.bottom > outerRect.bottom + 1 ||
            innerRect.left < outerRect.left - 1 ||
            innerRect.right > outerRect.right + 1
          : true,
      }
    }),
  )
}

/** 标题内层稳定后不应残留位移（GSAP 会留下 translate(0%)，计算值等价于矩阵原点）。 */
const RESTING_TRANSFORMS = ['none', 'matrix(1, 0, 0, 1, 0, 0)']

function expectLineAtRest(line: LineFacts) {
  expect(RESTING_TRANSFORMS).toContain(line.transform)
  expect(line.opacity).toBe('1')
  expect(line.clipped).toBe(false)
}

/**
 * 控制台错误收集：error 级别与未捕获异常。
 * 资源/网络类错误按任务约定「允许但记录原文」，其余视为本次改动的真实缺陷。
 */
const ALLOWED_CONSOLE_ERROR = [/Failed to load resource/i, /net::ERR_/i, /WebGL/i]

function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() !== 'error') return
    errors.push(`console.error: ${message.text()}`)
  })
  page.on('pageerror', (error) => {
    errors.push(`pageerror: ${error.message}`)
  })
  return errors
}

function splitConsoleErrors(errors: string[]) {
  const allowed: string[] = []
  const significant: string[] = []
  for (const error of errors) {
    if (ALLOWED_CONSOLE_ERROR.some((pattern) => pattern.test(error))) allowed.push(error)
    else significant.push(error)
  }
  return { allowed, significant }
}

test('a. 1440×900 首页：开场结束、标题两行就位且无残留位移', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await gotoHome(page)
  await waitForOpeningSettled(page)

  const heading = page.getByRole('heading', { level: 1 })
  await expect(heading).toContainText('低空之上')
  await expect(heading).toContainText('另见世界')
  await expect(page.getByRole('link', { name: '低空视界', exact: true })).toBeVisible()

  // §4 时间表最后一段（meta 1100+300ms）之后才是完成态。
  await page.waitForTimeout(1600)

  const lines = await readHomeLines(page)
  expect(lines.map((line) => line.text)).toEqual(['低空之上', '另见世界'])
  for (const line of lines) expectLineAtRest(line)

  await page.screenshot({ path: testInfo.outputPath('home-desktop.png') })
})

test('a2. 桌面首页城市气泡打开态可稳定截图', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await gotoHome(page)
  await waitForOpeningSettled(page)

  const beijing = stage(page).locator('[data-city-point][aria-label^="北京市"]')
  await beijing.hover()
  const bubble = stage(page).locator('[data-city-bubble]')
  await expect(bubble).toBeVisible({ timeout: 5_000 })
  await expect(bubble.getByRole('heading', { name: '北京市' })).toBeVisible()
  await page.waitForTimeout(400)
  await page.screenshot({ path: testInfo.outputPath('home-desktop-bubble.png') })
})

test('b. 减少动态：开场不播、令牌归零、标题无位移', async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 1440, height: 900 })
  await gotoHome(page)

  await expect(stage(page)).toHaveAttribute('data-opening', 'false')
  await expect(stage(page)).toHaveAttribute('data-reduced-motion', 'true')
  const durEnter = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--dur-enter').trim(),
  )
  expect(durEnter).toBe('0ms')

  for (const line of await readHomeLines(page)) {
    expect(line.transform).toBe('none')
    expect(line.opacity).toBe('1')
    expect(line.clipped).toBe(false)
  }
  // 副标题/元信息也必须在首帧直接可读，而不是等动画点亮。
  await expect(page.getByText('以三维视角，探索建筑与山川')).toBeVisible()
  await expect(page.getByRole('link', { name: /浏览全部作品/ })).toBeVisible()

  await page.waitForTimeout(600)
  await page.screenshot({ path: testInfo.outputPath('home-reduced-motion.png') })
})

test('c. /works：页头、计数与首排卡片稳定可见', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/works')

  await expect(page.getByRole('heading', { name: '全部作品' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '全部作品' })).toContainText('全部作品')
  const count = page.locator('[data-directory-count]')
  await expect(count).toBeVisible()
  await expect(count).toContainText('10')
  await expect(count).toContainText('件公开作品')

  // §6 首排是宽幅 featured（跨 2 列）+ 常规卡；滚动揭示完成后应回到 opacity 1。
  await expect(directoryCards(page)).toHaveCount(10)
  const firstRow = page.locator('ul[aria-label="已发布作品"] [data-work-card]').nth(0)
  const secondCard = page.locator('ul[aria-label="已发布作品"] [data-work-card]').nth(1)
  await expect
    .poll(() => firstRow.evaluate((element) => getComputedStyle(element).opacity), {
      timeout: 8_000,
    })
    .toBe('1')
  await expect
    .poll(() => secondCard.evaluate((element) => getComputedStyle(element).opacity), {
      timeout: 8_000,
    })
    .toBe('1')
  await expect(firstRow).toBeVisible()
  await page.waitForTimeout(600)

  await page.screenshot({ path: testInfo.outputPath('works-desktop.png') })
})

test('d. 详情：封面可见、信息列 data-detail-layer 最终 opacity 1', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/works/work_demo_001')

  await expect(page.getByRole('heading', { level: 1, name: '院落模型' })).toBeVisible()
  const cover = page.locator('section[aria-label="模型观看区"] img')
  await expect(cover).toBeVisible()
  await expect
    .poll(
      () => cover.evaluate((element) => (element as HTMLImageElement).naturalWidth),
      { timeout: 10_000 },
    )
    .toBeGreaterThan(0)
  // 封面容器自身由入场时间轴点亮（直接进入时 380ms opacity）。
  await expect
    .poll(
      () => cover.evaluate((element) => getComputedStyle(element.parentElement!).opacity),
      { timeout: 10_000 },
    )
    .toBe('1')

  await expect(detailLayers(page)).toHaveCount(3)
  await expect
    .poll(
      () =>
        detailLayers(page).evaluateAll((elements) =>
          elements.map((element) => getComputedStyle(element).opacity),
        ),
      { timeout: 10_000 },
    )
    .toEqual(['1', '1', '1'])
  await expect(page.getByText('建筑介绍')).toBeVisible()

  await page.waitForTimeout(800)
  await page.screenshot({ path: testInfo.outputPath('detail-desktop.png') })
})

test('e. 390×844：手机首页与目录无横向溢出、构图完整', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await gotoHome(page)
  await waitForOpeningSettled(page)

  await expect(page.getByRole('heading', { level: 1 })).toContainText('低空之上')
  await expect(page.getByRole('link', { name: /浏览全部作品/ })).toBeVisible()
  await expect(page.locator('canvas[data-earth-ready="true"]')).toBeVisible()
  const homeScrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
  expect(homeScrollWidth).toBeLessThanOrEqual(390)
  await page.waitForTimeout(1600)
  await page.screenshot({ path: testInfo.outputPath('home-mobile.png') })
  await page.screenshot({
    path: testInfo.outputPath('home-mobile-full.png'),
    fullPage: true,
  })

  await page.goto('/works')
  await expect(page.getByRole('heading', { name: '全部作品' })).toBeVisible()
  await expect(directoryCards(page)).toHaveCount(10)
  const worksScrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
  expect(worksScrollWidth).toBeLessThanOrEqual(390)
  await page.waitForTimeout(1200)
  await page.screenshot({ path: testInfo.outputPath('works-mobile.png') })
})

test('e2. 390×844 详情页无横向溢出', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/works/work_demo_001')

  await expect(page.getByRole('heading', { level: 1, name: '院落模型' })).toBeVisible()
  await expect
    .poll(
      () =>
        detailLayers(page).evaluateAll((elements) =>
          elements.map((element) => getComputedStyle(element).opacity),
        ),
      { timeout: 10_000 },
    )
    .toEqual(['1', '1', '1'])
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
  expect(scrollWidth).toBeLessThanOrEqual(390)
  await page.waitForTimeout(800)
  await page.screenshot({ path: testInfo.outputPath('detail-mobile.png') })
})

test('f. 首页/目录/详情加载期无控制台错误', async ({ page }) => {
  const errors = collectConsoleErrors(page)
  await page.setViewportSize({ width: 1440, height: 900 })

  await gotoHome(page)
  await waitForOpeningSettled(page)

  await page.goto('/works')
  await expect(page.getByRole('heading', { name: '全部作品' })).toBeVisible()
  await expect(directoryCards(page)).toHaveCount(10)

  await page.goto('/works/work_demo_001')
  await expect(page.getByRole('heading', { level: 1, name: '院落模型' })).toBeVisible()
  await page.waitForTimeout(1500)

  const { allowed, significant } = splitConsoleErrors(errors)
  if (allowed.length > 0) {
    // 已知资源/网络类错误允许存在，但保留原文供报告引用。
    console.log(`[motion-v2] 允许的控制台错误 ${allowed.length} 条：\n${allowed.join('\n')}`)
  }
  expect(significant, `未预期的控制台错误：\n${significant.join('\n')}`).toEqual([])
})
