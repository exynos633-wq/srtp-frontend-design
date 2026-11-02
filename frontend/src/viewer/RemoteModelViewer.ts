import { apiRequest } from '../api/http'
import { createPreviewSession, endPreviewSession, exchangeOffer, sessionPath } from '../api/preview'
import type { RemotePreview } from '../api/preview'
import { REMOTE_COMMANDS } from './controller'
import type { RemoteCommand, ViewerController } from './controller'
import { RemoteInput } from './RemoteInput'
import { RemoteMedia } from './RemoteMedia'
import type { ModelInfo, ModelSource, ModelViewConfig, ModelViewerOptions, SourceUp, ViewerMode } from './types'

export function requiredRemoteCommands(info: ModelInfo): string[] {
  return [...REMOTE_COMMANDS.filter((name) => {
    if (name === 'setSplatScale') return info.format === 'gaussian-ply'
    if (name === 'setSoftLight') return info.format !== 'gaussian-ply'
    if (name === 'setEmission') return info.format === 'glb' && info.hasEmissive
    return true
  }), 'resize']
}

/** 与 ModelViewer 共用工具栏；此类不加载模型，也不创建 WebGL 上下文。 */
export class RemoteModelViewer implements ViewerController {
  private pc: RTCPeerConnection | null = null
  private channel: RTCDataChannel | null = null
  private sessionId: string | null = null
  private abort = new AbortController()
  private disposed = false
  private failed = false
  private started = false
  private frameReceived = false
  private info: ModelInfo | null = null
  private initialized = false
  private mode: ViewerMode = 'orbit'
  private input: RemoteInput | null = null
  private media: RemoteMedia
  private timers = new Set<ReturnType<typeof setTimeout>>()
  private heartbeat: ReturnType<typeof setInterval> | undefined
  private heartbeatPending = false
  private watchdog: ReturnType<typeof setInterval> | undefined
  private lastFrameAt = 0
  private frameCallback: number | null = null
  private observer: ResizeObserver | null = null
  private sequence = 0
  private acknowledgements = new Map<number, { timer: ReturnType<typeof setTimeout>; name: string }>()
  private events = new AbortController()

  private video: HTMLVideoElement
  private host: HTMLElement
  private remote: RemotePreview
  private options: ModelViewerOptions
  private onFailure: (error: unknown) => void

  constructor(video: HTMLVideoElement, host: HTMLElement,
    remote: RemotePreview, options: ModelViewerOptions, onFailure: (error: unknown) => void) {
    this.video = video
    this.host = host
    this.remote = remote
    this.options = options
    this.onFailure = onFailure
    this.media = new RemoteMedia(video, remote.workId, (event) => this.emit(event))
    window.addEventListener('pagehide', () => this.dispose(), { signal: this.events.signal })
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) void this.media.stopRecording('hidden')
      else this.lastFrameAt = performance.now()
    }, { signal: this.events.signal })
  }

  private emit(event: Parameters<NonNullable<ModelViewerOptions['onEvent']>>[0]) {
    if (!this.disposed && !this.failed) this.options.onEvent?.(event)
  }

  private later(fn: () => void, ms: number) {
    const timer = setTimeout(() => { this.timers.delete(timer); fn() }, ms)
    this.timers.add(timer)
    return timer
  }

  private fail = (error: unknown) => {
    if (this.disposed || this.failed) return
    this.failed = true
    this.dispose()
    this.onFailure(error)
  }

  async load(_source: ModelSource | null, config: ModelViewConfig = {}) {
    if (this.started || this.disposed) return
    this.started = true
    this.emit({ type: 'phase', phase: 'initialize', detail: '正在申请 GPU 渲染会话' })
    const timeout = this.later(() => this.fail(new Error('远程连接超过 30 秒。')), 30_000)
    try {
      const session = await createPreviewSession(this.remote, config, crypto.randomUUID())
      // 创建请求故意等到响应再清理：取消 fetch 不能取消服务器已分配的槽位。
      this.sessionId = session.sessionId
      if (this.disposed) { if (this.sessionId) void endPreviewSession(this.sessionId); return }
      const connection = session.connection
      if (!session.sessionId || !['creating', 'ready'].includes(session.status) ||
        connection?.kind !== 'webrtc' || connection.protocolVersion !== 1 || !Array.isArray(connection.iceServers)) {
        throw new Error('远程会话协议不兼容。')
      }
      this.emit({ type: 'phase', phase: 'initialize', detail: '正在建立远程画面连接' })
      this.pc = new RTCPeerConnection({ iceServers: connection.iceServers })
      const pc = this.pc
      pc.addTransceiver('video', { direction: 'recvonly' })
      this.channel = pc.createDataChannel('viewer-v1', { ordered: true })
      this.channel.onmessage = (event) => this.message(event.data)
      this.channel.onopen = () => this.ready(timeout)
      this.channel.onclose = () => this.fail(new Error('远程控制连接已断开。'))
      this.channel.onerror = () => this.fail(new Error('远程控制连接发生错误。'))
      pc.onconnectionstatechange = () => {
        if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) this.fail(new Error('远程画面连接已断开。'))
      }
      pc.ontrack = (event) => {
        if (event.track.kind !== 'video') return
        const stream = new MediaStream([event.track])
        this.video.srcObject = stream
        event.track.addEventListener('ended', () => this.fail(new Error('远程视频已结束。')), { signal: this.events.signal })
        const frame = () => {
          if (this.disposed) return
          this.frameReceived = true
          this.lastFrameAt = performance.now()
          this.ready(timeout)
          if (typeof this.video.requestVideoFrameCallback === 'function') this.frameCallback = this.video.requestVideoFrameCallback(frame)
        }
        if (typeof this.video.requestVideoFrameCallback === 'function') this.frameCallback = this.video.requestVideoFrameCallback(frame)
        else this.video.addEventListener('timeupdate', frame, { signal: this.events.signal })
        void this.video.play().catch(() => this.fail(new Error('浏览器未能播放远程画面。')))
      }
      await pc.setLocalDescription(await pc.createOffer())
      await this.gatherIce(pc)
      if (this.disposed) return
      const answer = await exchangeOffer(connection.offerUrl, pc.localDescription!, this.abort.signal)
      if (this.disposed) return
      await pc.setRemoteDescription(answer)
      if (!this.initialized) this.emit({ type: 'phase', phase: 'initialize', detail: '正在等待模型首帧与交互就绪' })
      this.heartbeat = setInterval(() => void this.renew(), 5000)
      this.watchdog = setInterval(() => {
        if (this.initialized && !document.hidden && performance.now() - this.lastFrameAt > 10_000) {
          this.fail(new Error('远程视频超过 10 秒未更新。'))
        }
      }, 1000)
    } catch (error) { this.fail(error) }
  }

  private gatherIce(pc: RTCPeerConnection): Promise<void> {
    if (pc.iceGatheringState === 'complete') return Promise.resolve()
    return new Promise((resolve, reject) => {
      const signal = this.abort.signal
      const cleanup = () => {
        pc.removeEventListener('icegatheringstatechange', change)
        signal.removeEventListener('abort', abort)
      }
      const change = () => { if (pc.iceGatheringState === 'complete') { cleanup(); resolve() } }
      const abort = () => { cleanup(); reject(new DOMException('已结束', 'AbortError')) }
      pc.addEventListener('icegatheringstatechange', change)
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) abort()
      else change()
    })
  }

  private async renew() {
    if (!this.sessionId || this.disposed || this.heartbeatPending) return
    this.heartbeatPending = true
    const signal = AbortSignal.any([this.abort.signal, AbortSignal.timeout(10_000)])
    try {
      const result = await apiRequest<{ status: string }>(`${sessionPath(this.sessionId)}/heartbeat`, { method: 'POST', signal })
      if (!['creating', 'ready'].includes(result.status)) throw new Error('远程会话已过期。')
    } catch (error) { this.fail(error) }
    finally { this.heartbeatPending = false }
  }

  private message(raw: unknown) {
    if (this.disposed) return
    try {
      if (typeof raw !== 'string' || raw.length > 64_000) throw new Error('远程消息格式无效。')
      const message = JSON.parse(raw)
      if (message.v !== 1) throw new Error('远程控制协议版本不一致。')
      if (message.type === 'ready') {
        const info = message.info as ModelInfo
        if (!info?.bounds?.min || !info.bounds.max || info.format !== this.remote.format ||
          !Array.isArray(message.capabilities) ||
          !requiredRemoteCommands(info).every((name) => message.capabilities.includes(name))) {
          throw new Error('远程节点尚未提供当前模型所需的完整功能。')
        }
        this.info = info
        this.media.setName(info.sourceName)
        this.ready()
      } else if (message.type === 'ack') {
        const pending = this.acknowledgements.get(message.id)
        if (!pending) return
        clearTimeout(pending.timer)
        this.acknowledgements.delete(message.id)
        if (message.ok !== true) throw new Error(message.message || '节点未能应用操作。')
        if (['setSourceUp', 'rotateOrientation', 'resetOrientation'].includes(pending.name)) {
          if (!message.info) throw new Error('节点未返回方向修改后的模型状态。')
          this.mode = 'orbit'
          this.emit({ type: 'mode', mode: 'orbit' })
        }
        if (message.info) { this.info = message.info; this.emit({ type: 'info', info: message.info }) }
      } else if (message.type === 'state') {
        if (message.mode === 'walk') this.setMode('orbit')
        if (['orbit', 'fly'].includes(message.mode)) {
          this.mode = message.mode
          this.emit({ type: 'mode', mode: this.mode })
        }
        if (typeof message.autoRotate?.enabled === 'boolean') {
          this.emit({ type: 'autoRotate', enabled: message.autoRotate.enabled, userDisabled: Boolean(message.autoRotate.userDisabled) })
        }
      } else if (message.type === 'error') {
        throw new Error(message.message || '远程渲染失败。')
      }
    } catch (error) { this.fail(error) }
  }

  private ready(timeout?: ReturnType<typeof setTimeout>) {
    if (this.disposed || this.initialized || !this.frameReceived || !this.info || this.channel?.readyState !== 'open') return
    this.initialized = true
    if (timeout) { clearTimeout(timeout); this.timers.delete(timeout) }
    // ready 消息和首帧的到达顺序不固定，因此清除仍在等待的连接超时。
    this.timers.forEach(clearTimeout)
    this.timers.clear()
    this.input = new RemoteInput(this.video, (value) => this.send(value), () => this.resetView())
    this.setAutoRotate(this.options.autoRotate ?? false)
    this.observer = new ResizeObserver(() => this.resize())
    this.observer.observe(this.host)
    this.resize()
    this.emit({ type: 'ready', info: this.info })
    this.emit({ type: 'phase', phase: 'ready' })
  }

  private send(value: object) {
    if (this.disposed || this.channel?.readyState !== 'open') return
    if (this.channel.bufferedAmount > 64 * 1024) {
      this.fail(new Error('远程控制通道拥塞。'))
      return
    }
    try { this.channel.send(JSON.stringify(value)) } catch (error) { this.fail(error) }
  }

  private command(name: RemoteCommand | 'resize', args: unknown[]) {
    if (!this.initialized || this.disposed) return
    const id = ++this.sequence
    this.acknowledgements.set(id, { timer: setTimeout(() => this.fail(new Error('节点超过 5 秒未确认操作。')), 5000), name })
    this.send({ v: 1, type: 'command', id, name, args })
  }

  private resize() {
    if (this.media.isRecording()) return
    const rect = this.video.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return
    const ratio = Math.min(1, 1280 / rect.width, 720 / rect.height)
    this.command('resize', [{ width: Math.max(2, Math.round(rect.width * ratio / 2) * 2),
      height: Math.max(2, Math.round(rect.height * ratio / 2) * 2) }])
  }

  setDprCap() { /* 远程分辨率受节点和视口限制，不使用本机 DPR。 */ }
  setSourceUp(up: SourceUp | null) { this.command('setSourceUp', [up]) }
  setBloom(enabled: boolean, strength?: number) { this.command('setBloom', [enabled, strength ?? 0.25]) }
  setBloomStrength(value: number) { this.command('setBloomStrength', [value]) }
  setUniformTone(value: boolean) { this.command('setUniformTone', [value]) }
  setSplatScale(value: number) { this.command('setSplatScale', [value]) }
  setSoftLight(enabled: boolean, intensity?: number) { this.command('setSoftLight', [enabled, intensity ?? 1]) }
  setEmission(enabled: boolean, intensity?: number) { this.command('setEmission', [enabled, intensity ?? 1.6]) }
  setFlySpeed(value: number) { this.command('setFlySpeed', [value]) }
  rotateOrientation(axis: 'x' | 'y' | 'z') { this.command('rotateOrientation', [axis]) }
  resetOrientation() { this.command('resetOrientation', []) }
  beginParameterInteraction() { this.clearUserInput(); this.command('beginParameterInteraction', []) }
  endParameterInteraction() { this.command('endParameterInteraction', []) }
  clearUserInput() { this.input?.clear(); this.command('clearUserInput', []) }
  setAutoRotate(enabled: boolean) {
    this.command('setAutoRotate', [enabled])
    this.emit({ type: 'autoRotate', enabled, userDisabled: !enabled })
  }
  setTouchEnabled(enabled: boolean) {
    if (this.input) { this.input.clear(); this.input.touchEnabled = enabled }
    this.video.style.touchAction = enabled ? 'none' : 'pan-y'
  }
  resetDisplay() { this.command('resetDisplay', []) }
  resetView() { this.clearUserInput(); this.command('resetView', []) }
  setMode(mode: ViewerMode) { this.clearUserInput(); this.mode = mode; this.command('setMode', [mode]); this.emit({ type: 'mode', mode }) }
  capturePng() { return this.media.capturePng() }
  isRecording() { return this.media.isRecording() }
  startRecording() { return this.media.startRecording() }
  async stopRecording(reason: Parameters<ViewerController['stopRecording']>[0]) {
    const result = await this.media.stopRecording(reason)
    if (!this.disposed) this.resize()
    return result
  }
  async reload() { /* 远程重试由外壳创建新实例。 */ }

  dispose() {
    if (this.disposed) return
    this.input?.dispose()
    this.disposed = true
    this.abort.abort()
    this.events.abort()
    this.media.dispose()
    this.observer?.disconnect()
    this.timers.forEach(clearTimeout)
    this.acknowledgements.forEach(({ timer }) => clearTimeout(timer))
    this.timers.clear()
    this.acknowledgements.clear()
    clearInterval(this.heartbeat)
    clearInterval(this.watchdog)
    if (this.frameCallback !== null) this.video.cancelVideoFrameCallback(this.frameCallback)
    if (this.channel) { this.channel.onclose = null; this.channel.onerror = null; this.channel.onmessage = null; this.channel.onopen = null; this.channel.close() }
    if (this.pc) { this.pc.onconnectionstatechange = null; this.pc.ontrack = null; this.pc.close() }
    const stream = this.video.srcObject as MediaStream | null
    stream?.getTracks().forEach((track) => track.stop())
    this.video.srcObject = null
    if (this.sessionId) void endPreviewSession(this.sessionId)
  }
}
