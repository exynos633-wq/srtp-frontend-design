import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  UPLOAD_LIMITS,
  getUploadAsset,
  uploadAsset,
  validateUploadFile,
} from '../../src/api/uploads'
import type { UploadAsset } from '../../src/types/upload'

class FakeXHR {
  static instances: FakeXHR[] = []

  method = ''
  url = ''
  status = 0
  response: unknown = null
  withCredentials = false
  responseType = ''
  body: Document | XMLHttpRequestBodyInit | null = null
  headers: Record<string, string> = {}
  aborted = false

  upload = { onprogress: null as ((event: ProgressEvent) => void) | null }
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  onabort: (() => void) | null = null

  constructor() {
    FakeXHR.instances.push(this)
  }

  open(method: string, url: string) {
    this.method = method
    this.url = url
  }

  setRequestHeader(name: string, value: string) {
    this.headers[name] = value
  }

  send(body: Document | XMLHttpRequestBodyInit | null) {
    this.body = body
  }

  abort() {
    this.aborted = true
    this.onabort?.()
  }

  emitProgress(loaded: number, total: number) {
    this.upload.onprogress?.({
      lengthComputable: true,
      loaded,
      total,
    } as ProgressEvent)
  }

  respond(status: number, payload: unknown) {
    this.status = status
    this.response = payload
    this.onload?.()
  }
}

function file(name: string, size = 6) {
  return new File([new Uint8Array(size)], name, { type: 'application/octet-stream' })
}

function asset(overrides: Partial<UploadAsset> = {}): UploadAsset {
  return {
    assetId: 'asset_1',
    kind: 'model',
    originalName: 'demo.glb',
    sizeBytes: 6,
    status: 'ready',
    modelFormat: 'glb',
    error: null,
    ...overrides,
  }
}

describe('正式上传客户端契约', () => {
  beforeEach(() => {
    FakeXHR.instances = []
    vi.stubGlobal('XMLHttpRequest', FakeXHR as unknown as typeof XMLHttpRequest)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('拒绝不支持的扩展名、空文件和超限文件', () => {
    expect(validateUploadFile(file('model.obj'), 'model')).toContain('.glb')
    expect(validateUploadFile(file('cover.gif'), 'cover')).toContain('.webp')
    expect(validateUploadFile(file('empty.glb', 0), 'model')).toContain('为空')

    const tooBig = file('huge.glb')
    Object.defineProperty(tooBig, 'size', { value: UPLOAD_LIMITS.model + 1 })
    expect(validateUploadFile(tooBig, 'model')).toContain('512 MB')

    const bigCover = file('huge.png')
    Object.defineProperty(bigCover, 'size', { value: UPLOAD_LIMITS.cover + 1 })
    expect(validateUploadFile(bigCover, 'cover')).toContain('10 MB')

    expect(validateUploadFile(file('demo.ply', 8), 'model')).toBeNull()
    expect(validateUploadFile(file('cover.webp', 8), 'cover')).toBeNull()
  })

  it('以 multipart POST /api/admin/assets 上传，并报告真实字节进度', async () => {
    const onProgress = vi.fn()
    const pending = uploadAsset(file('demo.glb'), 'model', { onProgress })
    const xhr = FakeXHR.instances[0]
    expect(xhr.method).toBe('POST')
    expect(xhr.url).toBe('/api/admin/assets?kind=model')
    expect(xhr.withCredentials).toBe(true)
    expect(xhr.body).toBeInstanceOf(FormData)
    expect((xhr.body as FormData).get('file')).toBeInstanceOf(File)

    xhr.emitProgress(3, 6)
    xhr.emitProgress(6, 6)
    xhr.respond(201, asset())
    await expect(pending).resolves.toEqual(expect.objectContaining({ assetId: 'asset_1' }))
    expect(onProgress.mock.calls).toEqual([[50], [100]])
  })

  it('把服务端 201 failed 原样交给调用方，不伪造 ready', async () => {
    const pending = uploadAsset(file('bad.ply'), 'model')
    const xhr = FakeXHR.instances[0]
    xhr.respond(
      201,
      asset({
        status: 'failed',
        modelFormat: null,
        error: '该 PLY 不是高斯泼溅格式（缺少 f_dc_* / scale_* 属性）',
      }),
    )
    await expect(pending).resolves.toMatchObject({
      status: 'failed',
      modelFormat: null,
      error: expect.stringContaining('f_dc_*'),
    })
  })

  it('非 2xx 响应转换为带 code 的 ApiError', async () => {
    const pending = uploadAsset(file('demo.glb'), 'model')
    const xhr = FakeXHR.instances[0]
    xhr.respond(413, {
      error: { code: 'PAYLOAD_TOO_LARGE', message: '文件超过上限。' },
    })
    await expect(pending).rejects.toMatchObject({
      name: 'ApiError',
      status: 413,
      code: 'PAYLOAD_TOO_LARGE',
      message: '文件超过上限。',
    })
  })

  it('信号中止会 abort XHR 并拒绝为 AbortError', async () => {
    const controller = new AbortController()
    const pending = uploadAsset(file('demo.glb'), 'model', {
      signal: controller.signal,
    })
    const xhr = FakeXHR.instances[0]
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(xhr.aborted).toBe(true)
  })

  it('轮询使用管理资源接口', async () => {
    const request = vi.fn().mockResolvedValue(asset({ status: 'validating' }))
    vi.doMock('../../src/api/http', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../../src/api/http')>()
      return { ...actual, apiRequest: request }
    })
    vi.resetModules()
    const { getUploadAsset: freshGet } = await import('../../src/api/uploads')
    await expect(freshGet('asset_1')).resolves.toMatchObject({ status: 'validating' })
    expect(request).toHaveBeenCalledWith('/admin/assets/asset_1', { signal: undefined })
    vi.doUnmock('../../src/api/http')
  })

  it('上传函数本身也拒绝不可绑定格式，不发出请求', async () => {
    await expect(uploadAsset(file('demo.obj'), 'model')).rejects.toThrow('.glb')
    expect(FakeXHR.instances).toHaveLength(0)
    expect(getUploadAsset).toBeTypeOf('function')
  })
})
