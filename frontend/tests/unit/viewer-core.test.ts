import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { AutoRotateClock } from '../../src/viewer/autoRotate'
import { assertFiniteBounds } from '../../src/viewer/viewerMath'
import { SerialTaskQueue, TaskGate } from '../../src/viewer/taskGate'
import {
  cameraYawPitch,
  directionFromYawPitch,
  fitCameraToBounds,
  pickRecordingMime,
  recordingSize,
  resolveDpr,
  sanitizeFilename,
  sourceUpRotation,
} from '../../src/viewer/viewerMath'
import type { BoundsInfo } from '../../src/viewer/types'

const bounds: BoundsInfo = {
  min: [-10, -20, -2],
  max: [30, 20, 8],
  size: [40, 40, 10],
  center: [10, 0, 3],
}

describe('相机适配与坐标', () => {
  it('拒绝 NaN/Infinity 与零尺寸边界', () => {
    expect(() =>
      assertFiniteBounds({ min: [0, 0, 0], max: [1, 1, 1], size: [1, 1, 1], center: [0.5, 0.5, 0.5] }),
    ).not.toThrow()
    expect(() =>
      assertFiniteBounds({
        min: [0, 0, 0],
        max: [Number.NaN, 1, 1],
        size: [Number.NaN, 1, 1],
        center: [0.5, 0.5, 0.5],
      }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_BOUNDS' }))
    expect(() =>
      assertFiniteBounds({ min: [0, 0, 0], max: [0, 0, 0], size: [0, 0, 0], center: [0, 0, 0] }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_BOUNDS' }))
  })

  it('用包围盒和宽高适配完整外部视图，near/far 随尺度', () => {
    const wide = fitCameraToBounds(bounds, 16 / 9)
    const tall = fitCameraToBounds(bounds, 9 / 16)
    expect(wide.target.toArray()).toEqual([10, 0, 3])
    expect(wide.position.distanceTo(wide.target)).toBeGreaterThan(0)
    expect(tall.position.distanceTo(tall.target)).toBeGreaterThan(wide.position.distanceTo(wide.target))
    expect(wide.near).toBeGreaterThan(0)
    expect(wide.far).toBeGreaterThan(wide.near)
    expect(wide.minDistance).toBeLessThan(wide.maxDistance)
  })

  it('GLB 标准 Y-up 绕 X 转 +90°，PLY 默认原样', () => {
    const yUp = new THREE.Vector3(0, 1, 0).applyEuler(sourceUpRotation('y'))
    expect(yUp.x).toBeCloseTo(0)
    expect(yUp.y).toBeCloseTo(0)
    expect(yUp.z).toBeCloseTo(1)
    const p = new THREE.Vector3(0, 1, 0).applyEuler(sourceUpRotation('z'))
    expect(p.toArray()).toEqual([0, 1, 0])
  })

  it('yaw/pitch 与方向向量互逆，俯仰不产生 roll 输入', () => {
    const direction = new THREE.Vector3(0.3, -0.4, 0.2).normalize()
    const { yaw, pitch } = cameraYawPitch(direction)
    const roundTrip = directionFromYawPitch(yaw, pitch)
    expect(roundTrip.x).toBeCloseTo(direction.x, 6)
    expect(roundTrip.y).toBeCloseTo(direction.y, 6)
    expect(roundTrip.z).toBeCloseTo(direction.z, 6)
  })
})

describe('录制尺寸、DPR 与文件名', () => {
  it('录制最长边不超过 1280，保持起始宽高比并取偶数', () => {
    const size = recordingSize(2560, 1440)
    expect(Math.max(size.width, size.height)).toBeLessThanOrEqual(1280)
    expect(size.width % 2).toBe(0)
    expect(size.height % 2).toBe(0)
    expect(size.width / size.height).toBeCloseTo(2560 / 1440, 1)
  })

  it('小画布不放大，宽高保持可用', () => {
    const size = recordingSize(640, 400)
    expect(size).toEqual({ width: 640, height: 400 })
  })

  it('DPR 上限与低档 1', () => {
    vi.stubGlobal('window', { ...window, devicePixelRatio: 2 })
    expect(resolveDpr(1.5, false)).toBe(1.5)
    expect(resolveDpr(2, true)).toBe(1)
    expect(resolveDpr(1, false)).toBe(1)
  })

  it('文件名去除路径分隔符与控制字符', () => {
    expect(sanitizeFilename('a/b\\c:d*e?f"g<h>i|j')).toBe('a-b-c-d-e-f-g-h-i-j')
    expect(sanitizeFilename('院落 模型')).toBe('院落-模型')
    expect(sanitizeFilename('')).toBe('model')
  })

  it('没有 MediaRecorder 时不伪造 MIME', () => {
    vi.stubGlobal('MediaRecorder', undefined)
    expect(pickRecordingMime()).toBeNull()
  })
})

describe('自动旋转时序', () => {
  it('默认关闭时不旋转', () => {
    const clock = new AutoRotateClock({ enabled: false, now: 0 })
    expect(clock.advance(100, 'orbit', true)).toBe(0)
    expect(clock.advance(20_000, 'orbit', true)).toBe(0)
  })

  it('按 dt 转 6°/s，只环绕模式', () => {
    const clock = new AutoRotateClock({ enabled: true, speed: 6, now: 0 })
    clock.start(0)
    expect(clock.advance(100, 'orbit', true)).toBeCloseTo(0.6, 6)
    expect(clock.advance(200, 'orbit', true)).toBeCloseTo(0.6, 6)
    expect(clock.advance(300, 'fly', true)).toBe(0)
    expect(clock.advance(400, 'orbit', false)).toBe(0)
  })

  it('交互后 15 秒恢复，恢复帧不跳', () => {
    const clock = new AutoRotateClock({ enabled: true, speed: 6, now: 0 })
    clock.start(0)
    clock.noteInteraction(1_000)
    expect(clock.advance(1_100, 'orbit', true)).toBe(0)
    expect(clock.advance(16_000, 'orbit', true)).toBe(0)
    expect(clock.advance(16_100, 'orbit', true)).toBeCloseTo(0.6, 6)
    expect(clock.isPaused).toBe(false)
  })

  it('隐藏后恢复先清时间基准，不产生大跳', () => {
    const clock = new AutoRotateClock({ enabled: true, speed: 6, now: 0 })
    clock.start(0)
    expect(clock.advance(60_000, 'orbit', false)).toBe(0)
    clock.start(60_000)
    expect(clock.advance(60_000, 'orbit', true)).toBe(0)
    expect(clock.advance(60_016, 'orbit', true)).toBeCloseTo(0.096, 6)
  })

  it('用户关闭后交互与就绪都不能自启', () => {
    const clock = new AutoRotateClock({ enabled: true, speed: 6, now: 0 })
    clock.start(0)
    clock.setUserEnabled(false, 100)
    expect(clock.advance(100_000, 'orbit', true)).toBe(0)
    clock.start(100_001)
    expect(clock.advance(100_100, 'orbit', true)).toBe(0)
    expect(clock.isUserDisabled).toBe(true)
  })

  it('按住超过 15 秒也不恢复，松开后从松开时刻等待', () => {
    const clock = new AutoRotateClock({ enabled: true, speed: 6, now: 0 })
    clock.start(0)
    clock.beginInteraction(1_000)
    expect(clock.advance(20_000, 'orbit', true)).toBe(0)
    expect(clock.advance(60_000, 'orbit', true)).toBe(0)
    expect(clock.isInteractionActive).toBe(true)
    clock.endInteraction(60_000)
    expect(clock.advance(74_000, 'orbit', true)).toBe(0)
    expect(clock.advance(75_000, 'orbit', true)).toBe(0)
    expect(clock.advance(75_016, 'orbit', true)).toBeCloseTo(0.096, 6)
  })

  it('隐藏时保留尚未完成的交互等待，不立即恢复', () => {
    const clock = new AutoRotateClock({ enabled: true, speed: 6, now: 0 })
    clock.start(0)
    clock.beginInteraction(1_000)
    clock.pause(5_000) // 隐藏/切出 Orbit：保留 lastInteraction=1000
    clock.resume(6_000)
    expect(clock.advance(10_000, 'orbit', true)).toBe(0)
    expect(clock.advance(16_000, 'orbit', true)).toBe(0)
    expect(clock.advance(16_016, 'orbit', true)).toBeCloseTo(0.096, 6)
  })
})

describe('任务代际与串行解析队列', () => {
  it('新任务递增代际，旧代际不再有效', () => {
    const gate = new TaskGate()
    const first = gate.begin()
    expect(gate.isCurrent(first.generation)).toBe(true)
    const second = gate.begin()
    expect(gate.isCurrent(first.generation)).toBe(false)
    expect(gate.isCurrent(second.generation)).toBe(true)
    expect(first.signal.aborted).toBe(true)
    gate.cancel()
    expect(gate.isCurrent(second.generation)).toBe(false)
  })

  it('串行执行；开始前已取消的任务不运行', async () => {
    const queue = new SerialTaskQueue()
    const order: string[] = []
    const controller = new AbortController()
    const first = queue.run(async () => {
      order.push('first-start')
      await Promise.resolve()
      order.push('first-end')
      return 1
    }, controller.signal)
    const second = queue.run(async () => {
      order.push('second')
      return 2
    }, controller.signal)
    await expect(first).resolves.toBe(1)
    await expect(second).resolves.toBe(2)
    expect(order).toEqual(['first-start', 'first-end', 'second'])

    const aborted = new AbortController()
    aborted.abort()
    let ran = false
    await expect(
      queue.run(async () => {
        ran = true
        return 3
      }, aborted.signal),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(ran).toBe(false)
  })
})
