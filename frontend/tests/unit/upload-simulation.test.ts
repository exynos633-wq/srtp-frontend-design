import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { HttpResponse, http } from 'msw'
import { getAdminWork, updateAdminWork } from '../../src/api/adminWorks'
import { login } from '../../src/api/auth'
import { ApiError } from '../../src/api/http'
import {
  getMockUpload,
  isUploadSimulationEnabled,
  startMockUpload,
  UploadSimulationUnavailableError,
} from '../../src/api/mockUploads'
import { server } from '../../src/mocks/node'
import { resetMockState, setMockScenario } from '../../src/mocks/scenario'
import type { UploadSimulationInput } from '../../src/types/upload'

const mockStatus = vi.hoisted(() => ({ active: true }))

vi.mock('../../src/app/mocksStatus', () => ({
  isMocksActive: () => mockStatus.active,
  markMocksActive: () => {
    mockStatus.active = true
  },
}))

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
beforeEach(() => {
  mockStatus.active = true
})
afterEach(() => {
  server.resetHandlers()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  resetMockState()
})
afterAll(() => server.close())

const modelInput: UploadSimulationInput = {
  kind: 'model',
  originalName: 'demo.glb',
  sizeBytes: 1024,
  mimeType: 'model/gltf-binary',
}

const coverInput: UploadSimulationInput = {
  kind: 'cover',
  originalName: 'cover.png',
  sizeBytes: 512,
  mimeType: 'image/png',
}

async function expectApiError(promise: Promise<unknown>, status: number): Promise<ApiError> {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError)
    const apiError = error as ApiError
    expect(apiError.status).toBe(status)
    return apiError
  }
  throw new Error(`期望请求失败（${status}），但请求成功了`)
}

async function waitForStatus(
  assetId: string,
  status: 'receiving' | 'validating' | 'ready' | 'failed',
) {
  for (let index = 0; index < 60; index += 1) {
    const asset = await getMockUpload(assetId)
    if (asset.status === status) return asset
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`等待模拟资源 ${assetId} 进入 ${status} 超时`)
}

describe('P12 开发上传模拟边界', () => {
  it('生产关闭模拟：即使传入多余 dev 覆盖也不发请求', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    expect(isUploadSimulationEnabled(false, true)).toBe(false)
    expect(isUploadSimulationEnabled(true, false)).toBe(false)
    expect(isUploadSimulationEnabled(true, true)).toBe(true)
    vi.stubEnv('DEV', false)
    const extraOptions = { dev: true } as unknown as { signal?: AbortSignal }
    await expect(
      startMockUpload(modelInput, extraOptions),
    ).rejects.toBeInstanceOf(UploadSimulationUnavailableError)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('开发构建但 MSW 未启用时也不发请求', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    mockStatus.active = false
    await expect(
      startMockUpload(modelInput),
    ).rejects.toBeInstanceOf(UploadSimulationUnavailableError)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('未登录不能使用模拟上传接口', async () => {
    const error = await expectApiError(startMockUpload(modelInput), 401)
    expect(error.code).toBe('UNAUTHENTICATED')
  })

  it('模拟网络失败只返回错误，不伪造 ready', async () => {
    await login({ username: 'admin', password: 'admin' })
    server.use(http.post(/\/api\/dev\/mock\/uploads$/, () => HttpResponse.error()))
    const error = await expectApiError(startMockUpload(modelInput), 0)
    expect(error.code).toBe('NETWORK_ERROR')
  })

  it('普通新上传依次经过 receiving、validating、ready，前两阶段绑定被拒绝', async () => {
    await login({ username: 'admin', password: 'admin' })
    const created = await startMockUpload(modelInput)
    expect(created.status).toBe('receiving')

    const receivingError = await expectApiError(
      updateAdminWork('work_draft_002', { modelAssetId: created.assetId }),
      422,
    )
    expect(receivingError.fields).toMatchObject({ modelAssetId: expect.any(String) })

    await waitForStatus(created.assetId, 'validating')
    const validatingError = await expectApiError(
      updateAdminWork('work_draft_002', { modelAssetId: created.assetId }),
      422,
    )
    expect(validatingError.fields).toMatchObject({ modelAssetId: expect.any(String) })

    await waitForStatus(created.assetId, 'ready')
    const updated = await updateAdminWork('work_draft_002', {
      modelAssetId: created.assetId,
    })
    expect(updated).toMatchObject({
      modelAssetId: created.assetId,
      modelFormat: 'glb',
      status: 'draft',
    })
  })

  it('ready 模型按服务端登记的 kind/format 绑定到草稿', async () => {
    await login({ username: 'admin', password: 'admin' })
    const created = await startMockUpload(modelInput)
    const ready = await waitForStatus(created.assetId, 'ready')
    expect(ready).toMatchObject({
      kind: 'model',
      modelFormat: 'glb',
      simulatedProgress: null,
    })

    const updated = await updateAdminWork('work_draft_002', {
      modelAssetId: created.assetId,
    })
    expect(updated).toMatchObject({
      modelAssetId: created.assetId,
      modelFormat: 'glb',
      status: 'draft',
    })
    expect((await getAdminWork('work_draft_002')).modelFormat).toBe('glb')
  })

  it('PLY 模拟绑定保留 gaussian-ply，但仍只是模拟格式', async () => {
    await login({ username: 'admin', password: 'admin' })
    const created = await startMockUpload({
      ...modelInput,
      originalName: 'terrain.ply',
      mimeType: 'application/octet-stream',
    })
    await waitForStatus(created.assetId, 'ready')

    const updated = await updateAdminWork('work_draft_002', {
      modelAssetId: created.assetId,
    })
    expect(updated.modelFormat).toBe('gaussian-ply')
  })

  it('已有种子模型与封面仍可作为 ready 资源绑定', async () => {
    await login({ username: 'admin', password: 'admin' })
    const updated = await updateAdminWork('work_draft_002', {
      modelAssetId: 'asset_demo_003_model',
      coverAssetId: 'asset_demo_001_cover',
    })
    expect(updated).toMatchObject({
      modelAssetId: 'asset_demo_003_model',
      modelFormat: 'gaussian-ply',
      coverAssetId: 'asset_demo_001_cover',
      coverUrl: '/mock/placeholder-cover.svg',
    })
  })

  it('验证中或失败的资源不能绑定，旧绑定保持不变', async () => {
    await login({ username: 'admin', password: 'admin' })
    await updateAdminWork('work_draft_002', {
      modelAssetId: 'asset_demo_001_model',
      coverAssetId: 'asset_demo_001_cover',
    })

    setMockScenario('upload-validating')
    const validating = await startMockUpload(modelInput)
    await waitForStatus(validating.assetId, 'validating')
    const validatingError = await expectApiError(
      updateAdminWork('work_draft_002', { modelAssetId: validating.assetId }),
      422,
    )
    expect(validatingError.fields).toMatchObject({ modelAssetId: expect.any(String) })

    setMockScenario('upload-model-failure')
    const failed = await startMockUpload(modelInput)
    await waitForStatus(failed.assetId, 'failed')
    const failedError = await expectApiError(
      updateAdminWork('work_draft_002', { modelAssetId: failed.assetId }),
      422,
    )
    expect(failedError.fields).toMatchObject({ modelAssetId: expect.any(String) })

    const after = await getAdminWork('work_draft_002')
    expect(after.modelAssetId).toBe('asset_demo_001_model')
    expect(after.coverAssetId).toBe('asset_demo_001_cover')
  })

  it('错误 kind 与未知编号都不能绑定', async () => {
    await login({ username: 'admin', password: 'admin' })
    const cover = await startMockUpload(coverInput)
    await waitForStatus(cover.assetId, 'ready')
    const wrongModel = await expectApiError(
      updateAdminWork('work_draft_002', { modelAssetId: cover.assetId }),
      422,
    )
    expect(wrongModel.fields).toMatchObject({ modelAssetId: expect.any(String) })

    const model = await startMockUpload(modelInput)
    await waitForStatus(model.assetId, 'ready')
    const wrongCover = await expectApiError(
      updateAdminWork('work_draft_002', { coverAssetId: model.assetId }),
      422,
    )
    expect(wrongCover.fields).toMatchObject({ coverAssetId: expect.any(String) })

    const unknown = await expectApiError(
      updateAdminWork('work_draft_002', { modelAssetId: 'asset_unknown_upload' }),
      422,
    )
    expect(unknown.fields).toMatchObject({ modelAssetId: expect.any(String) })
  })

  it('复位 Mock 数据后模拟登记也清空', async () => {
    await login({ username: 'admin', password: 'admin' })
    const created = await startMockUpload(modelInput)
    expect((await getMockUpload(created.assetId)).assetId).toBe(created.assetId)

    resetMockState()
    await login({ username: 'admin', password: 'admin' })
    await expectApiError(getMockUpload(created.assetId), 404)
  })

  it('未确定正式协议前，模拟接口只接收 metadata；缺少 metadata 被拒绝', async () => {
    await login({ username: 'admin', password: 'admin' })
    const error = await expectApiError(
      startMockUpload({
        kind: 'model',
        originalName: '',
        sizeBytes: -1,
        mimeType: '',
      }),
      422,
    )
    expect(error.code).toBe('VALIDATION_FAILED')
  })
})
