import { afterEach, describe, expect, it, vi } from 'vitest'
import { ViewerError } from '../../src/viewer/errors'
import { readModelSource } from '../../src/viewer/source'

function glbBytes(length = 128): Uint8Array {
  const bytes = new Uint8Array(length)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, 0x46546c67, true)
  view.setUint32(4, 2, true)
  view.setUint32(8, length, true)
  view.setUint32(12, length - 20, true)
  view.setUint32(16, 0x4e4f534a, true)
  for (let index = 20; index < length; index += 1) bytes[index] = 0x20
  return bytes
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('URL/File 读取的真实字节进度', () => {
  it('按实际收到的 chunk 报告 loaded/total/percent', async () => {
    const bytes = glbBytes()
    const chunks = [bytes.slice(0, 20), bytes.slice(20, 64), bytes.slice(64)]
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              for (const chunk of chunks) controller.enqueue(chunk)
              controller.close()
            },
          }),
          { headers: { 'content-length': String(bytes.byteLength) } },
        ),
      ),
    )
    const progress: Array<{ loaded: number; total: number | null; percent: number | null }> = []
    const result = await readModelSource(
      { kind: 'url', url: '/model.glb', version: '1' },
      new AbortController().signal,
      (event) => progress.push({ loaded: event.loadedBytes, total: event.totalBytes, percent: event.percent }),
    )
    expect(result.buffer.byteLength).toBe(bytes.byteLength)
    expect(progress.map((item) => item.loaded)).toEqual([20, 64, 128])
    expect(progress.map((item) => item.percent)).toEqual([15.625, 50, 100])
    expect(progress.every((item) => item.total === 128)).toBe(true)
  })

  it('没有 Content-Length 时不伪造百分比', async () => {
    const bytes = glbBytes()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(bytes)
              controller.close()
            },
          }),
        ),
      ),
    )
    const percents: Array<number | null> = []
    await readModelSource(
      { kind: 'url', url: '/model.glb', version: '1' },
      new AbortController().signal,
      (event) => percents.push(event.percent),
    )
    expect(percents).toEqual([null])
  })

  it('读取过程中按真实内容拒绝非 GLB/PLY', async () => {
    const bytes = new TextEncoder().encode(
      'this is not a model but it is deliberately longer than sixty-four bytes to trigger the magic probe.',
    )
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(bytes)
              controller.close()
            },
          }),
        ),
      ),
    )
    await expect(
      readModelSource(
        { kind: 'url', url: '/fake.glb', version: '1' },
        new AbortController().signal,
        () => undefined,
      ),
    ).rejects.toMatchObject({ code: 'MAGIC' })
  })

  it('魔数不匹配早退时取消未读流', async () => {
    let cancelled = false
    let reads = 0
    const bytes = new TextEncoder().encode(
      'not a model at all but long enough to fail the sixty-four byte magic probe and must be cancelled.',
    )
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              reads += 1
              controller.enqueue(bytes)
              // 保持流未关闭，早退时必须显式 cancel，而不是等后台继续读完。
            },
            cancel() {
              cancelled = true
            },
          }),
        ),
      ),
    )
    await expect(
      readModelSource(
        { kind: 'url', url: '/fake.glb', version: '1' },
        new AbortController().signal,
        () => undefined,
      ),
    ).rejects.toMatchObject({ code: 'MAGIC' })
    expect(cancelled).toBe(true)
    expect(reads).toBeGreaterThanOrEqual(1)
  })

  it('HTTP 失败不当作空模型', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('missing', { status: 404, statusText: 'Not Found' })))
    await expect(
      readModelSource(
        { kind: 'url', url: '/missing.glb', version: '1' },
        new AbortController().signal,
        () => undefined,
      ),
    ).rejects.toBeInstanceOf(ViewerError)
  })
})
