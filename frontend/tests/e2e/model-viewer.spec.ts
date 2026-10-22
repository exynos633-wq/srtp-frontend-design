import fs from 'node:fs'
import { expect, test, type Page } from '@playwright/test'

import type { ViewerDebug } from './support/viewer-debug'

const MODELS = [
  { id: 'work_demo_001', name: '院落模型', format: 'glb', bytes: 24_818_280, triangles: 268_540 },
  { id: 'work_demo_002', name: '长城模型', format: 'glb', bytes: 195_625_056, triangles: 1_842_014 },
  { id: 'work_demo_003', name: '丘陵模型', format: 'gaussian-ply', bytes: 264_843_708, splats: 1_067_912 },
]

async function openReady(page: Page, id: string): Promise<void> {
  await page.goto(`/works/${id}`)
  await expect(page.getByRole('button', { name: '开始预览' })).toBeVisible()
  await page.getByRole('button', { name: '开始预览' }).click()
  await page.waitForFunction(() => window.__srtpModelViewer?.getPhase?.() === 'ready', undefined, {
    timeout: 120_000,
  })
  await expect(page.locator('[data-viewer-phase="ready"]')).toBeVisible()
}

async function debugState(page: Page): Promise<ViewerDebug> {
  return page.evaluate(() => window.__srtpModelViewer!.getDebugState())
}

async function downloadPng(page: Page): Promise<Buffer> {
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: '保存 PNG 截图' }).click()
  const download = await downloadPromise
  const path = await download.path()
  expect(path).toBeTruthy()
  return fs.readFileSync(path!)
}

function pngSize(buffer: Buffer): { width: number; height: number } {
  expect(buffer.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  expect(buffer.length).toBeGreaterThan(1000)
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

function distance(a: number[], b: number[]): number {
  return Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!)
}

test.describe('真实客户端模型查看器', () => {
  test('公开详情加载三件真实模型，PNG 尺寸与画布一致且不含 DOM', async ({ page }) => {
    test.setTimeout(180_000)
    await page.setViewportSize({ width: 1440, height: 900 })
    for (const model of MODELS) {
      await openReady(page, model.id)
      const autoBefore = await debugState(page)
      expect(autoBefore.autoRotate.enabled).toBe(true)
      await page.waitForTimeout(1200)
      const autoAfter = await debugState(page)
      expect(distance(autoBefore.camera.position, autoAfter.camera.position)).toBeGreaterThan(0.5)
      await page.evaluate(() => window.__srtpModelViewer!.setAutoRotate(false))
      await page.waitForTimeout(1500)
      const state = await debugState(page)
      expect(state.error).toBeNull()
      expect(state.info?.format).toBe(model.format)
      expect(state.info?.bytes).toBe(model.bytes)
      if (model.format === 'gaussian-ply') {
        expect(state.info?.splats).toBe(model.splats)
        expect(state.info?.shDegree).toBe(3)
        expect(state.stats?.drawCalls).toBeGreaterThan(0)
      } else {
        expect(state.info?.triangles).toBe(model.triangles)
        expect(state.info?.sourceUp).toBe('y')
        expect(state.stats?.drawCalls).toBeGreaterThan(10)
      }
      expect(state.stats?.width).toBeGreaterThan(300)
      expect(state.stats?.height).toBeGreaterThan(200)
      expect(state.camera.up).toEqual([0, 0, 1])
      expect(state.stats?.dpr).toBeLessThanOrEqual(1.5)

      const png = await downloadPng(page)
      const size = pngSize(png)
      expect(size.width).toBe(state.stats?.width)
      expect(size.height).toBe(state.stats?.height)
      expect(size.width).not.toBe(1440)
      const body = await page.locator('body').innerText()
      expect(body).not.toContain('模拟观看')
      expect(body).not.toContain('真实模型渲染尚未接入')
      expect(body).not.toMatch(/渲染资源繁忙|渲染服务离线|观看连接已断开/)
    }
  })

  test('Bloom 对 GLB 与高斯都改变真实合成画面，截图保持同一相机', async ({ page }) => {
    test.setTimeout(180_000)
    await page.setViewportSize({ width: 1440, height: 900 })
    for (const model of [MODELS[0]!, MODELS[2]!]) {
      await openReady(page, model.id)
      await page.evaluate(() => window.__srtpModelViewer!.setAutoRotate(false))
      await page.waitForTimeout(700)
      const before = await debugState(page)
      const off = await downloadPng(page)
      const afterOff = await debugState(page)
      expect(afterOff.camera.position).toEqual(before.camera.position)
      expect(afterOff.camera.target).toEqual(before.camera.target)

      await page.getByRole('button', { name: '显示设置' }).click()
      await page.locator('#viewer-bloom').check()
      await page.locator('#viewer-bloom-strength').fill('1.5')
      await page.getByRole('button', { name: '关闭显示设置' }).click()
      await page.waitForTimeout(900)
      const on = await downloadPng(page)
      expect(pngSize(off)).toEqual(pngSize(on))

      const diff = await page.evaluate(
        async ({ a, b }) => {
          const load = async (base64: string) => {
            const image = new Image()
            image.src = `data:image/png;base64,${base64}`
            await image.decode()
            const canvas = document.createElement('canvas')
            canvas.width = image.width
            canvas.height = image.height
            const context = canvas.getContext('2d')!
            context.drawImage(image, 0, 0)
            return context.getImageData(0, 0, image.width, image.height).data
          }
          const left = await load(a)
          const right = await load(b)
          let changed = 0
          let max = 0
          let sum = 0
          for (let index = 0; index < left.length; index += 4) {
            const delta =
              Math.abs(left[index]! - right[index]!) +
              Math.abs(left[index + 1]! - right[index + 1]!) +
              Math.abs(left[index + 2]! - right[index + 2]!)
            if (delta > 12) changed += 1
            if (delta > max) max = delta
            sum += delta
          }
          return { changed, max, mean: sum / (left.length / 4), pixels: left.length / 4 }
        },
        { a: off.toString('base64'), b: on.toString('base64') },
      )
      expect(diff.max).toBeGreaterThan(12)
      expect(diff.changed).toBeGreaterThan(50)
      expect(diff.mean).toBeGreaterThan(0.01)
    }
  })

  test('Orbit/Fly 键鼠、暂停自动旋转、复位、模态清键与触控边界', async ({ page, browser }) => {
    test.setTimeout(120_000)
    await page.setViewportSize({ width: 1440, height: 900 })
    await openReady(page, 'work_demo_001')
    await page.evaluate(() => window.__srtpModelViewer!.setAutoRotate(false))
    const canvas = page.locator('canvas')
    const box = await canvas.boundingBox()
    expect(box).toBeTruthy()
    const center = { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 }

    const initial = await debugState(page)
    const orbitCtrlW = await page.evaluate(() => {
      const canvas = document.querySelector('canvas')!
      const event = new KeyboardEvent('keydown', {
        key: 'w',
        code: 'KeyW',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      })
      canvas.dispatchEvent(event)
      const keys = window.__srtpModelViewer!.keys?.size ?? -1
      canvas.dispatchEvent(new KeyboardEvent('keyup', { key: 'w', code: 'KeyW', ctrlKey: true }))
      return { prevented: event.defaultPrevented, keys }
    })
    expect(orbitCtrlW).toEqual({ prevented: false, keys: 0 })
    await page.getByRole('button', { name: '复位视角' }).click()
    await page.waitForTimeout(150)
    const resetBaseline = await debugState(page)
    // Orbit 没有自由 look：右键拖动不能改 quaternion 后又被自动恢复跳回。
    const beforeRightDrag = await debugState(page)
    await page.mouse.move(center.x, center.y)
    await page.mouse.down({ button: 'right' })
    await page.mouse.move(center.x + 90, center.y + 40, { steps: 6 })
    await page.mouse.up({ button: 'right' })
    await page.waitForTimeout(150)
    const afterRightDrag = await debugState(page)
    expect(distance(beforeRightDrag.camera.position, afterRightDrag.camera.position)).toBeLessThan(0.01)
    expect(distance(beforeRightDrag.camera.target, afterRightDrag.camera.target)).toBeLessThan(0.01)

    await page.mouse.move(center.x, center.y)
    await page.mouse.down({ button: 'left' })
    await page.mouse.move(center.x + 120, center.y + 30, { steps: 8 })
    await page.mouse.up({ button: 'left' })
    await page.waitForTimeout(150)
    const rotated = await debugState(page)
    expect(distance(initial.camera.position, rotated.camera.position)).toBeGreaterThan(20)

    const beforeZoom = await debugState(page)
    await page.mouse.wheel(0, -500)
    await page.waitForTimeout(150)
    const zoomed = await debugState(page)
    const beforeDistance = distance(beforeZoom.camera.position, beforeZoom.camera.target)
    const afterDistance = distance(zoomed.camera.position, zoomed.camera.target)
    expect(afterDistance).toBeLessThan(beforeDistance * 0.8)

    await page.getByRole('button', { name: '飞行模式' }).click()
    const flyCtrlW = await page.evaluate(() => {
      const canvas = document.querySelector('canvas')!
      const event = new KeyboardEvent('keydown', {
        key: 'w',
        code: 'KeyW',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      })
      canvas.dispatchEvent(event)
      canvas.dispatchEvent(new KeyboardEvent('keyup', { key: 'w', code: 'KeyW', ctrlKey: true }))
      return event.defaultPrevented
    })
    expect(flyCtrlW).toBe(true)
    const beforeFly = await debugState(page)
    expect(beforeFly.mode).toBe('fly')
    await canvas.click({ position: { x: 140, y: 220 } })
    await page.keyboard.down('w')
    await page.waitForTimeout(450)
    await page.keyboard.up('w')
    const afterFly = await debugState(page)
    expect(distance(beforeFly.camera.position, afterFly.camera.position)).toBeGreaterThan(5)

    // canvas.blur（点击设置/输入框）而不是 window.blur：W 没有 keyup 也必须停。
    await canvas.click({ position: { x: 180, y: 240 } })
    await page.keyboard.down('w')
    await page.waitForTimeout(300)
    await page.getByRole('button', { name: '显示设置' }).click()
    expect(await page.evaluate(() => window.__srtpModelViewer!.keys?.size ?? -1)).toBe(0)
    await page.waitForTimeout(500)
    const afterCanvasBlur = await debugState(page)
    await page.waitForTimeout(500)
    const stillAfterBlur = await debugState(page)
    expect(distance(afterCanvasBlur.camera.position, stillAfterBlur.camera.position)).toBeLessThan(0.01)
    await page.getByRole('button', { name: '关闭显示设置' }).click()
    await canvas.click({ position: { x: 180, y: 240 } })
    await page.waitForTimeout(600)
    const afterRefocus = await debugState(page)
    expect(distance(afterCanvasBlur.camera.position, afterRefocus.camera.position)).toBeLessThan(0.01)

    // Ctrl 作为减速修饰键；Ctrl+F 仍交给浏览器，不触发复位。
    await page.keyboard.press('f')
    await page.waitForTimeout(150)
    const normalStart = await debugState(page)
    await page.keyboard.down('w')
    await page.waitForTimeout(400)
    await page.keyboard.up('w')
    const normalEnd = await debugState(page)
    const normalDistance = distance(normalStart.camera.position, normalEnd.camera.position)
    expect(normalDistance).toBeGreaterThan(1)
    await page.keyboard.press('f')
    await page.waitForTimeout(150)
    const slowStart = await debugState(page)
    await page.keyboard.down('Control')
    await page.keyboard.down('w')
    await page.waitForTimeout(400)
    await page.keyboard.up('w')
    await page.keyboard.up('Control')
    const slowEnd = await debugState(page)
    const slowDistance = distance(slowStart.camera.position, slowEnd.camera.position)
    expect(slowDistance).toBeGreaterThan(0)
    expect(slowDistance).toBeLessThan(normalDistance * 0.5)
    const beforeCtrlF = await debugState(page)
    await page.keyboard.press('Control+f')
    await page.waitForTimeout(200)
    const afterCtrlF = await debugState(page)
    expect(distance(beforeCtrlF.camera.position, afterCtrlF.camera.position)).toBeLessThan(0.5)
    await page.keyboard.press('Escape')

    // 飞行相对速度真实影响位移，不只是更新显示值。
    await page.getByRole('button', { name: '显示设置' }).click()
    await page.locator('#viewer-fly-speed').fill('0.2')
    await page.getByRole('button', { name: '关闭显示设置' }).click()
    await canvas.click({ position: { x: 170, y: 230 } })
    await page.keyboard.press('f')
    const slowFlyStart = await debugState(page)
    await page.keyboard.down('w')
    await page.waitForTimeout(500)
    await page.keyboard.up('w')
    const slowFlyEnd = await debugState(page)
    const slowFlyDistance = distance(slowFlyStart.camera.position, slowFlyEnd.camera.position)
    await page.getByRole('button', { name: '显示设置' }).click()
    await page.locator('#viewer-fly-speed').fill('1.8')
    await page.getByRole('button', { name: '关闭显示设置' }).click()
    await canvas.click({ position: { x: 170, y: 230 } })
    await page.keyboard.press('f')
    const fastFlyStart = await debugState(page)
    await page.keyboard.down('w')
    await page.waitForTimeout(500)
    await page.keyboard.up('w')
    const fastFlyEnd = await debugState(page)
    const fastFlyDistance = distance(fastFlyStart.camera.position, fastFlyEnd.camera.position)
    expect(slowFlyDistance).toBeGreaterThan(0.2)
    expect(fastFlyDistance).toBeGreaterThan(slowFlyDistance * 3)

    await page.keyboard.press('f')
    await page.waitForTimeout(120)
    const afterReset = await debugState(page)
    expect(distance(resetBaseline.camera.position, afterReset.camera.position)).toBeLessThan(0.5)

    // 浏览器 Fullscreen 是独立入口；同一 canvas 随根容器变大。
    const beforeFullscreen = await debugState(page)
    await page.getByRole('button', { name: '全屏查看' }).click()
    await expect.poll(() => page.evaluate(() => document.fullscreenElement !== null)).toBe(true)
    await page.waitForTimeout(1200)
    const fullscreenCanvasWidth = await page.evaluate(() => document.querySelector('canvas')!.width)
    expect(fullscreenCanvasWidth).toBeGreaterThan(beforeFullscreen.stats!.width)
    await page.getByRole('button', { name: '退出全屏' }).click()
    await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true)
    await page.waitForTimeout(300)

    // 宿主元素已全屏时，查看器按钮不得退出宿主。
    await page.evaluate(() => document.documentElement.requestFullscreen())
    await expect
      .poll(() => page.evaluate(() => document.fullscreenElement === document.documentElement))
      .toBe(true)
    await page.getByRole('button', { name: '全屏查看' }).click()
    await page.waitForTimeout(300)
    expect(await page.evaluate(() => document.fullscreenElement === document.documentElement)).toBe(true)
    await page.evaluate(() => document.exitFullscreen())
    await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true)

    // 模态打开前按住 W，打开放大层后按键状态必须被清理。
    await canvas.click({ position: { x: 180, y: 240 } })
    await page.keyboard.down('w')
    await page.getByRole('button', { name: '放大查看' }).click()
    const keysAfterModal = await page.evaluate(() => window.__srtpModelViewer!.keys?.size ?? -1)
    await page.keyboard.up('w')
    expect(keysAfterModal).toBe(0)
    await page.keyboard.press('Escape')

    // 设置面板中的滑块获得焦点时，W 不应驱动相机。
    await page.getByRole('button', { name: '显示设置' }).click()
    const range = page.locator('#viewer-splat-scale')
    await range.focus()
    const beforeSliderKey = await debugState(page)
    await page.keyboard.down('w')
    await page.waitForTimeout(250)
    await page.keyboard.up('w')
    const afterSliderKey = await debugState(page)
    expect(distance(beforeSliderKey.camera.position, afterSliderKey.camera.position)).toBeLessThan(0.01)
    await page.getByRole('button', { name: '关闭显示设置' }).click()

    // Walk 必须先编辑并明确确认；不再使用 window.confirm 直接接受 bbox 建议。
    await page.getByRole('button', { name: '步行模式' }).click()
    await expect(page.getByRole('heading', { name: '进入步行模式' })).toBeVisible()
    // 进入前保持当前 Fly；不会因为打开面板就切到 Walk。
    expect((await debugState(page)).mode).toBe('fly')
    await page.locator('#viewer-walk-ground').fill('1.5')
    await page.locator('#viewer-walk-eye').fill('2.5')
    await page.locator('#viewer-walk-start-x').fill('3')
    await page.locator('#viewer-walk-start-y').fill('4')
    await expect(page.getByText('没有可信有限步行区域：点击传送已禁用，只能地面行走。')).toBeVisible()
    await page.getByText('我确认仅地面高度约束，不是真实碰撞，也不防穿墙').click()
    await page.getByRole('button', { name: '确认进入步行' }).click()
    await page.waitForTimeout(200)
    const walk = await debugState(page)
    expect(walk.mode).toBe('walk')
    expect(walk.walk.ground).toBe(1.5)
    expect(walk.walk.eyeHeight).toBe(2.5)
    expect(walk.walk.start).toEqual([3, 4])
    expect(walk.camera.position[2]).toBeCloseTo(4, 1)
    expect(walk.walk.areaTrusted).toBe(false)
    await page.getByRole('button', { name: '关闭显示设置' }).click()
    const beforeWalkClick = await debugState(page)
    await canvas.click({ position: { x: 160, y: 260 } })
    await page.waitForTimeout(200)
    expect(distance(beforeWalkClick.camera.position, (await debugState(page)).camera.position)).toBeLessThan(0.01)

    // 方向改变：回 Orbit，作废旧 Walk 地面/区域确认；光照滑块值保留。
    await page.getByRole('button', { name: '显示设置' }).click()
    await page.locator('#viewer-light-intensity').fill('1.4')
    await page.locator('#viewer-source-up').selectOption('z')
    await page.waitForTimeout(500)
    const turned = await debugState(page)
    expect(turned.mode).toBe('orbit')
    expect(turned.display.lightIntensity).toBe(1.4)
    expect(turned.walk.areaTrusted).toBe(false)
    expect(turned.walk.start).not.toEqual([3, 4])
    await expect(page.getByRole('heading', { name: '进入步行模式' })).toHaveCount(0)
    await page.getByRole('button', { name: '步行模式' }).click()
    await expect(page.getByRole('heading', { name: '进入步行模式' })).toBeVisible()
    expect((await debugState(page)).mode).toBe('orbit')
    await page.getByRole('button', { name: '取消' }).click()
    await page.getByRole('button', { name: '关闭显示设置' }).click()

    // 触控上下文：显式启用前不改变 touch-action；启用后单指旋转真实改变相机。
    const touchContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      deviceScaleFactor: 2,
    })
    const touchPage = await touchContext.newPage()
    await openReady(touchPage, 'work_demo_001')
    const touchCanvas = touchPage.locator('canvas')
    await expect(touchCanvas).toHaveCSS('touch-action', 'pan-y')
    await expect(touchPage.getByRole('button', { name: '飞行模式' })).toBeDisabled()
    await expect(touchPage.getByRole('button', { name: '步行模式' })).toBeDisabled()
    await touchPage.getByRole('button', { name: '显示设置' }).click()
    await touchPage.locator('#viewer-touch').check()
    await touchPage.getByRole('button', { name: '关闭显示设置' }).click()
    await expect(touchCanvas).toHaveCSS('touch-action', 'none')
    await touchPage.evaluate(() => window.__srtpModelViewer!.setAutoRotate(false))
    const touchBefore = await debugState(touchPage)
    const touchBox = await touchCanvas.boundingBox()
    await touchPage.evaluate(
      ({ x, y }) => {
        const canvas = document.querySelector('canvas')!
        const emit = (type: string, clientX: number, clientY: number) => {
          canvas.dispatchEvent(
            new PointerEvent(type, {
              bubbles: true,
              pointerId: 7,
              pointerType: 'touch',
              clientX,
              clientY,
              button: 0,
              buttons: type === 'pointerup' ? 0 : 1,
            }),
          )
        }
        emit('pointerdown', x, y)
        emit('pointermove', x + 90, y + 20)
        emit('pointerup', x + 90, y + 20)
      },
      { x: touchBox!.x + touchBox!.width / 2, y: touchBox!.y + touchBox!.height / 2 },
    )
    await touchPage.waitForTimeout(200)
    const touchAfter = await debugState(touchPage)
    expect(distance(touchBefore.camera.position, touchAfter.camera.position)).toBeGreaterThan(5)
    const beforePinch = await debugState(touchPage)
    await touchPage.evaluate(
      ({ x, y }) => {
        const canvas = document.querySelector('canvas')!
        const emit = (type: string, id: number, clientX: number, clientY: number) => {
          canvas.dispatchEvent(
            new PointerEvent(type, {
              bubbles: true,
              pointerId: id,
              pointerType: 'touch',
              clientX,
              clientY,
              button: 0,
              buttons: type === 'pointerup' ? 0 : 1,
            }),
          )
        }
        emit('pointerdown', 11, x - 40, y)
        emit('pointerdown', 12, x + 40, y)
        emit('pointermove', 11, x - 90, y)
        emit('pointermove', 12, x + 90, y)
        emit('pointerup', 11, x - 90, y)
        emit('pointerup', 12, x + 90, y)
      },
      { x: touchBox!.x + touchBox!.width / 2, y: touchBox!.y + touchBox!.height / 2 },
    )
    await touchPage.waitForTimeout(200)
    const afterPinch = await debugState(touchPage)
    const pinchBefore = distance(beforePinch.camera.position, beforePinch.camera.target)
    const pinchAfter = distance(afterPinch.camera.position, afterPinch.camera.target)
    expect(Math.abs(pinchAfter - pinchBefore)).toBeGreaterThan(1)
    await touchContext.close()
  })

  test('自动旋转按住拖动超过 15 秒仍暂停，松开后满 15 秒才恢复', async ({ page }) => {
    test.setTimeout(60_000)
    await page.setViewportSize({ width: 1440, height: 900 })
    await openReady(page, 'work_demo_001')
    const canvas = page.locator('canvas')
    const box = await canvas.boundingBox()
    expect(box).toBeTruthy()
    const center = { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 }
    const before = await debugState(page)
    expect(before.autoRotate.enabled).toBe(true)
    await page.waitForTimeout(1200)
    const moving = await debugState(page)
    expect(distance(before.camera.position, moving.camera.position)).toBeGreaterThan(0.5)

    await page.mouse.move(center.x, center.y)
    await page.mouse.down({ button: 'left' })
    const holdStart = await debugState(page)
    await page.waitForTimeout(16_000)
    const holdEnd = await debugState(page)
    expect(distance(holdStart.camera.position, holdEnd.camera.position)).toBeLessThan(0.05)
    expect(holdEnd.autoRotate.enabled).toBe(true)

    await page.mouse.up({ button: 'left' })
    const released = await debugState(page)
    await page.waitForTimeout(14_000)
    const beforeResume = await debugState(page)
    expect(distance(released.camera.position, beforeResume.camera.position)).toBeLessThan(0.05)
    await page.waitForTimeout(2200)
    const resumed = await debugState(page)
    expect(distance(beforeResume.camera.position, resumed.camera.position)).toBeGreaterThan(0.2)
  })

  test('显示参数、全屏与 320/390/768/1440 布局不溢出', async ({ page }) => {
    test.setTimeout(120_000)
    await page.setViewportSize({ width: 1440, height: 900 })
    await openReady(page, 'work_demo_001')
    await page.evaluate(() => window.__srtpModelViewer!.setAutoRotate(false))
    await page.waitForTimeout(1200)
    const requestsBefore = await page.evaluate(
      () => performance.getEntriesByType('resource').filter((entry) => entry.name.includes('/__dev/models/')).length,
    )
    const cameraBefore = (await debugState(page)).camera
    const original = await downloadPng(page)
    await page.getByRole('button', { name: '显示设置' }).click()
    await expect(page.locator('#viewer-splat-scale')).toBeDisabled()
    await expect(page.locator('#viewer-soft-light')).toBeEnabled()
    await expect(page.locator('#viewer-light-intensity')).toBeEnabled()
    await expect(page.locator('#viewer-emission')).toBeDisabled()
    await expect(page.locator('#viewer-emission-intensity')).toBeDisabled()
    await expect(page.locator('#viewer-fly-speed')).toBeEnabled()
    await expect(page.locator('#viewer-walk-speed')).toBeEnabled()
    await page.locator('#viewer-light-intensity').fill('1.4')
    await page.locator('#viewer-fly-speed').fill('1.2')
    expect((await debugState(page)).display.lightIntensity).toBe(1.4)
    expect((await debugState(page)).speed.fly).toBe(1.2)
    await page.getByRole('button', { name: '统一色调' }).click()
    const requestsDuring = await page.evaluate(
      () => performance.getEntriesByType('resource').filter((entry) => entry.name.includes('/__dev/models/')).length,
    )
    expect(requestsDuring).toBe(requestsBefore)
    await page.getByRole('button', { name: '关闭显示设置' }).click()
    await page.waitForTimeout(500)
    const toned = await downloadPng(page)
    const toneDiff = await page.evaluate(
      async ({ a, b }) => {
        const load = async (base64: string) => {
          const image = new Image()
          image.src = `data:image/png;base64,${base64}`
          await image.decode()
          const canvas = document.createElement('canvas')
          canvas.width = image.width
          canvas.height = image.height
          const context = canvas.getContext('2d')!
          context.drawImage(image, 0, 0)
          return context.getImageData(0, 0, image.width, image.height).data
        }
        const left = await load(a)
        const right = await load(b)
        let changed = 0
        for (let index = 0; index < left.length; index += 4) {
          const delta =
            Math.abs(left[index]! - right[index]!) +
            Math.abs(left[index + 1]! - right[index + 1]!) +
            Math.abs(left[index + 2]! - right[index + 2]!)
          if (delta > 12) changed += 1
        }
        return changed
      },
      { a: original.toString('base64'), b: toned.toString('base64') },
    )
    expect(toneDiff).toBeGreaterThan(100)
    await page.getByRole('button', { name: '显示设置' }).click()
    const cameraAfter = (await debugState(page)).camera
    expect(cameraAfter.position).toEqual(cameraBefore.position)
    expect(cameraAfter.target).toEqual(cameraBefore.target)
    await page.getByRole('button', { name: '恢复显示默认' }).click()
    await page.locator('#viewer-light-intensity').fill('1.4')
    expect((await debugState(page)).display.lightIntensity).toBe(1.4)
    const beforeDirection = await debugState(page)
    const beforeDirectionSize = [...beforeDirection.info!.bounds.size]
    await page.locator('#viewer-source-up').selectOption('z')
    await page.waitForTimeout(400)
    const zUp = await debugState(page)
    expect(zUp.sourceUpOverride).toBe('z')
    expect(zUp.info?.sourceUp).toBe('z')
    expect(zUp.info!.bounds.size).not.toEqual(beforeDirectionSize)
    expect(distance(beforeDirection.camera.position, zUp.camera.position)).toBeGreaterThan(1)
    const requestsAfterDirection = await page.evaluate(
      () => performance.getEntriesByType('resource').filter((entry) => entry.name.includes('/__dev/models/')).length,
    )
    expect(requestsAfterDirection).toBe(requestsBefore)
    await page.locator('#viewer-source-up').selectOption('auto')
    await page.waitForTimeout(400)
    const autoUp = await debugState(page)
    const autoUpSize = [...autoUp.info!.bounds.size]
    expect(autoUp.sourceUpOverride).toBeNull()
    expect(autoUp.info?.sourceUp).toBe('y')
    await page.getByRole('button', { name: 'X +90°' }).click()
    await page.waitForTimeout(200)
    const oneX = await debugState(page)
    await page.getByRole('button', { name: 'X +90°' }).click()
    await page.waitForTimeout(300)
    const twoX = await debugState(page)
    expect(oneX.info!.bounds.size).not.toEqual(autoUpSize)
    expect(twoX.orientation).toEqual({ x: 2, y: 0, z: 0 })
    // 180° 前后 AABB 尺寸相同是轴对称的正常结果；用计数和重置验证纠正链。
    expect(twoX.info!.bounds.size).toEqual(autoUpSize)
    await page.getByRole('button', { name: '重置方向' }).click()
    await page.waitForTimeout(300)
    const restored = await debugState(page)
    expect(restored.orientation).toEqual({ x: 0, y: 0, z: 0 })
    expect(restored.info!.bounds.size).toEqual(autoUpSize)
    await page.getByRole('button', { name: '关闭显示设置' }).click()

    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      await page.waitForTimeout(500)
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      )
      expect(overflow).toBeLessThanOrEqual(1)
      await expect(page.getByRole('button', { name: '保存 PNG 截图' })).toBeVisible()
      await expect(page.getByRole('button', { name: '全屏查看' })).toBeVisible()
      await page.getByRole('button', { name: '显示设置' }).click()
      const boxes = await page.evaluate(() => {
        const canvas = document.querySelector('canvas')!.getBoundingClientRect()
        const panel = document.querySelector('aside[aria-label="显示设置"]')!.getBoundingClientRect()
        return { canvas: canvas.toJSON(), panel: panel.toJSON(), viewport: window.innerWidth }
      })
      expect(boxes.panel.width).toBeGreaterThan(200)
      expect(boxes.panel.right).toBeLessThanOrEqual(boxes.viewport + 1)
      // 普通详情容器约 775px：设置必须在画布下方，不能盖住主模型。
      expect(boxes.panel.top).toBeGreaterThanOrEqual(boxes.canvas.top + boxes.canvas.height - 1)
      if (width <= 390) {
        await page.getByRole('button', { name: '步行模式' }).click()
        await expect(page.getByRole('heading', { name: '进入步行模式' })).toBeVisible()
        const walkOverflow = await page.evaluate(() => {
          const panel = document.querySelector('aside[aria-label="显示设置"]') as HTMLElement
          const setup = document.querySelector('section[aria-label="步行设置"]') as HTMLElement
          return {
            panel: panel.scrollWidth - panel.clientWidth,
            setup: setup.scrollWidth - setup.clientWidth,
          }
        })
        expect(walkOverflow.panel).toBeLessThanOrEqual(1)
        expect(walkOverflow.setup).toBeLessThanOrEqual(1)
        await page.getByRole('button', { name: '取消' }).click()
      }
      await page.getByRole('button', { name: '关闭显示设置' }).click()
    }

    // 真正宽的放大容器才把设置放到画布右侧。
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.getByRole('button', { name: '放大查看' }).click()
    await expect(page.locator('section[role="dialog"]')).toBeVisible()
    await page.waitForTimeout(800)
    await page.getByRole('button', { name: '显示设置' }).click()
    await page.waitForTimeout(200)
    const wideBoxes = await page.evaluate(() => {
      const canvas = document.querySelector('section[role="dialog"] canvas')!.getBoundingClientRect()
      const panel = document.querySelector('section[role="dialog"] aside[aria-label="显示设置"]')!.getBoundingClientRect()
      return { canvas: canvas.toJSON(), panel: panel.toJSON() }
    })
    expect(wideBoxes.panel.left).toBeGreaterThan(wideBoxes.canvas.left + wideBoxes.canvas.width * 0.4)
    expect(wideBoxes.panel.width).toBeGreaterThan(280)
    await page.getByRole('button', { name: '关闭显示设置' }).click()
    await page.keyboard.press('Escape')
  })

  test('显式 Walk 配置在方向纠正后统一作废，重新确认的起点不被旧区域夹取', async ({ page }) => {
    test.setTimeout(60_000)
    await page.goto('/works')
    const result = await page.evaluate(async () => {
      // @ts-expect-error DEV-only module URL, resolved by Vite at runtime.
      const { ModelViewer } = await import('/src/viewer/ModelViewer.ts')
      const source = {
        kind: 'url' as const,
        url: '/__dev/models/asset_demo_001_model/ancient_chinese_courtyard_park.glb?v=walk-constraint',
        version: 'walk-constraint',
        name: 'walk-constraint',
      }
      const config = {
        ground: { height: 100 },
        eyeHeight: 2,
        walkStart: [0, 0] as [number, number],
        walkArea: { minX: -1, maxX: 1, minY: -1, maxY: 1 },
        walkAreaTrusted: true,
      }
      const create = () => {
        const host = document.createElement('div')
        host.style.cssText = 'position:fixed;left:0;top:0;width:800px;height:600px;z-index:9999'
        const canvas = document.createElement('canvas')
        canvas.style.cssText = 'width:800px;height:600px;display:block'
        host.appendChild(canvas)
        document.body.appendChild(host)
        const viewer = new ModelViewer(canvas, host, { autoRotate: false })
        return { viewer, host }
      }

      const first = create()
      await first.viewer.load(source, config)
      const before = first.viewer.getWalkDefaults()
      first.viewer.rotateOrientation('x')
      const afterDirection = first.viewer.getWalkDefaults()
      const debugAfterDirection = first.viewer.getDebugState().walk as {
        ground: number
        start: [number, number]
        areaTrusted: boolean
      }
      first.viewer.configureWalk({ ground: 5, eyeHeight: 3, start: [10, 20] })
      first.viewer.setMode('walk')
      const reconfigured = first.viewer.getDebugState()
      first.viewer.dispose()
      first.host.remove()

      const second = create()
      await second.viewer.load(source, config)
      second.viewer.configureWalk({ ground: 5, eyeHeight: 3, start: [10, 20] })
      second.viewer.setMode('walk')
      const constrained = second.viewer.getDebugState()
      second.viewer.dispose()
      second.host.remove()

      return {
        before,
        afterDirection,
        debugAfterDirection: {
          ground: debugAfterDirection.ground,
          start: debugAfterDirection.start,
          areaTrusted: debugAfterDirection.areaTrusted,
        },
        reconfigured: {
          areaTrusted: reconfigured.walk.areaTrusted as boolean,
          camera: reconfigured.camera.position as number[],
        },
        constrained: {
          areaTrusted: constrained.walk.areaTrusted as boolean,
          camera: constrained.camera.position as number[],
        },
      }
    })
    expect(result.before.ground).toBe(100)
    expect(result.before.areaTrusted).toBe(true)
    expect(result.afterDirection.areaTrusted).toBe(false)
    expect(result.afterDirection.area).toBeNull()
    expect(result.afterDirection.ground).not.toBe(100)
    expect(result.afterDirection.start).not.toEqual([0, 0])
    expect(result.debugAfterDirection.areaTrusted).toBe(false)
    expect(result.debugAfterDirection.ground).toBe(result.afterDirection.ground)
    expect(result.debugAfterDirection.start).toEqual(result.afterDirection.start)
    expect(result.reconfigured.areaTrusted).toBe(false)
    expect(result.reconfigured.camera[0]).toBeCloseTo(10, 4)
    expect(result.reconfigured.camera[1]).toBeCloseTo(20, 4)
    expect(result.reconfigured.camera[2]).toBeCloseTo(8, 4)
    expect(result.constrained.areaTrusted).toBe(true)
    expect(result.constrained.camera[0]).toBeCloseTo(1, 4)
    expect(result.constrained.camera[1]).toBeCloseTo(1, 4)
    expect(result.constrained.camera[2]).toBeCloseTo(8, 4)
  })

  test('WebGL2 不可用时明确报错，不请求模型、不假装成功', async ({ page }) => {
    test.setTimeout(60_000)
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext
      HTMLCanvasElement.prototype.getContext = function (
        this: HTMLCanvasElement,
        type: string,
        ...args: unknown[]
      ) {
        if (type === 'webgl2') return null
        return original.call(this, type, ...args)
      } as typeof HTMLCanvasElement.prototype.getContext
    })
    await page.setViewportSize({ width: 1440, height: 900 })
    const requests: string[] = []
    page.on('request', (request) => requests.push(request.url()))
    await page.goto('/works/work_demo_001')
    await page.getByRole('button', { name: '开始预览' }).click()
    await expect(page.locator('[data-viewer-phase="error"]')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('当前浏览器不支持 WebGL2')).toBeVisible()
    await expect(page.getByText('错误代码：WEBGL2_UNAVAILABLE')).toBeVisible()
    await expect(page.getByRole('button', { name: '手动重试' })).toHaveCount(0)
    await expect(page.getByRole('alert').getByRole('button', { name: '结束预览' })).toBeVisible()
    expect(requests.filter((url) => url.includes('/__dev/models/'))).toHaveLength(0)
  })

  test('初始化中上下文丢失会取消任务，迟到解析不能 ready', async ({ page }) => {
    test.setTimeout(60_000)
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/works/work_demo_001')
    await page.getByRole('button', { name: '开始预览' }).click()
    await page.locator('[data-viewer-canvas]').waitFor({ state: 'visible', timeout: 15_000 })
    await page.evaluate(() => {
      document
        .querySelector('canvas')!
        .dispatchEvent(new Event('webglcontextlost', { bubbles: false, cancelable: true }))
    })
    await expect(page.locator('[data-viewer-phase="error"]')).toBeVisible()
    await page.waitForTimeout(3000)
    await expect(page.locator('[data-viewer-phase="error"]')).toBeVisible()
    await expect(page.locator('[data-viewer-ready="true"]')).toHaveCount(0)
    await expect(page.getByText('错误代码：CONTEXT_LOST')).toBeVisible()
  })

  test('WebGL 上下文丢失明确报错，不用旧画面假装继续渲染', async ({ page }) => {
    test.setTimeout(60_000)
    await page.setViewportSize({ width: 1440, height: 900 })
    await openReady(page, 'work_demo_001')
    await page.evaluate(() => {
      const canvas = document.querySelector('canvas')!
      canvas.dispatchEvent(new Event('webglcontextlost', { bubbles: false, cancelable: true }))
    })
    await expect(page.locator('[data-viewer-phase="error"]')).toBeVisible()
    await expect(page.getByText('渲染上下文已丢失')).toBeVisible()
    await expect(page.getByText('错误代码：CONTEXT_LOST')).toBeVisible()
    await expect(page.locator('[data-viewer-ready="true"]')).toHaveCount(0)
    await expect(page.getByRole('button', { name: '手动重试' })).toHaveCount(0)
    await expect(page.getByText(/OOM|内存不足/)).toHaveCount(0)
  })

  test('模拟替换绑定后不再命中旧模型，明确显示开发映射缺失', async ({ page }) => {
    test.setTimeout(90_000)
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/works/work_demo_001')
    await expect(page.getByRole('heading', { name: '院落模型' })).toBeVisible()
    const replacement = await page.evaluate(async () => {
      const json = async (response: Response) => {
        const body = await response.json()
        if (!response.ok) throw new Error(`${response.status} ${JSON.stringify(body)}`)
        return body
      }
      await json(await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'admin' }),
      }))
      await json(await fetch('/api/admin/works/work_demo_001/unpublish', { method: 'POST' }))
      const upload = await json(await fetch('/api/dev/mock/uploads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'model',
          originalName: 'replacement.glb',
          sizeBytes: 1234,
          mimeType: 'model/gltf-binary',
        }),
      }))
      await new Promise((resolve) => setTimeout(resolve, 1600))
      const patched = await json(await fetch('/api/admin/works/work_demo_001', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelAssetId: upload.assetId }),
      }))
      await json(await fetch('/api/admin/works/work_demo_001/publish', { method: 'POST' }))
      return patched
    })
    expect(replacement.modelAssetId).toBeTruthy()
    await page.evaluate(() => {
      history.pushState({}, '', '/admin/works/work_demo_001/preview')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    await expect(page.getByRole('heading', { name: '管理员预览' })).toBeVisible()
    const modelRequests: string[] = []
    page.on('request', (request) => {
      if (request.url().includes('/__dev/models/')) modelRequests.push(request.url())
    })
    await page.getByRole('button', { name: '开始预览' }).click()
    await expect(page.locator('[data-viewer-phase="error"]')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText('模型地址不可用')).toBeVisible()
    await expect(page.locator('[data-viewer-ready="true"]')).toHaveCount(0)
    await expect(page.getByText(/HTTP 404/)).toBeVisible()
    await expect(page.getByText(/开发映射|资源版本/)).toBeVisible()
    expect(modelRequests.some((url) => url.includes(replacement.modelAssetId))).toBe(true)
    expect(modelRequests.some((url) => url.includes('asset_demo_001_model'))).toBe(false)
  })

  test('高斯统一色调与单 splat 尺度真实改变画面，不重新解析模型', async ({ page }) => {
    test.setTimeout(90_000)
    await page.setViewportSize({ width: 1440, height: 900 })
    await openReady(page, 'work_demo_003')
    await page.evaluate(() => window.__srtpModelViewer!.setAutoRotate(false))
    await page.waitForTimeout(1200)
    const requestsBefore = await page.evaluate(
      () => performance.getEntriesByType('resource').filter((entry) => entry.name.includes('/__dev/models/')).length,
    )
    const original = await downloadPng(page)
    await page.getByRole('button', { name: '显示设置' }).click()
    await expect(page.locator('#viewer-splat-scale')).toBeEnabled()
    await expect(page.locator('#viewer-soft-light')).toBeDisabled()
    await expect(page.locator('#viewer-light-intensity')).toBeDisabled()
    await expect(page.locator('#viewer-emission')).toBeDisabled()
    await expect(page.locator('#viewer-emission-intensity')).toBeDisabled()
    expect((await debugState(page)).info?.sourceUp).toBe('z')
    expect((await debugState(page)).sourceUpOverride).toBeNull()
    await page.getByRole('button', { name: '统一色调' }).click()
    await page.getByRole('button', { name: '关闭显示设置' }).click()
    await page.waitForTimeout(500)
    const toned = await downloadPng(page)
    await page.getByRole('button', { name: '显示设置' }).click()
    await page.locator('#viewer-splat-scale').fill('2.5')
    const requestsAfter = await page.evaluate(
      () => performance.getEntriesByType('resource').filter((entry) => entry.name.includes('/__dev/models/')).length,
    )
    expect(requestsAfter).toBe(requestsBefore)
    await page.getByRole('button', { name: '关闭显示设置' }).click()
    await page.waitForTimeout(500)
    const scaled = await downloadPng(page)
    const screenDiff = async (a: Buffer, b: Buffer) =>
      page.evaluate(
        async ({ leftBase64, rightBase64 }) => {
          const load = async (base64: string) => {
            const image = new Image()
            image.src = `data:image/png;base64,${base64}`
            await image.decode()
            const canvas = document.createElement('canvas')
            canvas.width = image.width
            canvas.height = image.height
            const context = canvas.getContext('2d')!
            context.drawImage(image, 0, 0)
            return context.getImageData(0, 0, image.width, image.height).data
          }
          const left = await load(leftBase64)
          const right = await load(rightBase64)
          let changed = 0
          for (let index = 0; index < left.length; index += 4) {
            const delta =
              Math.abs(left[index]! - right[index]!) +
              Math.abs(left[index + 1]! - right[index + 1]!) +
              Math.abs(left[index + 2]! - right[index + 2]!)
            if (delta > 12) changed += 1
          }
          return changed
        },
        { leftBase64: a.toString('base64'), rightBase64: b.toString('base64') },
      )
    expect(await screenDiff(original, toned)).toBeGreaterThan(1000)
    expect(await screenDiff(toned, scaled)).toBeGreaterThan(1000)
    const display = await debugState(page)
    expect(display.display.splatScale).toBe(2.5)
  })

  test('DEV 测试页本地文件即选即载，不上传、不请求外部模型', async ({ page }, testInfo) => {
    test.setTimeout(120_000)
    await page.setViewportSize({ width: 1440, height: 900 })
    const requests: string[] = []
    page.on('request', (request) => requests.push(request.url()))
    await page.goto('/dev/model-viewer')
    await expect(page.getByRole('heading', { name: '客户端模型查看器测试台' })).toBeVisible()
    const renamedGlb = testInfo.outputPath('courtyard-renamed.ply')
    const renamedPly = testInfo.outputPath('hill-renamed.glb')
    fs.rmSync(renamedGlb, { force: true })
    fs.rmSync(renamedPly, { force: true })
    fs.symlinkSync('/Users/exynos/Projects/srtp网页/ancient_chinese_courtyard_park.glb', renamedGlb)
    fs.symlinkSync('/Users/exynos/Projects/srtp网页/丘陵.ply', renamedPly)
    await page
      .locator('input[aria-label="选择本地模型文件"]')
      .setInputFiles(renamedGlb)
    await page.waitForFunction(() => window.__srtpModelViewer?.getPhase?.() === 'ready', undefined, {
      timeout: 120_000,
    })
    let state = await debugState(page)
    expect(state.info?.format).toBe('glb')
    expect(state.info?.sourceUp).toBe('y')
    expect(state.stats?.dpr).toBeLessThanOrEqual(1.5)

    // 替换前处于 Walk 且按住 W；load 必须清键并回到 Orbit，不能继承旧模式/移动。
    await page.getByRole('button', { name: '显示设置' }).click()
    await page.getByRole('button', { name: '步行模式' }).click()
    await page.locator('#viewer-walk-ground').fill('0')
    await page.locator('#viewer-walk-eye').fill('2')
    await page.getByText('我确认仅地面高度约束，不是真实碰撞，也不防穿墙').click()
    await page.getByRole('button', { name: '确认进入步行' }).click()
    await expect.poll(() => page.evaluate(() => window.__srtpModelViewer!.getDebugState().mode)).toBe('walk')
    await page.locator('canvas').click({ position: { x: 100, y: 220 } })
    await page.keyboard.down('w')
    await page.waitForTimeout(200)
    expect(await page.evaluate(() => window.__srtpModelViewer!.keys?.size ?? -1)).toBe(1)
    await page
      .locator('input[aria-label="选择本地模型文件"]')
      .setInputFiles(renamedPly)
    await page.waitForFunction(
      () =>
        window.__srtpModelViewer?.getPhase?.() === 'ready' &&
        window.__srtpModelViewer.getDebugState().info?.format === 'gaussian-ply',
      undefined,
      { timeout: 120_000 },
    )
    state = await debugState(page)
    expect(state.info?.splats).toBe(1_067_912)
    expect(state.info?.sourceUp).toBe('z')
    expect(state.mode).toBe('orbit')
    expect(await page.evaluate(() => window.__srtpModelViewer!.keys?.size ?? -1)).toBe(0)
    await page.keyboard.up('w')
    await page.getByLabel('DPR 上限').selectOption('1')
    await page.waitForFunction(
      () =>
        window.__srtpModelViewer?.getPhase?.() === 'ready' &&
        window.__srtpModelViewer.getDebugState().stats?.dpr === 1,
      undefined,
      { timeout: 120_000 },
    )
    expect((await debugState(page)).stats?.dpr).toBe(1)

    await page.getByRole('button', { name: '录制 35 秒' }).click()
    await page.waitForTimeout(1500)
    const downloadPromise = page.waitForEvent('download', { timeout: 1500 }).catch(() => null)
    await page.locator('input[aria-label="选择本地模型文件"]').setInputFiles(
      '/Users/exynos/Projects/srtp网页/ancient_chinese_courtyard_park.glb',
    )
    await page.waitForFunction(
      () =>
        window.__srtpModelViewer?.getPhase?.() === 'ready' &&
        window.__srtpModelViewer.getDebugState().info?.format === 'glb',
      undefined,
      { timeout: 120_000 },
    )
    await expect(downloadPromise).resolves.toBeNull()
    const replacedRecording = await page.evaluate(() => {
      const result = window.__srtpModelViewer!.getLastRecording()
      return result
        ? { reason: result.reason, complete: result.complete, wallClockMs: result.wallClockMs, size: result.blob.size }
        : null
    })
    expect(replacedRecording?.reason).toBe('replace')
    expect(replacedRecording?.complete).toBe(false)
    expect(replacedRecording!.wallClockMs).toBeLessThan(10_000)
    expect(replacedRecording!.size).toBeGreaterThan(1000)

    expect(requests.filter((url) => new URL(url).pathname.startsWith('/api/'))).toHaveLength(0)
    expect(requests.filter((url) => url.includes('/__dev/models/'))).toHaveLength(0)
    expect(requests.filter((url) => /^https?:\/\/(?!127\.0\.0\.1)/.test(url))).toHaveLength(0)
  })
})
