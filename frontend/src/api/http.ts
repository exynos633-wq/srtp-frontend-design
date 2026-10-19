import { appConfig } from '../app/env'
import type { ApiErrorBody } from '../types/api'

/**
 * 统一请求层。所有真实接口与 Mock 都走这里：Mock 只是替换 HTTP 的实现，
 * 不会另开一条“假数据通道”，因此关闭 Mock 时行为与真实环境一致。
 */

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE'

export interface RequestOptions {
  method?: HttpMethod
  /** 会被 JSON 序列化；不要放 File／Blob 等二进制对象（上传协议未定稿）。 */
  body?: unknown
  signal?: AbortSignal
}

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly fields: Record<string, string> | undefined

  constructor(
    message: string,
    options: { status: number; code: string; fields?: Record<string, string> },
  ) {
    super(message)
    this.name = 'ApiError'
    this.status = options.status
    this.code = options.code
    this.fields = options.fields
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError
}

/** 服务端错误体是否形如 `{ error: { code, message } }`。 */
function isApiErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== 'object' || value === null) return false
  const error = (value as { error?: unknown }).error
  if (typeof error !== 'object' || error === null) return false
  const { code, message } = error as { code?: unknown; message?: unknown }
  return typeof code === 'string' && typeof message === 'string'
}

function normalizeError(status: number, payload: unknown): ApiError {
  if (isApiErrorBody(payload)) {
    const { code, message, fields } = payload.error
    return new ApiError(message, { status, code, fields })
  }
  return new ApiError(`请求失败（HTTP ${status}）`, {
    status,
    code: `HTTP_${status}`,
  })
}

function joinUrl(base: string, path: string): string {
  const normalizedBase = base.replace(/\/+$/, '')
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return `${normalizedBase}${normalizedPath}`
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, signal } = options
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  let response: Response
  let text: string
  try {
    response = await fetch(joinUrl(appConfig.apiBaseUrl, path), {
      method,
      headers,
      // 认证提案为同源 HttpOnly Cookie；前端不保存 token。
      credentials: 'include',
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    })
    if (response.status === 204) return undefined as T
    text = await response.text()
  } catch (error) {
    // 主动取消原样抛出，交给 React Query 识别，不当成网络故障。
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new ApiError('无法连接服务器，请检查网络后手动重试', {
      status: 0,
      code: 'NETWORK_ERROR',
    })
  }

  let payload: unknown
  if (text.length > 0) {
    try {
      payload = JSON.parse(text)
    } catch {
      if (response.ok) {
        throw new ApiError('服务器返回了无法解析的数据', { status: response.status, code: 'INVALID_RESPONSE' })
      }
      payload = undefined
    }
  }

  if (!response.ok) throw normalizeError(response.status, payload)
  return payload as T
}
