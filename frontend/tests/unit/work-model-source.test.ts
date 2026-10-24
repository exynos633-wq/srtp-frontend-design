import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ active: false, devCalls: 0 }))
const api = vi.hoisted(() => ({ request: vi.fn() }))

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
vi.mock('../../src/api/http', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/api/http')>()
  return { ...actual, apiRequest: api.request }
})

import { ApiError } from '../../src/api/http'
import {
  resolveAdminWorkModelSource,
  resolveWorkModelSource,
} from '../../src/viewer/workModelSource'

const config = {
  workId: 'work_demo_001',
  mode: 'client' as const,
  source: {
    kind: 'url' as const,
    url: '/api/works/work_demo_001/model?v=asset_1',
    version: 'asset_1',
    name: '院落模型',
    format: 'glb' as const,
  },
  view: {
    sourceUp: 'y' as const,
    orientation: { x: 0, y: 0, z: 0 },
    scale: 1,
    initialCamera: null,
    ground: null,
    walkArea: null,
    eyeHeight: null,
  },
}

describe('预览配置来源适配', () => {
  beforeEach(() => {
    state.active = false
    state.devCalls = 0
    api.request.mockReset()
  })

  it('公开端读取作品 preview-config 并返回 URL 来源', async () => {
    api.request.mockResolvedValue(config)
    const source = await resolveWorkModelSource('work_demo_001')
    expect(api.request).toHaveBeenCalledWith('/works/work_demo_001/preview-config', { signal: undefined })
    expect(source).toEqual({
      kind: 'url',
      url: '/api/works/work_demo_001/model?v=asset_1',
      version: 'asset_1',
      name: '院落模型',
    })
  })

  it('管理端读取 admin preview-config，草稿也可用', async () => {
    api.request.mockResolvedValue({
      ...config,
      workId: 'work_draft_001',
      source: {
        ...config.source,
        url: '/api/admin/works/work_draft_001/model?v=asset_2',
        version: 'asset_2',
      },
    })
    const source = await resolveAdminWorkModelSource('work_draft_001')
    expect(api.request).toHaveBeenCalledWith(
      '/admin/works/work_draft_001/preview-config',
      { signal: undefined },
    )
    expect(source?.kind === 'url' ? source.url : '').toContain('/api/admin/works/')
  })

  it('远程模式、缺失 source 或明确的 NO_MODEL 都返回 null', async () => {
    api.request.mockResolvedValueOnce({ ...config, mode: 'remote', source: null })
    api.request.mockResolvedValueOnce({ ...config, source: null })
    api.request.mockRejectedValueOnce(new ApiError('没有模型', { status: 404, code: 'NO_MODEL' }))
    await expect(resolveWorkModelSource('a')).resolves.toBeNull()
    await expect(resolveWorkModelSource('b')).resolves.toBeNull()
    await expect(resolveWorkModelSource('c')).resolves.toBeNull()
  })

  it.each([
    [0, 'NETWORK_ERROR'],
    [500, 'INTERNAL_ERROR'],
    [401, 'UNAUTHORIZED'],
    [403, 'FORBIDDEN'],
    [404, 'NOT_FOUND'],
    [200, 'INVALID_RESPONSE'],
  ])('公开和管理来源保留 %s / %s 错误供调用者处理', async (status, code) => {
    const error = new ApiError('请求失败', { status, code })
    api.request.mockRejectedValue(error)
    await expect(resolveWorkModelSource('a')).rejects.toBe(error)
    await expect(resolveAdminWorkModelSource('a')).rejects.toBe(error)
  })

  it('管理端将取消信号传到请求层，并保留 AbortError', async () => {
    const controller = new AbortController()
    const error = new DOMException('请求取消', 'AbortError')
    api.request.mockRejectedValue(error)
    await expect(resolveAdminWorkModelSource('a', controller.signal)).rejects.toBe(error)
    expect(api.request).toHaveBeenCalledWith('/admin/works/a/preview-config', { signal: controller.signal })
  })

  it('DEV 且 MSW 实际启用时仍使用本地开发适配', async () => {
    state.active = true
    const source = await resolveWorkModelSource('work_demo_001')
    expect(state.devCalls).toBe(1)
    expect(source?.kind === 'url' ? source.url : '').toContain('/__dev/models/')
    expect(api.request).not.toHaveBeenCalled()
  })

  it('DEV 但 Mock 关闭时走正式接口', async () => {
    api.request.mockResolvedValue(config)
    await resolveWorkModelSource('work_demo_001')
    expect(state.devCalls).toBe(0)
    expect(api.request).toHaveBeenCalledTimes(1)
  })

  it('管理端在 DEV+MSW 下也使用开发模型，避免本地预览因 /model 404 失效', async () => {
    state.active = true
    const source = await resolveAdminWorkModelSource('work_demo_001')
    expect(state.devCalls).toBe(1)
    expect(source?.kind === 'url' ? source.url : '').toContain('/__dev/models/')
    expect(api.request).not.toHaveBeenCalled()
  })
})
