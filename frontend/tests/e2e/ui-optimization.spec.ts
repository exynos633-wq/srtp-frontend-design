import { expect, test } from '@playwright/test'
import { viewerMenuItem } from './support/viewer-menu'

test('新版首页在桌面与手机保持主标题、彩色地球和目录入口', async ({ page }, testInfo) => {
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/')
    await expect(page.getByRole('link', { name: '低空视界', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { level: 1 })).toContainText('低空之上')
    await expect(page.getByRole('link', { name: /浏览全部作品/ })).toBeVisible()
    await expect(page.locator('canvas[data-earth-ready="true"]')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    if (width === 1440) {
      await expect(page.getByRole('button', { name: /北京市/ })).toBeVisible()
      // Capture the settled 1.3s entrance, rather than an intermediate camera pose.
      await page.waitForTimeout(1600)
      await page.getByRole('button', { name: /北京市，/ }).click()
      await expect(page.getByRole('button', { name: '关闭北京市作品列表' })).toBeVisible()
      await expect(page.getByRole('link', { name: /院落模型.*查看作品/ })).toBeVisible()
      await expect(page.locator('[data-city-bubble]')).toHaveCSS('opacity', '1')
      await expect.poll(() => page.locator('[data-city-bubble] img').evaluateAll((images) => images.every((image) => (image as HTMLImageElement).complete))).toBe(true)
      await page.screenshot({ path: testInfo.outputPath('homepage.png') })
    }
  }
})

test('真实模型常用工具、设置、放大恢复和窄屏菜单完整可用', async ({ page }, testInfo) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/works/work_demo_001')
  await page.getByRole('button', { name: '开始预览' }).click()
  await expect(page.locator('[data-viewer-phase="ready"]')).toBeVisible({ timeout: 90_000 })
  const initial = await page.evaluate(() => window.__srtpModelViewer!.getDebugState())
  expect(initial.camera.target).toEqual(initial.info?.bounds.center)
  await expect(page.getByRole('toolbar').getByRole('button')).toHaveCount(6)
  await expect(page.getByRole('button', { name: /步行/ })).toHaveCount(0)
  await viewerMenuItem(page, '模型信息')
  await page.screenshot({ path: testInfo.outputPath('viewer-more.png') })
  await page.getByRole('menuitem', { name: '模型信息', exact: true }).click()
  await expect(page.getByRole('complementary', { name: '模型信息' })).toBeVisible()
  await page.getByRole('button', { name: '关闭模型信息' }).click()
  await (await viewerMenuItem(page, '显示设置')).click()
  await expect(page.getByLabel('泛光 Bloom', { exact: true })).toBeVisible()
  await expect(page.getByLabel('步行相对速度')).toHaveCount(0)
  await page.getByRole('button', { name: '关闭显示设置' }).click()
  await page.getByRole('button', { name: '放大查看', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.locator('[data-action="close-zoom"]').click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '放大查看', exact: true })).toBeFocused()
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 })
    const toolbar = page.getByRole('toolbar')
    for (const name of ['环绕模式', '飞行模式', '复位视角', '放大查看', '全屏查看', '… 更多']) {
      const button = toolbar.getByRole('button', { name, exact: true })
      await expect(button).toBeVisible()
      const bounds = await button.boundingBox()
      expect(bounds!.width).toBeGreaterThanOrEqual(44)
      expect(bounds!.x).toBeGreaterThanOrEqual(0)
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width)
    }
    await page.getByRole('button', { name: '… 更多' }).click()
    const box = await page.getByRole('menu').boundingBox()
    expect(box).not.toBeNull()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(width)
    await page.keyboard.press('Escape')
  }
  await (await viewerMenuItem(page, '结束预览')).click()
  await expect(page.getByRole('button', { name: '开始预览' })).toBeVisible()
})
