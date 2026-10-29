import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../src/api/http'
import { shouldFallback, exchangeOffer } from '../../src/api/preview'
import { RemoteModelViewer, requiredRemoteCommands } from '../../src/viewer/RemoteModelViewer'
import type { ModelInfo, ModelViewerEvent } from '../../src/viewer/types'

const api = vi.hoisted(() => ({ create: vi.fn(), end: vi.fn(), request: vi.fn() }))
vi.mock('../../src/api/preview', async (original) => ({
  ...await original<typeof import('../../src/api/preview')>(),
  createPreviewSession: api.create, endPreviewSession: api.end,
}))
vi.mock('../../src/api/http', async (original) => ({
  ...await original<typeof import('../../src/api/http')>(), apiRequest: api.request,
}))

const info: ModelInfo = {
  format: 'glb', sourceName: 'protocol fixture', bytes: 1, sourceUp: 'y',
  orientation: { x: 0, y: 0, z: 0 },
  bounds: { min: [0, 0, 0], max: [1, 1, 1], size: [1, 1, 1], center: [0.5, 0.5, 0.5] },
  splats: null, triangles: 1, materials: 1, textures: 0, shDegree: null, hasEmissive: false,
}
const session = { sessionId: 's1', status: 'ready', expiresAt: '2030-01-01T00:00:00Z',
  connection: { kind: 'webrtc', protocolVersion: 1, offerUrl: '/rtc/offer', iceServers: [] } }

class Channel {
  readyState = 'open'
  bufferedAmount = 0
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  onopen: (() => void) | null = null
  send = vi.fn((raw: string) => {
    const message = JSON.parse(raw)
    if (message.type === 'command') queueMicrotask(() => this.receive({ v: 1, type: 'ack', id: message.id, ok: true }))
  })
  close = vi.fn()
  receive(data: object) { this.onmessage?.({ data: JSON.stringify(data) }) }
}
class Peer extends EventTarget {
  static last: Peer
  channel = new Channel()
  iceGatheringState = 'complete'
  connectionState = 'connected'
  localDescription = { type: 'offer', sdp: 'fixture' }
  ontrack: ((event: { track: EventTarget & { kind: string } }) => void) | null = null
  onconnectionstatechange: (() => void) | null = null
  addTransceiver = vi.fn()
  createDataChannel = vi.fn(() => this.channel)
  createOffer = vi.fn(async () => this.localDescription)
  setLocalDescription = vi.fn(async () => {})
  setRemoteDescription = vi.fn(async () => {})
  close = vi.fn()
  constructor() { super(); Peer.last = this }
}

let viewer: RemoteModelViewer
let frame: VideoFrameRequestCallback
let video: HTMLVideoElement
let track: EventTarget & { kind: string; stop: ReturnType<typeof vi.fn> }
let events: ModelViewerEvent[]
let failure = vi.fn<(error: unknown) => void>()

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  vi.stubGlobal('RTCPeerConnection', Peer)
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.stubGlobal('MediaStream', class {
    getTracks() { return [track] }
    getVideoTracks() { return [track] }
  })
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ type: 'answer', sdp: 'fixture' }))))
  api.create.mockResolvedValue(session)
  api.end.mockResolvedValue(undefined)
  api.request.mockResolvedValue({ status: 'ready' })
  track = Object.assign(new EventTarget(), { kind: 'video', stop: vi.fn() })
  video = document.createElement('video')
  video.requestVideoFrameCallback = vi.fn((callback) => { frame = callback; return 1 })
  video.cancelVideoFrameCallback = vi.fn()
  events = []
  failure = vi.fn<(error: unknown) => void>()
  viewer = new RemoteModelViewer(video, document.createElement('div'), {
    workId: 'w1', admin: true, format: 'glb', version: 'asset1',
  }, { onEvent: (event) => events.push(event) }, (error) => failure(error))
})
afterEach(() => { viewer.dispose(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })

async function connect() {
  await viewer.load(null)
  const peer = Peer.last
  peer.channel.receive({ v: 1, type: 'ready', info, capabilities: requiredRemoteCommands(info) })
  peer.ontrack?.({ track })
  return peer
}

describe('WebRTC 协议桩生命周期（不代表 GPU 性能）', () => {
  it('节点 ready 不能代替首帧；只申请接收视频，退出后关闭所有连接', async () => {
    const peer = await connect()
    expect(events.some((event) => event.type === 'ready')).toBe(false)
    frame(0, {} as VideoFrameCallbackMetadata)
    expect(events.some((event) => event.type === 'ready')).toBe(true)
    expect(peer.addTransceiver).toHaveBeenCalledExactlyOnceWith('video', { direction: 'recvonly' })
    expect(api.create.mock.calls[0]?.[0]).toMatchObject({ admin: true, version: 'asset1' })
    viewer.dispose()
    expect(peer.close).toHaveBeenCalledTimes(1)
    expect(peer.channel.close).toHaveBeenCalledTimes(1)
    expect(track.stop).toHaveBeenCalledTimes(1)
    expect(video.srcObject).toBeNull()
    expect(api.end).toHaveBeenCalledWith('s1')
    await vi.advanceTimersByTimeAsync(30_001)
    expect(api.request).not.toHaveBeenCalled()
    expect(failure).not.toHaveBeenCalled()
  })

  it('每 5 秒续租；租约过期触发一次失败并清理', async () => {
    await connect()
    frame(0, {} as VideoFrameCallbackMetadata)
    api.request.mockResolvedValue({ status: 'expired' })
    await vi.advanceTimersByTimeAsync(5001)
    expect(api.request).toHaveBeenCalledWith('/preview-sessions/s1/heartbeat', expect.objectContaining({ method: 'POST' }))
    expect(failure).toHaveBeenCalledTimes(1)
    expect(api.end).toHaveBeenCalledWith('s1')
  })

  it('连接超时后迟到的创建响应仍被结束，不能启动 PeerConnection', async () => {
    let release!: (value: unknown) => void
    api.create.mockReturnValue(new Promise((resolve) => { release = resolve }))
    const load = viewer.load(null)
    await vi.advanceTimersByTimeAsync(30_001)
    expect(failure).toHaveBeenCalledTimes(1)
    release(session)
    await load
    expect(api.end).toHaveBeenCalledWith('s1')
    expect(video.srcObject).toBeNull()
  })

  it('关键命令缺少确认会失败；失焦清空持续按键', async () => {
    const peer = await connect()
    frame(0, {} as VideoFrameCallbackMetadata)
    await Promise.resolve()
    peer.channel.send.mockImplementation(() => {})
    viewer.setMode('fly')
    video.dispatchEvent(new KeyboardEvent('keydown', { key: 'w' }))
    await vi.advanceTimersByTimeAsync(34)
    window.dispatchEvent(new Event('blur'))
    expect(peer.channel.send.mock.calls.map(([raw]) => JSON.parse(raw)).at(-1)).toMatchObject({ type: 'input', keys: [] })
    await vi.advanceTimersByTimeAsync(5001)
    expect(failure).toHaveBeenCalledTimes(1)
    expect(String(failure.mock.calls[0]?.[0])).toContain('未确认')
  })

  it('未提供完整能力时不冒充就绪；运行中断流只通知一次', async () => {
    await viewer.load(null)
    Peer.last.channel.receive({ v: 1, type: 'ready', info, capabilities: [] })
    Peer.last.onconnectionstatechange?.()
    expect(failure).toHaveBeenCalledTimes(1)
    expect(events.some((event) => event.type === 'ready')).toBe(false)
  })

  it('没有新视频帧时触发断流回收', async () => {
    await connect()
    frame(0, {} as VideoFrameCallbackMetadata)
    await vi.advanceTimersByTimeAsync(11_001)
    expect(String(failure.mock.calls[0]?.[0])).toContain('未更新')
  })
})

describe('降级与信令边界', () => {
  it.each([401, 403, 404, 409, 422])('%s 业务错误不触发自动降级', (status) => {
    expect(shouldFallback(new ApiError('业务错误', { status, code: 'BUSINESS_ERROR' }))).toBe(false)
  })
  it.each(['PREVIEW_BUSY', 'RENDERER_OFFLINE'])('%s 允许自动降级', (code) => {
    expect(shouldFallback(new ApiError('暂不可用', { status: 503, code }))).toBe(true)
  })
  it('网络和传输错误允许降级，主动取消不降级', () => {
    expect(shouldFallback(new Error('ICE failed'))).toBe(true)
    expect(shouldFallback(new DOMException('取消', 'AbortError'))).toBe(false)
  })
  it('拒绝跨域信令，不向外部地址发送 Cookie', async () => {
    await expect(exchangeOffer('https://other.example/offer', { type: 'offer', sdp: 'x' }, new AbortController().signal)).rejects.toThrow('同源')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('信令 401 即使不是 JSON 也保持业务错误，不自动降级', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }))
    try {
      await exchangeOffer('/rtc/offer', { type: 'offer', sdp: 'x' }, new AbortController().signal)
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError)
      expect(shouldFallback(error)).toBe(false)
    }
  })
})
