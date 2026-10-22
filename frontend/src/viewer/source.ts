import { isAbortError, ViewerError } from './errors'
import type { ModelSource, ReadProgress } from './types'

export interface SourceBytes {
  buffer: ArrayBuffer
  name: string
}

export type ProgressHandler = (progress: ReadProgress) => void

const MAGIC_PROBE_BYTES = 64

/** 通过真实收到的字节判断格式，不依赖文件后缀。 */
export function detectFormatFromBytes(bytes: Uint8Array): 'glb' | 'ply' | null {
  if (bytes.byteLength >= 12) {
    const magic = String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!)
    if (magic === 'glTF') return 'glb'
  }
  if (
    bytes.byteLength >= 4 &&
    bytes[0] === 0x70 &&
    bytes[1] === 0x6c &&
    bytes[2] === 0x79 &&
    (bytes[3] === 0x0a || bytes[3] === 0x0d)
  ) {
    return 'ply'
  }
  return null
}

function abortError(): DOMException {
  return new DOMException('Aborted', 'AbortError')
}

function assertNotAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError()
}

async function readStream(
  stream: ReadableStream<Uint8Array>,
  totalBytes: number | null,
  signal: AbortSignal,
  onProgress: ProgressHandler,
): Promise<ArrayBuffer> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let loaded = 0
  let probed = false
  const onAbort = () => {
    void reader.cancel().catch(() => undefined)
  }
  signal.addEventListener('abort', onAbort, { once: true })

  try {
    for (;;) {
      assertNotAborted(signal)
      const { done, value } = await reader.read()
      if (done) break
      if (!value || value.byteLength === 0) continue
      chunks.push(value)
      loaded += value.byteLength
      if (!probed && loaded >= MAGIC_PROBE_BYTES) {
        probed = true
        const probe = new Uint8Array(loaded)
        let offset = 0
        for (const chunk of chunks) {
          probe.set(chunk, offset)
          offset += chunk.byteLength
        }
        if (detectFormatFromBytes(probe) === null) {
          throw new ViewerError('MAGIC')
        }
      }
      onProgress({
        phase: 'read',
        loadedBytes: loaded,
        totalBytes,
        percent: totalBytes && totalBytes > 0 ? Math.min(100, (loaded / totalBytes) * 100) : null,
      })
    }
  } catch (error) {
    if (signal.aborted || isAbortError(error)) throw abortError()
    // 魔数/格式早退或读取异常时取消未读流，避免后台继续下载。
    try {
      await reader.cancel()
    } catch {
      // 流可能已关闭。
    }
    throw error
  } finally {
    signal.removeEventListener('abort', onAbort)
    reader.releaseLock()
  }

  assertNotAborted(signal)
  const merged = new Uint8Array(loaded)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  if (detectFormatFromBytes(merged) === null) throw new ViewerError('MAGIC')
  return merged.buffer
}

function totalFromHeaders(headers: Headers): number | null {
  const raw = headers.get('content-length')
  if (!raw) return null
  const value = Number(raw)
  return Number.isFinite(value) && value >= 0 ? value : null
}

/**
 * 读取 URL 或本地 File。URL 走真实 fetch 流并报告实际字节进度；
 * File 只读取本地内存，不上传、不写入 Query 缓存。
 */
export async function readModelSource(
  source: ModelSource,
  signal: AbortSignal,
  onProgress: ProgressHandler,
): Promise<SourceBytes> {
  if (source.kind === 'file') {
    const file = source.file
    if (!(file instanceof Blob) || file.size === 0) throw new ViewerError('UNSUPPORTED_SOURCE')
    onProgress({ phase: 'read', loadedBytes: 0, totalBytes: file.size, percent: 0 })
    try {
      const buffer = await readStream(file.stream(), file.size, signal, onProgress)
      return { buffer, name: source.name ?? file.name }
    } catch (error) {
      if (signal.aborted || isAbortError(error)) throw abortError()
      if (error instanceof ViewerError) throw error
      throw new ViewerError('NETWORK', '读取本地文件失败。', error)
    }
  }

  let response: Response
  try {
    response = await fetch(source.url, {
      signal,
      cache: 'no-store',
      credentials: 'same-origin',
    })
  } catch (error) {
    if (signal.aborted || isAbortError(error)) throw abortError()
    throw new ViewerError('NETWORK', undefined, error)
  }
  if (!response.ok) {
    throw new ViewerError('HTTP', `HTTP ${response.status} ${response.statusText}`.trim())
  }
  const total = totalFromHeaders(response.headers)
  const fallbackName = source.name ?? source.url.split('/').pop() ?? 'model'
  if (!response.body) {
    const buffer = await response.arrayBuffer()
    assertNotAborted(signal)
    if (detectFormatFromBytes(new Uint8Array(buffer)) === null) throw new ViewerError('MAGIC')
    onProgress({
      phase: 'read',
      loadedBytes: buffer.byteLength,
      totalBytes: buffer.byteLength,
      percent: 100,
    })
    return { buffer, name: fallbackName }
  }
  const buffer = await readStream(response.body, total, signal, onProgress)
  return { buffer, name: fallbackName }
}
