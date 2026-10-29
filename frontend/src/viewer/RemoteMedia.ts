import type { ModelViewerEvent, RecordingResult, RecordingStopReason } from './types'
import { RECORDING_TARGET_MS } from './types'
import { sanitizeFilename, timestampForFilename } from './viewerMath'

/** 仅处理浏览器已接收的画面，不取得设备媒体权限。 */
export class RemoteMedia {
  private recorder: MediaRecorder | null = null
  private done: Promise<RecordingResult | null> | null = null
  private timer: ReturnType<typeof setInterval> | undefined
  private stopped = false

  private video: HTMLVideoElement
  private name: string
  private emit: (event: ModelViewerEvent) => void

  constructor(video: HTMLVideoElement, name: string, emit: (event: ModelViewerEvent) => void) {
    this.video = video
    this.name = name
    this.emit = emit
  }

  isRecording() { return this.recorder !== null }
  setName(name: string) { this.name = name }

  async capturePng() {
    if (this.video.readyState < 2 || !this.video.videoWidth) throw new Error('尚无可截图的视频帧。')
    const canvas = document.createElement('canvas')
    canvas.width = this.video.videoWidth
    canvas.height = this.video.videoHeight
    const context = canvas.getContext('2d')
    if (!context) throw new Error('无法创建截图画布。')
    context.drawImage(this.video, 0, 0)
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
      (value) => value ? resolve(value) : reject(new Error('截图生成失败。')), 'image/png',
    ))
    const filename = `${sanitizeFilename(this.name)}-${timestampForFilename()}.png`
    this.emit({ type: 'screenshot', blob, filename })
    return { blob, filename }
  }

  async startRecording() {
    if (this.recorder) throw new Error('请等待上一段录制结束。')
    if (typeof MediaRecorder === 'undefined') throw new Error('浏览器不支持视频录制。')
    const mimeType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/mp4', 'video/webm']
      .find((value) => MediaRecorder.isTypeSupported(value))
    const source = this.video.srcObject as MediaStream | null
    if (!mimeType || !source?.getVideoTracks().some((track) => track.readyState === 'live')) {
      throw new Error('浏览器没有可录制的视频流或支持的格式。')
    }
    const stream = new MediaStream(source.getVideoTracks().map((track) => track.clone()))
    let recorder: MediaRecorder
    try { recorder = new MediaRecorder(stream, { mimeType }) } catch (error) {
      stream.getTracks().forEach((track) => track.stop())
      throw error
    }
    this.recorder = recorder
    const startedAt = performance.now()
    const chunks: Blob[] = []
    let reason: RecordingStopReason = 'complete'
    let failed = false
    const tick = () => {
      const elapsedMs = performance.now() - startedAt
      this.emit({ type: 'recording', state: { recording: true, elapsedMs,
        remainingMs: Math.max(0, RECORDING_TARGET_MS - elapsedMs), targetMs: RECORDING_TARGET_MS } })
      if (elapsedMs >= RECORDING_TARGET_MS) void this.stopRecording('complete')
    }
    recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data) }
    this.done = new Promise<RecordingResult | null>((resolve) => {
      recorder.onstop = () => {
        clearInterval(this.timer)
        stream.getTracks().forEach((track) => track.stop())
        this.recorder = null
        this.emit({ type: 'recording', state: { recording: false, elapsedMs: 0,
          remainingMs: RECORDING_TARGET_MS, targetMs: RECORDING_TARGET_MS } })
        const wallClockMs = performance.now() - startedAt
        const result: RecordingResult | null = failed || !chunks.length ? null : {
          blob: new Blob(chunks, { type: recorder.mimeType || mimeType }),
          mimeType: recorder.mimeType || mimeType,
          extension: mimeType.includes('mp4') ? 'mp4' : 'webm', sourceName: this.name,
          wallClockMs, complete: reason === 'complete' && wallClockMs >= RECORDING_TARGET_MS, reason,
        }
        if (result && !this.stopped) this.emit({ type: 'recordingReady', result })
        if (!result && !this.stopped) this.emit({ type: 'notice', message: '录制失败，未生成可下载的视频；请检查浏览器支持后重试。' })
        resolve(result)
      }
      recorder.onerror = () => { failed = true; reason = 'error'; if (recorder.state !== 'inactive') recorder.stop() }
      // reason is captured by onstop; stopRecording sets it through this callback.
      this.stopWithReason = (next) => { reason = next; if (recorder.state !== 'inactive') recorder.stop() }
    })
    try { recorder.start(250) } catch (error) {
      stream.getTracks().forEach((track) => track.stop())
      this.recorder = null
      this.done = null
      throw error
    }
    this.timer = setInterval(tick, 200)
    tick()
  }

  private stopWithReason: (reason: RecordingStopReason) => void = () => {}

  async stopRecording(reason: RecordingStopReason): Promise<RecordingResult | null> {
    if (!this.recorder) return null
    clearInterval(this.timer)
    this.stopWithReason(reason)
    return this.done
  }

  dispose() {
    this.stopped = true
    clearInterval(this.timer)
    void this.stopRecording('unmount')
  }
}
