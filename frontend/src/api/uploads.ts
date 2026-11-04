import { appConfig } from '../app/env'
import type { UploadAsset, UploadAssetKind } from '../types/upload'
import { apiRequest, joinUrl, normalizeError } from './http'

/**
 * 正式上传客户端（契约来自 feature/backend-client-rendering）：
 * POST /api/admin/assets?kind=model|cover，multipart/form-data，同源 Cookie。
 *
 * 用 XHR 而不是 fetch，是为了在 512MB 模型上传时拿到真实字节进度；进度只
 * 表示浏览器已发送的字节，不代表服务端已校验。响应返回后再按状态轮询。
 */

export const UPLOAD_LIMITS: Record<UploadAssetKind, number> = {
  model: 512 * 1024 * 1024,
  cover: 10 * 1024 * 1024,
}

const MODEL_EXTENSIONS = ['.glb', '.ply']
const COVER_EXTENSIONS = ['.webp', '.jpg', '.jpeg', '.png']

export function validateUploadFile(file: File, kind: UploadAssetKind): string | null {
  const name = file.name.toLowerCase()
  if (kind === 'model') {
    if (!MODEL_EXTENSIONS.some((extension) => name.endsWith(extension))) {
      return '模型仅支持 .glb / .ply。'
    }
    if (file.size > UPLOAD_LIMITS.model) return '模型文件不能超过 512 MB。'
  } else {
    if (!COVER_EXTENSIONS.some((extension) => name.endsWith(extension))) {
      return '封面仅支持 .webp / .jpg / .jpeg / .png。'
    }
    if (file.size > UPLOAD_LIMITS.cover) return '封面文件不能超过 10 MB。'
  }
  if (file.size === 0) return '文件为空，无法上传。'
  return null
}

export interface UploadAssetOptions {
  signal?: AbortSignal
  onProgress?: (percent: number) => void
}

function readPayload(xhr: XMLHttpRequest): unknown {
  return xhr.response ?? undefined
}

export function uploadAsset(
  file: File,
  kind: UploadAssetKind,
  options: UploadAssetOptions = {},
): Promise<UploadAsset> {
  const { signal, onProgress } = options
  const invalid = validateUploadFile(file, kind)
  if (invalid) return Promise.reject(new Error(invalid))

  return new Promise<UploadAsset>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    let settled = false
    let lastPercent = -1

    const cleanup = () => {
      signal?.removeEventListener('abort', handleAbort)
    }
    const fail = (error: unknown) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }
    const succeed = (asset: UploadAsset) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(asset)
    }
    function handleAbort() {
      xhr.abort()
      fail(new DOMException('Aborted', 'AbortError'))
    }

    xhr.open('POST', joinUrl(appConfig.apiBaseUrl, `/admin/assets?kind=${kind}`))
    xhr.withCredentials = true
    xhr.responseType = 'json'
    xhr.setRequestHeader('Accept', 'application/json')

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || event.total <= 0) return
      const percent = Math.min(100, Math.round((event.loaded / event.total) * 100))
      if (percent === lastPercent) return
      lastPercent = percent
      onProgress?.(percent)
    }

    xhr.onload = () => {
      const payload = readPayload(xhr)
      if (xhr.status >= 200 && xhr.status < 300) {
        succeed(payload as UploadAsset)
        return
      }
      fail(normalizeError(xhr.status, payload))
    }
    xhr.onerror = () => {
      fail(
        normalizeError(0, {
          error: {
            code: 'NETWORK_ERROR',
            message: '上传失败，无法连接服务器。请检查网络后手动重试。',
          },
        }),
      )
    }
    xhr.onabort = () => fail(new DOMException('Aborted', 'AbortError'))

    if (signal?.aborted) {
      fail(new DOMException('Aborted', 'AbortError'))
      return
    }
    signal?.addEventListener('abort', handleAbort, { once: true })

    const form = new FormData()
    form.append('file', file, file.name)
    xhr.send(form)
  })
}

export function getUploadAsset(assetId: string, signal?: AbortSignal): Promise<UploadAsset> {
  return apiRequest<UploadAsset>(`/admin/assets/${encodeURIComponent(assetId)}`, { signal })
}
