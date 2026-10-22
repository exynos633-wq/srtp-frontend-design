import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ active: false, devCalls: 0 }))

vi.mock('../../src/app/mocksStatus', () => ({
  isMocksActive: () => state.active,
}))
vi.mock('../../src/dev/resolveDevModelSource', () => ({
  resolveDevModelSource: () => {
    state.devCalls += 1
    return {
      kind: 'url' as const,
      url: '/__dev/models/seed/model.glb',
      version: 'seed@1',
      name: 'seed',
    }
  },
}))

import { resolveWorkModelSource } from '../../src/viewer/workModelSource'

describe('生产/真实 API 下的作品模型来源适配', () => {
  beforeEach(() => {
    state.active = false
    state.devCalls = 0
  })

  it('DEV 但 Mock 关闭时返回 null，不动态加载 seed 适配', async () => {
    await expect(resolveWorkModelSource('work_demo_001')).resolves.toBeNull()
    expect(state.devCalls).toBe(0)
  })

  it('只有 Mock 开启才读取开发适配', async () => {
    state.active = true
    const source = await resolveWorkModelSource('work_demo_001')
    expect(source?.kind).toBe('url')
    expect(source?.kind === 'url' ? source.url : '').toContain('/__dev/models/')
    expect(state.devCalls).toBe(1)
  })
})
