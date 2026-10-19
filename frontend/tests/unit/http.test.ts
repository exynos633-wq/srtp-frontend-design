import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, apiRequest } from '../../src/api/http'
import { isRetryableError } from '../../src/app/queryClient'

afterEach(() => vi.unstubAllGlobals())

describe('响应体读取失败', () => {
  it('收到响应头后流中断仍归一为可重试的网络错误', async () => {
    const response = new Response(new ReadableStream({
      start(controller) {
        controller.error(new TypeError('connection reset'))
      },
    }))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response))

    const error = await apiRequest('/works').catch((error: unknown) => error)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 0, code: 'NETWORK_ERROR' })
    expect(isRetryableError(error)).toBe(true)
  })

  it('读取响应体期间取消时原样抛出 AbortError', async () => {
    const aborted = new DOMException('cancelled', 'AbortError')
    const response = new Response(new ReadableStream({
      start(controller) {
        controller.error(aborted)
      },
    }))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response))

    await expect(apiRequest('/works')).rejects.toBe(aborted)
  })

  it('完整读取但 JSON 无效时仍报告 INVALID_RESPONSE', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>not JSON</html>')))

    await expect(apiRequest('/works')).rejects.toMatchObject({
      status: 200,
      code: 'INVALID_RESPONSE',
    })
  })
})
