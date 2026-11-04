import type { ReactNode } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../src/api/http'
import { queryKeys } from '../../src/api/queryKeys'
import { createQueryClient } from '../../src/app/queryClient'
import { useMockUpload } from '../../src/lib/useMockUpload'
import type { UploadSimulationAsset } from '../../src/types/upload'

const mocks = vi.hoisted(() => ({
  start: vi.fn(),
  get: vi.fn(),
  simulated: vi.fn(() => true),
  liveUpload: vi.fn(),
  liveGet: vi.fn(),
}))

vi.mock('../../src/api/mockUploads', () => ({
  startMockUpload: mocks.start,
  getMockUpload: mocks.get,
  isUploadSimulationEnabled: mocks.simulated,
}))

vi.mock('../../src/api/uploads', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/api/uploads')>()
  return {
    ...actual,
    uploadAsset: mocks.liveUpload,
    getUploadAsset: mocks.liveGet,
  }
})

function asset(
  overrides: Partial<UploadSimulationAsset> = {},
): UploadSimulationAsset {
  return {
    assetId: 'asset_test',
    kind: 'model',
    originalName: 'demo.glb',
    sizeBytes: 10,
    status: 'ready',
    simulatedProgress: null,
    modelFormat: 'glb',
    error: null,
    ...overrides,
  }
}

function file(name: string, type = 'model/gltf-binary') {
  return new File(['demo'], name, { type })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function renderUploadHook<T>(hook: () => T) {
  const client = createQueryClient()
  client.setQueryData(queryKeys.auth.me(), { user: { id: 'test-admin' } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  const rendered = renderHook(hook, { wrapper })
  return { ...rendered, client }
}

const originalCreate = URL.createObjectURL
const originalRevoke = URL.revokeObjectURL
const createObjectUrl = vi.fn()
const revokeObjectUrl = vi.fn()

beforeEach(() => {
  mocks.start.mockReset()
  mocks.get.mockReset()
  mocks.simulated.mockReset()
  mocks.simulated.mockReturnValue(true)
  mocks.liveUpload.mockReset()
  mocks.liveGet.mockReset()
  createObjectUrl.mockReset()
  revokeObjectUrl.mockReset()
  let counter = 0
  createObjectUrl.mockImplementation(() => `blob:cover-${++counter}`)
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: createObjectUrl,
  })
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: revokeObjectUrl,
  })
})

afterAll(() => {
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: originalCreate,
  })
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: originalRevoke,
  })
})

describe('P12 模拟上传请求身份与资源清理', () => {
  it('换文件后旧请求迟到完成不覆盖新选择', async () => {
    const first = deferred<UploadSimulationAsset>()
    const second = asset({
      assetId: 'asset_second',
      originalName: 'second.glb',
    })
    mocks.start.mockImplementation((input: { originalName: string }) =>
      input.originalName === 'first.glb' ? first.promise : Promise.resolve(second),
    )

    const { result } = renderUploadHook(() => useMockUpload('model'))
    act(() => result.current.selectFile(file('first.glb')))
    act(() => result.current.selectFile(file('second.glb')))

    await waitFor(() => expect(result.current.selection?.status).toBe('ready'))
    expect(result.current.selection?.file.name).toBe('second.glb')

    await act(async () => {
      first.resolve(asset({ assetId: 'asset_first', originalName: 'first.glb' }))
    })
    expect(result.current.selection?.assetId).toBe('asset_second')
    expect(result.current.selection?.file.name).toBe('second.glb')
  })

  it('取消后旧请求完成不再恢复选择', async () => {
    const first = deferred<UploadSimulationAsset>()
    mocks.start.mockReturnValue(first.promise)
    const { result } = renderUploadHook(() => useMockUpload('model'))

    act(() => result.current.selectFile(file('cancel.glb')))
    act(() => result.current.cancel())
    expect(result.current.selection).toBeNull()
    expect(result.current.wasCanceled).toBe(true)

    await act(async () => {
      first.resolve(asset({ assetId: 'asset_old' }))
    })
    expect(result.current.selection).toBeNull()
  })

  it('封面对象 URL 在换文件、取消和卸载时释放', () => {
    mocks.start.mockReturnValue(new Promise<UploadSimulationAsset>(() => {}))
    const { result, unmount } = renderUploadHook(() => useMockUpload('cover'))

    act(() => result.current.selectFile(file('cover-a.png', 'image/png')))
    expect(createObjectUrl).toHaveBeenCalledTimes(1)
    expect(result.current.objectUrl).toBe('blob:cover-1')

    act(() => result.current.selectFile(file('cover-b.png', 'image/png')))
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:cover-1')
    expect(result.current.objectUrl).toBe('blob:cover-2')

    act(() => result.current.cancel())
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:cover-2')
    expect(result.current.objectUrl).toBeNull()

    act(() => result.current.selectFile(file('cover-c.png', 'image/png')))
    expect(result.current.objectUrl).toBe('blob:cover-3')
    unmount()
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:cover-3')
  })

  it('模型选择不创建对象 URL', () => {
    mocks.start.mockReturnValue(new Promise<UploadSimulationAsset>(() => {}))
    const { result } = renderUploadHook(() => useMockUpload('model'))
    act(() => result.current.selectFile(file('model.glb')))
    expect(createObjectUrl).not.toHaveBeenCalled()
    expect(result.current.objectUrl).toBeNull()
  })

  it('失败后重试复用原文件，ready 后清除才释放对象 URL', async () => {
    mocks.start
      .mockResolvedValueOnce(
        asset({ assetId: 'asset_failed', status: 'failed', error: '模拟失败' }),
      )
      .mockResolvedValueOnce(asset({ assetId: 'asset_ready', status: 'ready' }))
    const { result } = renderUploadHook(() => useMockUpload('cover'))

    act(() => result.current.selectFile(file('cover.png', 'image/png')))
    await waitFor(() => expect(result.current.selection?.status).toBe('failed'))
    expect(result.current.hasUnsettled).toBe(true)
    expect(result.current.objectUrl).toBe('blob:cover-1')

    act(() => result.current.retry())
    await waitFor(() => expect(result.current.selection?.status).toBe('ready'))
    expect(result.current.selection?.file.name).toBe('cover.png')
    expect(result.current.hasUnsettled).toBe(false)
    expect(createObjectUrl).toHaveBeenCalledTimes(1)
    expect(revokeObjectUrl).not.toHaveBeenCalled()

    act(() => result.current.clearAfterSave())
    expect(result.current.selection).toBeNull()
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:cover-1')
  })


  it.each([401, 403] as const)('开始上传返回 %s 时走管理认证清理并清空本地文件', async (status) => {
    const { result, client } = renderUploadHook(() => useMockUpload('cover'))
    client.setQueryData(queryKeys.admin.work('secret-draft'), { description: '私有草稿' })
    const error = new ApiError(status === 401 ? '登录已失效' : '无权上传', {
      status,
      code: status === 401 ? 'UNAUTHENTICATED' : 'FORBIDDEN',
    })
    mocks.start.mockRejectedValueOnce(error)

    act(() => result.current.selectFile(file('cover.png', 'image/png')))
    await waitFor(() => expect(result.current.selection).toBeNull())

    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:cover-1')
    expect(client.getQueryData(queryKeys.auth.me())).toBeNull()
    expect(client.getQueryData(queryKeys.auth.failure())).toBe(error)
    expect(client.getQueriesData({ queryKey: queryKeys.admin.all })).toEqual([])
  })

  it.each([401, 403] as const)('轮询返回 %s 时走管理认证清理并中止当前上传', async (status) => {
    const { result, client } = renderUploadHook(() => useMockUpload('cover'))
    const error = new ApiError(status === 401 ? '登录已失效' : '无权上传', {
      status,
      code: status === 401 ? 'UNAUTHENTICATED' : 'FORBIDDEN',
    })
    mocks.start.mockResolvedValueOnce(
      asset({
        assetId: 'asset_poll',
        kind: 'cover',
        status: 'receiving',
        simulatedProgress: 20,
        modelFormat: null,
      }),
    )
    mocks.get.mockRejectedValueOnce(error)

    act(() => result.current.selectFile(file('cover.png', 'image/png')))
    await waitFor(() => expect(client.getQueryData(queryKeys.auth.me())).toBeNull())

    expect(mocks.get).toHaveBeenCalledWith('asset_poll', expect.anything())
    expect(result.current.selection).toBeNull()
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:cover-1')
    expect(client.getQueryData(queryKeys.auth.failure())).toBe(error)
  })

  it('一个上传认证失败后，另一上传迟到 ready 不更新页面', async () => {
    const lateCover = deferred<UploadSimulationAsset>()
    const error = new ApiError('登录已失效', {
      status: 401,
      code: 'UNAUTHENTICATED',
    })
    mocks.start.mockImplementation((input: { kind: string }) =>
      input.kind === 'model' ? Promise.reject(error) : lateCover.promise,
    )
    const { result, client } = renderUploadHook(() => ({
      model: useMockUpload('model'),
      cover: useMockUpload('cover'),
    }))

    act(() => {
      result.current.model.selectFile(file('model.glb'))
      result.current.cover.selectFile(file('cover.png', 'image/png'))
    })
    await waitFor(() => expect(client.getQueryData(queryKeys.auth.me())).toBeNull())
    expect(result.current.model.selection).toBeNull()

    await act(async () => {
      lateCover.resolve(
        asset({ assetId: 'late-cover', kind: 'cover', status: 'ready', modelFormat: null }),
      )
    })
    expect(result.current.cover.selection?.status).toBe('receiving')
    expect(result.current.cover.selection?.assetId).toBeNull()
  })

  it('Mock 关闭时使用正式 multipart 上传并保留真实进度', async () => {
    mocks.simulated.mockReturnValue(false)
    const pending = deferred<UploadSimulationAsset>()
    mocks.liveUpload.mockImplementation(
      (
        _file: File,
        _kind: string,
        options: { onProgress?: (percent: number) => void },
      ) => {
        options.onProgress?.(64)
        return pending.promise
      },
    )
    const { result } = renderUploadHook(() => useMockUpload('model'))

    act(() => result.current.selectFile(file('demo.glb')))
    await waitFor(() => expect(result.current.selection?.status).toBe('receiving'))

    expect(result.current.mode).toBe('live')
    expect(result.current.selection?.progress).toBe(64)
    expect(mocks.start).not.toHaveBeenCalled()

    await act(async () => {
      pending.resolve(asset({ assetId: 'asset_live', status: 'ready' }))
    })
    await waitFor(() => expect(result.current.readyAssetId).toBe('asset_live'))
    expect(result.current.selection?.progress).toBe(100)
    expect(mocks.liveGet).not.toHaveBeenCalled()
  })

  it('卸载会中止进行中的模拟请求', () => {
    let capturedSignal: AbortSignal | undefined
    mocks.start.mockImplementation((_input, options: { signal?: AbortSignal }) => {
      capturedSignal = options.signal
      return new Promise<UploadSimulationAsset>(() => {})
    })
    const { result, unmount } = renderUploadHook(() => useMockUpload('model'))
    act(() => result.current.selectFile(file('pending.glb')))
    expect(capturedSignal?.aborted).toBe(false)
    unmount()
    expect(capturedSignal?.aborted).toBe(true)
  })
})
