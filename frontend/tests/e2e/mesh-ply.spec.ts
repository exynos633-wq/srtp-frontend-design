import { expect, test } from '@playwright/test'

const MESH_PLY = [
  'ply',
  'format ascii 1.0',
  'comment viewer mesh fixture',
  'element vertex 4',
  'property float x',
  'property float y',
  'property float z',
  'property uchar red',
  'property uchar green',
  'property uchar blue',
  'element face 1',
  'property list uchar uint vertex_indices',
  'end_header',
  '0 0 0 255 0 0',
  '1 0 0 0 255 0',
  '1 1 0 0 0 255',
  '0 1 0 255 255 255',
  '4 0 1 2 3',
  '',
].join('\n')

test('DEV 测试台加载网格 PLY，显示网格格式与三角面统计', async ({ page }) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/dev/model-viewer')
  await expect(page.getByRole('heading', { name: '客户端模型查看器测试台' })).toBeVisible({
    timeout: 20_000,
  })

  await page.locator('input[aria-label="选择本地模型文件"]').setInputFiles({
    name: 'mesh-quad.ply',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from(MESH_PLY),
  })

  await page.waitForFunction(
    () =>
      window.__srtpModelViewer?.getPhase?.() === 'ready' &&
      window.__srtpModelViewer.getDebugState().info?.format === 'mesh-ply',
    undefined,
    { timeout: 120_000 },
  )

  await expect(page.locator('[data-viewer-format="mesh-ply"]')).toBeVisible()
  await expect(page.locator('[data-viewer-phase="ready"]')).toBeVisible()
  await page.getByRole('button', { name: '模型信息' }).click()
  const info = page.locator('aside[aria-label="模型信息"]')
  await expect(info).toBeVisible()
  await expect(info.getByText('PLY 网格', { exact: true })).toBeVisible()
  await expect(info.getByText('2', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '显示设置' }).click()
  await expect(page.getByLabel('柔和补光')).toBeEnabled()
  await expect(page.locator('#viewer-splat-scale')).toBeDisabled()
})
