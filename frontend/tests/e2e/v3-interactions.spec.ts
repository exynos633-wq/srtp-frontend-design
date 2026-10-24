import { expect, test } from '@playwright/test'

test.describe.configure({ mode: 'serial' })

test('目录视差随减少动态偏好实时关闭和恢复，无需刷新', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto('/works')
  const cards = page.locator('[data-work-card] a')
  await expect(cards).toHaveCount(10)
  const offsets = () => cards.evaluateAll((items) =>
    items.map((item) => (item as HTMLElement).style.getPropertyValue('--parallax')),
  )
  await expect.poll(async () => (await offsets()).some((value) => value !== '' && value !== '0px')).toBe(true)

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect.poll(offsets).toEqual(Array(10).fill(''))
  await page.evaluate(async () => {
    window.scrollTo(0, 400)
    window.dispatchEvent(new Event('resize'))
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  })
  expect(await offsets()).toEqual(Array(10).fill(''))

  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await expect.poll(async () => (await offsets()).some((value) => value !== '' && value !== '0px')).toBe(true)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect.poll(offsets).toEqual(Array(10).fill(''))
})

test('v3 目录为桌面等距四列，详情为左观看右资料', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/works')
  const cards = page.locator('[data-work-card]')
  await expect(cards).toHaveCount(10)
  await cards.first().scrollIntoViewIfNeeded()

  const boxes = await cards.evaluateAll((items) =>
    items.slice(0, 5).map((item) => {
      const rect = item.getBoundingClientRect()
      return { x: rect.x, y: rect.y, width: rect.width }
    }),
  )
  expect(boxes).toHaveLength(5)
  for (let index = 1; index < 4; index += 1) {
    expect(boxes[index]!.y).toBeCloseTo(boxes[0]!.y, 0)
    expect(boxes[index]!.x).toBeGreaterThan(boxes[index - 1]!.x)
  }
  expect(boxes[4]!.y).toBeGreaterThan(boxes[0]!.y + 100)
  expect(boxes[0]!.width).toBeCloseTo(boxes[3]!.width, 0)

  await page.goto('/works/work_demo_001')
  await expect(page.getByRole('button', { name: '开始预览', exact: true })).toBeVisible()
  const viewer = await page.locator('[data-exhibition-viewer]').boundingBox()
  const info = await page.locator('aside[aria-label="作品信息"]').boundingBox()
  expect(viewer).not.toBeNull()
  expect(info).not.toBeNull()
  expect(viewer!.x + viewer!.width).toBeLessThan(info!.x + 1)
  expect(viewer!.width).toBeGreaterThan(info!.width)
})

test('v3 指针光、卡片多层视差与导航进度在正常模式下响应，减少动态时关闭装饰层', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/works')
  const card = page.locator('[data-work-card] a').nth(2)
  await card.scrollIntoViewIfNeeded()
  await card.hover({ position: { x: 90, y: 90 } })

  await expect.poll(() =>
    card.evaluate((element) => getComputedStyle(element).getPropertyValue('--tilt-x').trim()),
  ).not.toBe('')
  const imageTransform = await card.locator('img').evaluate(
    (element) => getComputedStyle(element).transform,
  )
  expect(imageTransform).not.toBe('none')

  await expect(page.locator('[data-pointer-atmosphere]')).toHaveCount(1)
  await expect(page.locator('[data-pointer-atmosphere]')).toHaveCSS('opacity', '1')

  await page.evaluate(() => window.scrollTo(0, 900))
  await expect(page.locator('[data-nav-progress]')).toHaveAttribute('data-visible', 'true')
  await expect(page.locator('[data-nav-indicator]')).toHaveAttribute('data-visible', 'true')

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.reload()
  await expect(page.locator('[data-pointer-atmosphere]')).toHaveCount(0)
  const reducedCard = page.locator('[data-work-card] a').first()
  await reducedCard.scrollIntoViewIfNeeded()
  await reducedCard.hover()
  await expect(reducedCard.locator(':scope > span')).toHaveCSS('transform', 'none')
})
