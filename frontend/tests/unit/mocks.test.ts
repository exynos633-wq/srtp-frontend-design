import { HttpResponse, http } from 'msw'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { getAdminWork, listAdminWorks, publishAdminWork, unpublishAdminWork, updateAdminWork } from '../../src/api/adminWorks'
import { login } from '../../src/api/auth'
import { listCityWorks, listGlobeCities } from '../../src/api/globe'
import { ApiError } from '../../src/api/http'
import { getPublicWork, listPublicWorks } from '../../src/api/works'
import { createQueryClient } from '../../src/app/queryClient'
import { shouldEnableMocks } from '../../src/mocks/enable'
import { server } from '../../src/mocks/node'
import { resetMockState, setMockScenario } from '../../src/mocks/scenario'
import { sortByPublishedDesc } from '../../src/mocks/selectors'

/**
 * Mock 传输层的行为测试。显式断言契约语义：
 * 发布过滤、排序、城市聚合、404／401／422／409，以及 Mock 关闭时不回退假数据。
 */

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => {
  server.resetHandlers()
  resetMockState()
})
afterAll(() => server.close())

async function expectApiError(promise: Promise<unknown>, status: number, code?: string): Promise<ApiError> {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError)
    const apiError = error as ApiError
    expect(apiError.status).toBe(status)
    if (code !== undefined) expect(apiError.code).toBe(code)
    return apiError
  }
  throw new Error(`期望请求失败（${status}），但请求成功了`)
}

describe('Mock 数据派生', () => {
  it('公开目录 10 件，发布时间降序，id 不重复', async () => {
    const { items } = await listPublicWorks()
    expect(items).toHaveLength(10)
    expect(new Set(items.map((item) => item.id)).size).toBe(10)
    expect(items[0]?.name).toBe('院落模型')
    expect(items.at(-1)?.name).toBe('模型占位 10')
    expect(items.every((item) => item.modelFormat === 'glb' || item.modelFormat === 'gaussian-ply')).toBe(true)
  })

  it('同一发布时间按 id 稳定升序', () => {
    const sorted = sortByPublishedDesc([
      { id: 'b', publishedAt: '2026-10-01T10:00:00+08:00' },
      { id: 'a', publishedAt: '2026-10-01T10:00:00+08:00' },
      { id: 'c', publishedAt: '2026-10-02T10:00:00+08:00' },
    ])
    expect(sorted.map((item) => item.id)).toEqual(['c', 'a', 'b'])
  })

  it('草稿与下架不进入公开端，但后台可见', async () => {
    await expectApiError(getPublicWork('work_draft_001'), 404, 'WORK_NOT_FOUND')
    await expectApiError(getPublicWork('work_offline_001'), 404, 'WORK_NOT_FOUND')
    const { items: publicItems } = await listPublicWorks()
    expect(publicItems.some((item) => item.id === 'work_offline_001')).toBe(false)

    await login({ username: 'admin', password: 'admin' })
    const { items: adminItems } = await listAdminWorks()
    expect(adminItems.some((item) => item.id === 'work_draft_001' && item.status === 'draft')).toBe(true)
    expect(adminItems.some((item) => item.id === 'work_offline_001' && item.status === 'offline')).toBe(true)
  })

  it('无城市作品留在目录，但不创建地球点位', async () => {
    const { items: works } = await listPublicWorks()
    const noCity = works.filter((item) => item.city === null)
    expect(noCity.length).toBeGreaterThan(0)

    const { items: cities } = await listGlobeCities()
    expect(cities.every((city) => city.workCount > 0)).toBe(true)
    expect(cities.some((city) => city.name === '广州市')).toBe(false)
  })

  it('同城多件聚合为一个点位并计数，中心缺失的城市不出现', async () => {
    const { items: cities } = await listGlobeCities()
    const byName = new Map(cities.map((city) => [city.name, city]))
    expect(byName.get('北京市')?.workCount).toBe(3)
    expect(byName.get('上海市')?.workCount).toBe(2)
    expect(byName.get('杭州市')?.workCount).toBe(1)
    expect(byName.get('深圳市')?.workCount).toBe(1)
    expect(byName.has('广州市')).toBe(false)
  })

  it('城市气泡返回该城已发布模型；未知城市 404', async () => {
    const response = await listCityWorks('110100')
    expect(response.items).toHaveLength(3)
    await expectApiError(listCityWorks('999999'), 404, 'CITY_NOT_FOUND')
  })
})

describe('场景与错误语义', () => {
  it('empty 场景：公开列表与地球城市为空', async () => {
    setMockScenario('empty')
    expect((await listPublicWorks()).items).toEqual([])
    expect((await listGlobeCities()).items).toEqual([])
  })

  it('list-failure 场景：返回 500，而不是伪装成空列表', async () => {
    setMockScenario('list-failure')
    await expectApiError(listPublicWorks(), 500, 'INTERNAL_ERROR')
  })

  it('未登录访问管理接口返回 401', async () => {
    await expectApiError(listAdminWorks(), 401, 'UNAUTHENTICATED')
  })

  it('错误口令 401，正确口令后可读管理列表', async () => {
    await expectApiError(login({ username: 'admin', password: 'wrong' }), 401, 'INVALID_CREDENTIALS')
    await login({ username: 'admin', password: 'admin' })
    const { items } = await listAdminWorks()
    expect(items.length).toBeGreaterThan(10)
  })

  it('auth-expired 场景：即使刚登录，管理接口仍返回 401', async () => {
    await login({ username: 'admin', password: 'admin' })
    setMockScenario('auth-expired')
    await expectApiError(listAdminWorks(), 401, 'UNAUTHENTICATED')
  })
})

describe('写入语义（cityId 省略／null、发布与资源占用）', () => {
  it('cityId 省略不修改，显式 null 清空', async () => {
    await login({ username: 'admin', password: 'admin' })
    const before = await getAdminWork('work_demo_001')
    expect(before.city?.name).toBe('北京市')

    const renamed = await updateAdminWork('work_demo_001', { name: '院落模型（改名）' })
    expect(renamed.city?.name).toBe('北京市')

    const cleared = await updateAdminWork('work_demo_001', { cityId: null })
    expect(cleared.cityId).toBeNull()
    expect(cleared.city).toBeNull()
  })

  it('无效 cityId 返回 422 与 fields.cityId', async () => {
    await login({ username: 'admin', password: 'admin' })
    const error = await expectApiError(updateAdminWork('work_demo_001', { cityId: 'not-a-city' }), 422, 'VALIDATION_FAILED')
    expect(error.fields).toMatchObject({ cityId: expect.any(String) })
  })

  it('缺必填资源时发布返回 422 与字段错误', async () => {
    await login({ username: 'admin', password: 'admin' })
    const error = await expectApiError(publishAdminWork('work_draft_002'), 422, 'VALIDATION_FAILED')
    expect(error.fields).toMatchObject({
      coverAssetId: expect.any(String),
      modelAssetId: expect.any(String),
    })
  })

  it('补全资源与文字后可发布，并写入发布时间', async () => {
    await login({ username: 'admin', password: 'admin' })
    await updateAdminWork('work_draft_002', {
      description: '补全后的建筑介绍。',
      modelAssetId: 'asset_mock_model',
      coverAssetId: 'asset_mock_cover',
    })
    const published = await publishAdminWork('work_draft_002')
    expect(published.status).toBe('published')
    expect(published.publishedAt).not.toBeNull()

    const { items } = await listPublicWorks()
    expect(items.some((item) => item.id === 'work_draft_002')).toBe(true)
  })

  it('资源占用场景：替换模型返回 409', async () => {
    await login({ username: 'admin', password: 'admin' })
    setMockScenario('model-in-use')
    await expectApiError(updateAdminWork('work_demo_001', { modelAssetId: 'asset_new' }), 409, 'MODEL_IN_USE')
  })

  it('下架后公开端立即读不到', async () => {
    await login({ username: 'admin', password: 'admin' })
    await unpublishAdminWork('work_demo_001')
    await expectApiError(getPublicWork('work_demo_001'), 404, 'WORK_NOT_FOUND')
  })
})

describe('Mock 边界', () => {
  it('关闭 Mock 时请求失败抛 ApiError，不回退假数据', async () => {
    server.use(http.get(/\/api\/works$/, () => HttpResponse.error()))
    const error = await expectApiError(listPublicWorks(), 0, 'NETWORK_ERROR')
    expect(error.message).toContain('无法连接服务器')
  })

  it('只有开发构建且开关为 true 才启用 Mock', () => {
    expect(shouldEnableMocks({ dev: false, flag: true })).toBe(false)
    expect(shouldEnableMocks({ dev: true, flag: false })).toBe(false)
    expect(shouldEnableMocks({ dev: true, flag: true })).toBe(true)
  })

  it('Query 客户端关闭自动重试，写操作不自动重发', () => {
    const client = createQueryClient()
    expect(client.getDefaultOptions().queries?.retry).toBe(false)
    expect(client.getDefaultOptions().mutations?.retry).toBe(false)
  })
})
