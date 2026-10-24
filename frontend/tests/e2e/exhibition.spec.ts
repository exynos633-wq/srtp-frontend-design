import { expect, test } from '@playwright/test'

for (const width of [320, 390, 768, 1440]) {
  test(`展陈页面在 ${width}px 下保留导航、预览入口且没有横向溢出`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    for (const path of ['/', '/works', '/works/work_demo_001']) {
      await page.goto(path)
      await expect(page.locator('main h1')).toBeVisible()
      await expect(page.getByRole('navigation', { name: '公开展示区导航' })).toBeVisible()
      if (path.endsWith('001')) {
        const start = page.getByRole('button', { name: '开始预览', exact: true })
        await expect(start).toBeVisible()
        await start.scrollIntoViewIfNeeded()
        const box = await start.boundingBox()
        expect(box!.x).toBeGreaterThanOrEqual(0)
        expect(box!.x + box!.width).toBeLessThanOrEqual(width)
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
    }
  })
}

test('指针倾斜卡片可以直接进入详情，减少动态模式保留静态入口', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/works')
  const card = page.locator('[data-work-card] a').first()
  await card.scrollIntoViewIfNeeded()
  await card.hover({ position: { x: 60, y: 80 } })
  const surface = card.locator(':scope > span')
  await expect.poll(() => surface.evaluate((node) => getComputedStyle(node).transform)).not.toBe('none')
  await card.click({ position: { x: 60, y: 80 } })
  await expect(page).toHaveURL(/\/works\/work_demo_001$/)
  await expect(page.getByRole('button', { name: '开始预览', exact: true })).toBeVisible()

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/works')
  await card.hover({ position: { x: 60, y: 80 } })
  await expect(surface).toHaveCSS('transform', 'none')
  await expect(card).toBeVisible()
})
