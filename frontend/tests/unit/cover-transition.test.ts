import { describe, expect, it } from 'vitest'
import { canUseCoverSource } from '../../src/lib/coverFlip'
import type { CoverSource } from '../../src/lib/worksNavigation'

const source = (width: number, height: number): CoverSource => ({
  workId: 'work_demo_001',
  coverUrl: '/mock/courtyard-cover.png',
  at: Date.now(),
  rect: { left: 24, top: 200, width, height },
})

describe('城市封面到宽幅展台的连续交接', () => {
  it('方形气泡缩略图可交接到 16:9 详情观看框', () => {
    expect(canUseCoverSource(source(80, 80), new DOMRect(32, 300, 960, 540))).toBe(true)
  })

  it('极端长宽比或屏幕外来源不创建共享代理', () => {
    expect(canUseCoverSource(source(20, 300), new DOMRect(32, 300, 960, 540))).toBe(false)
    const offscreen = source(80, 80)
    offscreen.rect.left = window.innerWidth + 20
    expect(canUseCoverSource(offscreen, new DOMRect(32, 300, 960, 540))).toBe(false)
  })
})
