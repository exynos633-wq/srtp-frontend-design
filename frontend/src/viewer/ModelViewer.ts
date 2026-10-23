import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { SparkRenderer } from '@sparkjsdev/spark'
import { AutoRotateClock } from './autoRotate'
import { ViewerError, isAbortError, toViewerErrorInfo } from './errors'
import { buildModel, type LoadedModel } from './loadModel'
import { readModelSource } from './source'
import { TaskGate, SerialTaskQueue } from './taskGate'
import type {
  ModelInfo,
  ModelSource,
  ModelViewConfig,
  ModelViewerEvent,
  ModelViewerOptions,
  OrientationCorrection,
  RecordingResult,
  RecordingState,
  RecordingStopReason,
  ViewerErrorInfo,
  SourceUp,
  ViewerMode,
  ViewerPhase,
  ViewerStats,
} from './types'
import {
  DEFAULT_AUTO_ROTATE_SPEED,
  DEFAULT_DPR_CAP,
  DEFAULT_RESUME_DELAY_MS,
  RECORDING_TARGET_MS,
} from './types'
import {
  assertFiniteBounds,
  cameraYawPitch,
  directionFromYawPitch,
  downloadBlob,
  fitCameraToBounds,
  isLowPowerDevice,
  pickRecordingMime,
  recordingSize,
  resolveDpr,
  sanitizeFilename,
  sourceUpRotation,
  timestampForFilename,
} from './viewerMath'

const sharedQueue = new SerialTaskQueue()

interface CameraSnapshot {
  position: THREE.Vector3
  quaternion: THREE.Quaternion
  target: THREE.Vector3
}

interface RecordingSession {
  recorder: MediaRecorder
  stream: MediaStream
  canvas: HTMLCanvasElement
  context: CanvasRenderingContext2D
  width: number
  height: number
  startedAt: number
  chunks: Blob[]
  mimeType: string
  extension: 'webm' | 'mp4'
  interval: number | null
  timeout: number | null
  stopped: boolean
  epoch: number
  sourceName: string
  hadError: boolean
}

interface DisplayState {
  bloom: boolean
  bloomStrength: number
  uniformTone: boolean
  splatScale: number
  softLight: boolean
  lightIntensity: number
  emission: boolean
  emissionIntensity: number
}

const DISPLAY_DEFAULTS: DisplayState = {
  bloom: false,
  bloomStrength: 0.25,
  uniformTone: false,
  splatScale: 1,
  softLight: true,
  lightIntensity: 1,
  emission: false,
  emissionIntensity: 1.6,
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function normalizeOrientation(value?: OrientationCorrection | null): OrientationCorrection {
  const normalize = (count: number | undefined) =>
    Number.isFinite(count) ? ((Math.round(count!) % 4) + 4) % 4 : 0
  return { x: normalize(value?.x), y: normalize(value?.y), z: normalize(value?.z) }
}

function isTextInput(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName.toLowerCase()
  return (
    tag === 'input' ||
    tag === 'textarea' ||
    tag === 'select' ||
    target.isContentEditable ||
    target.closest('[data-viewer-shortcut-ignore="true"]') !== null
  )
}

/**
 * 原生 Three 渲染核心。一个容器一个 canvas、一个 RAF；Spark 与 GLB 不经过
 * 首页 Fiber 地球，也不使用 React 逐帧 setState。
 */
export class ModelViewer {
  readonly canvas: HTMLCanvasElement
  private readonly host: HTMLElement
  private readonly options: ModelViewerOptions

  private renderer: THREE.WebGLRenderer
  private scene: THREE.Scene
  private camera: THREE.PerspectiveCamera
  private composer: EffectComposer
  private renderPass: RenderPass
  private bloomPass: UnrealBloomPass
  private outputPass: OutputPass
  private readonly gate = new TaskGate()

  private sparkRenderer: SparkRenderer | null = null
  private model: LoadedModel | null = null
  private source: ModelSource | null = null
  private config: ModelViewConfig = {}

  private phase: ViewerPhase = 'idle'
  private error: ViewerErrorInfo | null = null
  private info: ModelInfo | null = null
  private mode: ViewerMode = 'orbit'

  private orbitTarget = new THREE.Vector3()
  private orbitAzimuth = 0
  private orbitPolar = Math.PI / 3
  private orbitRadius = 1
  private minDistance = 0.01
  private maxDistance = 100

  private yaw = 0
  private pitch = 0
  private initialCamera: CameraSnapshot | null = null
  private boundsCenter = new THREE.Vector3()
  private boundsRadius = 1
  private groundHeight = 0
  private eyeHeight = 0.1
  private sourceUpOverride: SourceUp | null = null
  private orientationCorrection: OrientationCorrection = { x: 0, y: 0, z: 0 }
  private directionInvalidatedWalk = false
  private walkSetup: { ground: number; eyeHeight: number; start: [number, number] } | null = null
  private flySpeed: number
  private walkSpeed: number

  private display: DisplayState = { ...DISPLAY_DEFAULTS }
  private lights: THREE.Group | null = null
  private hemiLight: THREE.HemisphereLight | null = null
  private dirLight: THREE.DirectionalLight | null = null
  private ambientLight: THREE.AmbientLight | null = null

  private readonly autoRotate: AutoRotateClock
  private touchEnabled = false
  private keys = new Set<string>()
  private capturedPointers = new Set<number>()
  private drag: {
    kind: 'rotate' | 'pan' | 'look' | 'walkClick'
    pointerId: number
    startX: number
    startY: number
    lastX: number
    lastY: number
    moved: boolean
  } | null = null
  private parameterInteractionActive = false
  private touchPointers = new Map<number, { x: number; y: number }>()
  private touchLast: { x: number; y: number; distance: number; midX: number; midY: number } | null = null

  private raf: number | null = null
  private lastFrameAt = 0
  private lastStatsAt = 0
  private frameTimes: number[] = []
  private lastStats: ViewerStats | null = null
  private visible = true
  private intersectionVisible = true
  private disposed = false
  private resizeObserver: ResizeObserver | null = null

  private recording: RecordingSession | null = null
  private stoppingPromise: Promise<RecordingResult | null> | null = null
  private activeStopSession: RecordingSession | null = null
  private recordingEpoch = 0
  private lastRecording: RecordingResult | null = null
  private lastRecordingTrackStates: string[] = []
  private timings: {
    loadStart: number
    readEnd: number
    parseStart: number
    initializeStart: number
    ready: number
    firstFrame: number
  } = { loadStart: 0, readEnd: 0, parseStart: 0, initializeStart: 0, ready: 0, firstFrame: 0 }

  constructor(canvas: HTMLCanvasElement, host: HTMLElement, options: ModelViewerOptions = {}) {
    this.canvas = canvas
    this.host = host
    this.options = options
    this.phase = 'idle'
    this.flySpeed = options.flySpeed ?? 0.6
    this.walkSpeed = options.walkSpeed ?? 0.3
    const lowPower = options.lowPower ?? isLowPowerDevice()
    const dpr = resolveDpr(options.dprCap ?? DEFAULT_DPR_CAP, lowPower)

    const context = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: true,
      stencil: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    })
    if (!context) throw new ViewerError('WEBGL2_UNAVAILABLE')

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      context,
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    })
    this.renderer.setPixelRatio(dpr)
    this.renderer.info.autoReset = false
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.NoToneMapping
    this.renderer.setClearColor(0x080d12, 1)

    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(options.backgroundColor ?? 0x080d12)
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000)
    this.camera.up.set(0, 0, 1)

    this.composer = new EffectComposer(this.renderer)
    this.composer.setPixelRatio(dpr)
    this.renderPass = new RenderPass(this.scene, this.camera)
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.25, 0.45, 0.2)
    this.bloomPass.enabled = false
    this.outputPass = new OutputPass()
    this.composer.addPass(this.renderPass)
    this.composer.addPass(this.bloomPass)
    this.composer.addPass(this.outputPass)

    this.autoRotate = new AutoRotateClock({
      enabled: options.autoRotate ?? !options.reducedMotion,
      speed: options.autoRotateSpeed ?? DEFAULT_AUTO_ROTATE_SPEED,
      resumeDelayMs: options.resumeDelayMs ?? DEFAULT_RESUME_DELAY_MS,
      now: performance.now(),
    })

    this.resize()
    this.bindEvents()
    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(canvas)
    this.setPhase('idle')
  }

  getPhase(): ViewerPhase {
    return this.phase
  }

  getError(): ViewerErrorInfo | null {
    return this.error
  }

  getModelInfo(): ModelInfo | null {
    return this.info
  }

  getMode(): ViewerMode {
    return this.mode
  }

  isReady(): boolean {
    return this.phase === 'ready' && this.model !== null
  }

  isRecording(): boolean {
    return this.recording !== null
  }

  getAutoRotate(): { enabled: boolean; userDisabled: boolean } {
    return {
      enabled: this.autoRotate.isEnabled,
      userDisabled: this.autoRotate.isUserDisabled,
    }
  }

  getLastRecording(): RecordingResult | null {
    return this.lastRecording
  }

  getStats(): ViewerStats | null {
    return this.lastStats
  }

  getDebugState(): Record<string, unknown> {
    const effectiveWalk = this.effectiveWalkConfig()
    return {
      phase: this.phase,
      mode: this.mode,
      error: this.error,
      info: this.info,
      stats: this.lastStats,
      autoRotate: this.getAutoRotate(),
      recording: this.recording
        ? {
            elapsedMs: performance.now() - this.recording.startedAt,
            width: this.recording.width,
            height: this.recording.height,
            liveTracks: this.recording.stream.getTracks().filter((track) => track.readyState === 'live').length,
          }
        : null,
      stopping: this.stoppingPromise !== null,
      lastRecordingTrackStates: [...this.lastRecordingTrackStates],
      camera: {
        position: this.camera.position.toArray(),
        quaternion: this.camera.quaternion.toArray(),
        up: this.camera.up.toArray(),
        target: this.orbitTarget.toArray(),
        near: this.camera.near,
        far: this.camera.far,
      },
      display: { ...this.display },
      sourceUpOverride: this.sourceUpOverride,
      orientation: { ...this.orientationCorrection },
      speed: { fly: this.flySpeed, walk: this.walkSpeed },
      walk: {
        ground: effectiveWalk.ground,
        eyeHeight: effectiveWalk.eyeHeight,
        start: effectiveWalk.start,
        areaTrusted: effectiveWalk.areaTrusted,
      },
      timings: { ...this.timings },
    }
  }

  setDprCap(cap: number, lowPower = false): void {
    const dpr = resolveDpr(cap, lowPower)
    this.renderer.setPixelRatio(dpr)
    this.composer.setPixelRatio(dpr)
    this.resize()
  }

  async load(source: ModelSource | null, config: ModelViewConfig = {}): Promise<void> {
    if (this.disposed) return
    this.source = source
    this.config = config
    this.error = null
    this.stopLoop()
    this.releaseModel()
    this.info = null
    this.canvas.style.cursor = 'default'

    const { generation, signal } = this.gate.begin()
    // 新模型使旧录制的发布失效；停止事件即使随后到达也不能用新 info 命名/覆盖 UI。
    this.recordingEpoch += 1
    if (this.recording) void this.stopRecording('replace')
    this.parameterInteractionActive = false
    this.clearInput()
    this.sourceUpOverride = config.sourceUp ?? null
    this.orientationCorrection = normalizeOrientation(config.orientation)
    this.directionInvalidatedWalk = false
    this.walkSetup = null
    this.mode = 'orbit'
    this.autoRotate.pause(performance.now())
    this.emit({ type: 'mode', mode: 'orbit' })
    this.timings = { loadStart: performance.now(), readEnd: 0, parseStart: 0, initializeStart: 0, ready: 0, firstFrame: 0 }

    try {
      if (!source) throw new ViewerError('NO_SOURCE')
      this.setPhase('read')
      let lastProgressAt = 0
      const { buffer, name } = await readModelSource(source, signal, (progress) => {
        if (!this.gate.isCurrent(generation)) return
        const now = performance.now()
        const complete = progress.totalBytes !== null && progress.loadedBytes >= progress.totalBytes
        if (!complete && now - lastProgressAt < 80) return
        lastProgressAt = now
        this.emit({ type: 'progress', progress })
      })
      if (!this.gate.isCurrent(generation)) return
      this.timings.readEnd = performance.now()

      const built = await sharedQueue.run(
        () =>
          buildModel(buffer, {
            sourceName: source.name ?? name,
            scale: config.scale ?? 1,
            signal,
            onPhase: (phase) => {
              if (!this.gate.isCurrent(generation)) return
              if (phase === 'parse') this.timings.parseStart = performance.now()
              if (phase === 'initialize') this.timings.initializeStart = performance.now()
              this.setPhase(phase)
            },
          }),
        signal,
      )

      if (!this.gate.isCurrent(generation)) {
        built.dispose()
        this.releaseSpark()
        return
      }

      this.attachModel(built)
      this.timings.ready = performance.now()
      this.setPhase('ready')
      this.emitAutoRotate()
      this.autoRotate.start(performance.now())
      this.startLoop()
      this.emit({ type: 'ready', info: built.info })
      this.emitStats()
    } catch (failure) {
      if (!this.gate.isCurrent(generation)) {
        if (!isAbortError(failure)) {
          // 迟到错误不能覆盖新任务；这里不写状态。
        }
        return
      }
      if (isAbortError(failure) && signal.aborted) {
        this.setPhase('idle')
        return
      }
      this.releaseModel()
      this.error = toViewerErrorInfo(failure)
      this.setPhase('error')
      if (this.recording) void this.stopRecording('error')
      this.emit({ type: 'error', error: this.error })
    }
  }

  async reload(): Promise<void> {
    if (!this.source) {
      this.error = toViewerErrorInfo(new ViewerError('NO_SOURCE'))
      this.setPhase('error')
      this.emit({ type: 'error', error: this.error })
      return
    }
    await this.load(this.source, this.config)
  }

  setMode(mode: ViewerMode): void {
    if (this.mode === mode) return
    this.parameterInteractionActive = false
    this.clearInput()
    this.mode = mode
    const now = performance.now()
    if (mode === 'orbit') {
      const forward = new THREE.Vector3()
      this.camera.getWorldDirection(forward)
      const distance = Math.max(this.orbitRadius, this.boundsRadius * 0.5)
      this.orbitTarget.copy(this.camera.position).addScaledVector(forward, distance)
      this.syncOrbitFromCamera()
      this.autoRotate.resume(now)
    } else {
      this.syncYawPitchFromCamera()
      if (mode === 'walk') this.enterWalkPose()
      this.autoRotate.pause(now)
    }
    this.emit({ type: 'mode', mode })
    this.emitAutoRotate()
  }

  setAutoRotate(enabled: boolean): void {
    this.autoRotate.setUserEnabled(enabled, performance.now())
    this.emitAutoRotate()
  }

  setTouchEnabled(enabled: boolean): void {
    this.touchEnabled = enabled
    this.canvas.style.touchAction = enabled ? 'none' : 'pan-y'
    if (!enabled) {
      this.touchPointers.clear()
      this.touchLast = null
      this.clearInput()
    }
  }

  noteParameterInteraction(): void {
    this.autoRotate.noteInteraction(performance.now())
  }

  /** 滑块/输入框按住期间调用；松开前不会因 15 秒计时恢复旋转。 */
  beginParameterInteraction(): void {
    this.parameterInteractionActive = true
    this.autoRotate.beginInteraction(performance.now())
  }

  endParameterInteraction(): void {
    this.parameterInteractionActive = false
    this.autoRotate.endInteraction(performance.now())
  }

  /** 打开页内模态、全屏切换或宿主接管交互时清理按键与拖拽。 */
  clearUserInput(): void {
    this.parameterInteractionActive = false
    this.clearInput()
    this.autoRotate.endInteraction(performance.now())
  }

  setBloom(enabled: boolean, strength = this.display.bloomStrength): void {
    this.display.bloom = enabled
    this.display.bloomStrength = clamp(strength, 0, 1.5)
    this.bloomPass.enabled = enabled
    this.bloomPass.strength = this.display.bloomStrength
    this.noteParameterInteraction()
  }

  setBloomStrength(strength: number): void {
    this.display.bloomStrength = clamp(strength, 0, 1.5)
    this.bloomPass.strength = this.display.bloomStrength
    this.noteParameterInteraction()
  }

  setUniformTone(enabled: boolean): void {
    this.display.uniformTone = enabled
    this.model?.setSplatTone(enabled ? 1 : 0)
    this.model?.setGlbTone(enabled)
    this.noteParameterInteraction()
  }

  setSplatScale(scale: number): void {
    this.display.splatScale = clamp(scale, 0.1, 5)
    this.model?.setSplatScale(this.display.splatScale)
    this.noteParameterInteraction()
  }

  setSoftLight(enabled: boolean, intensity = this.display.lightIntensity): void {
    this.display.softLight = enabled
    this.display.lightIntensity = clamp(intensity, 0, 2)
    this.applyLights()
    this.noteParameterInteraction()
  }

  setEmission(enabled: boolean, intensity = this.display.emissionIntensity): void {
    this.display.emission = enabled
    this.display.emissionIntensity = clamp(intensity, 0.1, 3)
    this.model?.setEmissive(enabled, this.display.emissionIntensity)
    this.noteParameterInteraction()
  }

  resetDisplay(): void {
    this.display = { ...DISPLAY_DEFAULTS }
    this.bloomPass.enabled = false
    this.bloomPass.strength = this.display.bloomStrength
    this.model?.setSplatScale(1)
    this.model?.setSplatTone(0)
    this.model?.setGlbTone(false)
    this.model?.setEmissive(false, this.display.emissionIntensity)
    this.applyLights()
    this.noteParameterInteraction()
    this.emitAutoRotate()
  }

  resetView(): void {
    this.clearInput()
    if (!this.initialCamera) return
    this.camera.position.copy(this.initialCamera.position)
    this.camera.quaternion.copy(this.initialCamera.quaternion)
    this.camera.up.set(0, 0, 1)
    this.orbitTarget.copy(this.initialCamera.target)
    this.syncOrbitFromCamera()
    this.syncYawPitchFromCamera()
    if (this.mode === 'walk') this.enterWalkPose()
    this.autoRotate.noteInteraction(performance.now())
  }

  async capturePng(): Promise<{ blob: Blob; filename: string }> {
    if (!this.isReady()) throw new ViewerError('SCREENSHOT_FAILED', '模型尚未就绪。')
    this.renderer.info.reset()
    this.composer.render()
    const blob = await new Promise<Blob | null>((resolve) => {
      this.canvas.toBlob((value) => resolve(value), 'image/png')
    })
    if (!blob || blob.size === 0) throw new ViewerError('SCREENSHOT_FAILED')
    const filename = `${sanitizeFilename(this.info?.sourceName ?? 'model')}-${timestampForFilename()}.png`
    this.emit({ type: 'screenshot', blob, filename })
    return { blob, filename }
  }

  async startRecording(): Promise<void> {
    if (!this.isReady()) throw new ViewerError('RECORDING_UNSUPPORTED', '模型尚未就绪。')
    if (this.stoppingPromise) throw new ViewerError('RECORDING_BUSY')
    if (this.recording) return
    const mime = pickRecordingMime()
    if (!mime || typeof HTMLCanvasElement.prototype.captureStream !== 'function') {
      throw new ViewerError('RECORDING_UNSUPPORTED')
    }
    const pixelWidth = this.canvas.width
    const pixelHeight = this.canvas.height
    const size = recordingSize(pixelWidth, pixelHeight)
    const recordCanvas = document.createElement('canvas')
    recordCanvas.width = size.width
    recordCanvas.height = size.height
    const context = recordCanvas.getContext('2d')
    if (!context) throw new ViewerError('RECORDING_UNSUPPORTED', '无法创建录制画布。')

    let stream: MediaStream
    try {
      stream = recordCanvas.captureStream(30)
    } catch (error) {
      throw new ViewerError('RECORDING_UNSUPPORTED', undefined, error)
    }
    let recorder: MediaRecorder
    try {
      recorder = new MediaRecorder(stream, { mimeType: mime.mimeType, videoBitsPerSecond: 6_000_000 })
    } catch (error) {
      stream.getTracks().forEach((track) => track.stop())
      throw new ViewerError('RECORDING_UNSUPPORTED', undefined, error)
    }

    this.recordingEpoch += 1
    const sessionEpoch = this.recordingEpoch
    const sourceName = this.info?.sourceName ?? 'model'
    const chunks: Blob[] = []
    recorder.addEventListener('dataavailable', (event) => {
      if (event.data.size > 0) chunks.push(event.data)
    })
    recorder.addEventListener('error', () => {
      session.hadError = true
      // 若完整停止已开始，error 仍由已有 stoppingPromise 发布，但原因必须是 error。
      if (this.recording === session) void this.stopRecording('error')
    })
    const session: RecordingSession = {
      recorder,
      stream,
      canvas: recordCanvas,
      context,
      width: size.width,
      height: size.height,
      startedAt: performance.now(),
      chunks,
      mimeType: mime.mimeType,
      extension: mime.extension,
      interval: null,
      timeout: null,
      stopped: false,
      epoch: sessionEpoch,
      sourceName,
      hadError: false,
    }
    this.recording = session
    try {
      recorder.start(1000)
    } catch (error) {
      this.recording = null
      stream.getTracks().forEach((track) => track.stop())
      throw new ViewerError('RECORDING_UNSUPPORTED', undefined, error)
    }
    session.interval = window.setInterval(() => this.emitRecording(), 250)
    session.timeout = window.setTimeout(() => {
      void this.stopRecording('complete')
    }, RECORDING_TARGET_MS)
    this.emitRecording()
  }

  async stopRecording(reason: RecordingStopReason): Promise<RecordingResult | null> {
    // 所有终止路径共享同一个 promise；完成前 startRecording 会被 RECORDING_BUSY 拒绝。
    if (this.stoppingPromise) return this.stoppingPromise
    const session = this.recording
    if (!session) return null
    this.recording = null
    if (session.stopped) return null
    session.stopped = true
    if (session.interval !== null) window.clearInterval(session.interval)
    if (session.timeout !== null) window.clearTimeout(session.timeout)
    const wallClockMs = Math.min(RECORDING_TARGET_MS, performance.now() - session.startedAt)
    this.activeStopSession = session
    const stopping = new Promise<RecordingResult>((resolve) => {
      const finish = () => {
        const finalReason = session.hadError ? 'error' : reason
        session.stream.getTracks().forEach((track) => track.stop())
        this.lastRecordingTrackStates = session.stream.getTracks().map((track) => track.readyState)
        const blob = new Blob(session.chunks, { type: session.mimeType })
        const hasData = session.chunks.some((chunk) => chunk.size > 0)
        resolve({
          blob,
          mimeType: session.mimeType,
          extension: session.extension,
          wallClockMs,
          sourceName: session.sourceName,
          complete:
            finalReason === 'complete' &&
            hasData &&
            wallClockMs >= RECORDING_TARGET_MS - 500 &&
            blob.size > 0,
          reason: finalReason,
        })
      }
      if (session.recorder.state === 'inactive') {
        finish()
        return
      }
      session.recorder.addEventListener('stop', finish, { once: true })
      try {
        session.recorder.stop()
      } catch {
        finish()
      }
    })
    const promise = stopping
      .then((result) => {
        this.lastRecording = result
        // 录制所属模型代际失效（load/end/新录制）或卸载后，旧结果不得下载/覆盖 UI。
        const current = !this.disposed && session.epoch === this.recordingEpoch
        if (current && this.options.autoDownloadRecording !== false && (result.reason === 'complete' || result.reason === 'manual')) {
          const filename = `${sanitizeFilename(result.sourceName)}-${timestampForFilename()}.${result.extension}`
          downloadBlob(result.blob, filename)
        }
        if (current) {
          this.emit({ type: 'recordingReady', result })
        }
        // 即使结果因替换失效，也要让 UI 退出“录制中”；只是不发布 ready 结果。
        if (!this.disposed) this.emitRecording()
        return result
      })
      .finally(() => {
        if (this.activeStopSession === session) this.activeStopSession = null
        if (this.stoppingPromise === promise) this.stoppingPromise = null
      })
    this.stoppingPromise = promise
    return promise
  }

  async end(): Promise<void> {
    if (this.phase === 'ended') return
    this.gate.cancel()
    this.stopLoop()
    this.recordingEpoch += 1
    this.parameterInteractionActive = false
    this.clearInput()
    this.autoRotate.pause(performance.now())
    if (this.recording) await this.stopRecording('end')
    this.releaseModel()
    this.setPhase('ended')
    this.emit({ type: 'ended' })
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.recordingEpoch += 1
    this.gate.cancel()
    this.stopLoop()
    this.parameterInteractionActive = false
    this.clearInput()
    if (this.recording) {
      // 卸载时不自动下载；只清理 track/recorder/timer。
      const session = this.recording
      this.recording = null
      if (session.interval !== null) window.clearInterval(session.interval)
      if (session.timeout !== null) window.clearTimeout(session.timeout)
      try {
        if (session.recorder.state !== 'inactive') session.recorder.stop()
      } catch {
        // 已停止。
      }
      session.stream.getTracks().forEach((track) => track.stop())
    }
    this.unbindEvents()
    this.resizeObserver?.disconnect()
    this.resizeObserver = null
    const lastInfo = this.info
    this.releaseModel()
    if (import.meta.env.DEV) {
      ;(window as unknown as { __srtpLastViewerDisposal?: unknown }).__srtpLastViewerDisposal = {
        at: Date.now(),
        info: lastInfo ? { format: lastInfo.format, bytes: lastInfo.bytes } : null,
        lastStats: this.lastStats,
        timings: { ...this.timings },
        geometries: this.renderer.info.memory.geometries,
        textures: this.renderer.info.memory.textures,
        recording: null,
        videoTracks: 0,
      }
    }
    this.bloomPass.dispose()
    this.outputPass.dispose()
    this.composer.dispose()
    this.renderer.dispose()
  }

  private attachModel(model: LoadedModel): void {
    this.releaseModel()
    this.model = model
    this.scene.add(model.object)
    if (model.format === 'gaussian-ply') {
      this.sparkRenderer = new SparkRenderer({ renderer: this.renderer })
      this.scene.add(this.sparkRenderer)
    }
    const up = this.effectiveSourceUp(model)
    this.applyModelTransform(model, up)
    const bounds = model.recomputeBounds()
    assertFiniteBounds(bounds)
    model.info.bounds = bounds
    model.info.sourceUp = up
    model.info.orientation = { ...this.orientationCorrection }
    model.bounds = bounds
    this.info = model.info
    this.boundsCenter.set(...bounds.center)
    const size = new THREE.Vector3(...bounds.size)
    this.boundsRadius = Math.max(size.length() / 2, 1e-5)
    this.setupLights(model.format === 'glb')
    this.setupCamera(model)

    this.model.setSplatScale(this.display.splatScale)
    this.model.setSplatTone(this.display.uniformTone ? 1 : 0)
    this.model.setGlbTone(this.display.uniformTone)
    this.model.setEmissive(this.display.emission, this.display.emissionIntensity)
    this.applyLights()
    this.syncOrbitFromCamera()
    this.syncYawPitchFromCamera()
  }

  private effectiveSourceUp(model: LoadedModel): SourceUp {
    if (this.sourceUpOverride) return this.sourceUpOverride
    // 按真实内容格式选择默认：GLB 是 glTF 标准 Y-up，3DGS PLY 缺方向元数据按 Z-up。
    return model.format === 'glb' ? 'y' : 'z'
  }

  private applyModelTransform(model: LoadedModel, up: SourceUp): void {
    const base = new THREE.Quaternion().setFromEuler(sourceUpRotation(up))
    const correction = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(
        (this.orientationCorrection.x * Math.PI) / 2,
        (this.orientationCorrection.y * Math.PI) / 2,
        (this.orientationCorrection.z * Math.PI) / 2,
        'XYZ',
      ),
    )
    model.object.quaternion.copy(correction).multiply(base)
    model.object.scale.setScalar(this.config.scale ?? 1)
    model.object.updateMatrixWorld(true)
  }

  setSourceUp(up: SourceUp | null): void {
    this.sourceUpOverride = up
    this.orientationCorrection = { x: 0, y: 0, z: 0 }
    this.applyDirectionChange()
    this.noteParameterInteraction()
  }

  rotateOrientation(axis: 'x' | 'y' | 'z'): void {
    this.orientationCorrection = {
      ...this.orientationCorrection,
      [axis]: (this.orientationCorrection[axis] + 1) % 4,
    }
    this.applyDirectionChange()
    this.noteParameterInteraction()
  }

  resetOrientation(): void {
    this.orientationCorrection = { x: 0, y: 0, z: 0 }
    this.applyDirectionChange()
    this.noteParameterInteraction()
  }

  private applyDirectionChange(): void {
    const model = this.model
    if (!model) return
    const up = this.effectiveSourceUp(model)
    this.applyModelTransform(model, up)
    const bounds = model.recomputeBounds()
    assertFiniteBounds(bounds)
    model.bounds = bounds
    model.info.bounds = bounds
    model.info.sourceUp = up
    model.info.orientation = { ...this.orientationCorrection }
    this.info = model.info
    this.boundsCenter.set(...bounds.center)
    const size = new THREE.Vector3(...bounds.size)
    this.boundsRadius = Math.max(size.length() / 2, 1e-5)
    this.directionInvalidatedWalk = true
    this.walkSetup = null
    this.setupGroundAndEye()
    this.setupLights(model.format === 'glb')
    this.applyLights()
    this.setupCamera(model, false)
    this.syncOrbitFromCamera()
    this.syncYawPitchFromCamera()
    if (this.mode !== 'orbit') this.setMode('orbit')
    this.emit({ type: 'info', info: { ...model.info, bounds } })
  }

  private setupCamera(model: LoadedModel, useConfiguredInitial = true): void {
    const rect = this.canvas.getBoundingClientRect()
    const aspect = rect.width > 0 && rect.height > 0 ? rect.width / rect.height : 1
    const fit = fitCameraToBounds(model.info.bounds, aspect)
    this.minDistance = fit.minDistance
    this.maxDistance = fit.maxDistance
    this.camera.near = fit.near
    this.camera.far = fit.far
    this.camera.updateProjectionMatrix()

    let position = fit.position.clone()
    let target = fit.target.clone()
    if (useConfiguredInitial && this.config.initialCamera?.position) {
      position = new THREE.Vector3(...this.config.initialCamera.position)
    }
    if (useConfiguredInitial && this.config.initialCamera?.target) {
      target = new THREE.Vector3(...this.config.initialCamera.target)
    }
    this.camera.position.copy(position)
    this.camera.up.set(0, 0, 1)
    this.camera.lookAt(target)
    this.initialCamera = {
      position: position.clone(),
      quaternion: this.camera.quaternion.clone(),
      target: target.clone(),
    }

    this.setupGroundAndEye()
  }

  private setupGroundAndEye(): void {
    const effective = this.effectiveWalkConfig()
    this.groundHeight = effective.ground
    this.eyeHeight = effective.eyeHeight
  }

  /**
   * Walk 的唯一有效配置来源。方向改变后旧 ground/eye/start/area 全部作废；
   * 不可信 area 既不参与起点夹取，也不参与点击传送。
   */
  private effectiveWalkConfig(): {
    ground: number
    eyeHeight: number
    start: [number, number]
    area: ModelViewConfig['walkArea']
    areaTrusted: boolean
  } {
    const bounds = this.info?.bounds
    const host = this.directionInvalidatedWalk
      ? { ground: undefined, eyeHeight: undefined, start: undefined, area: null, areaTrusted: false }
      : {
          ground: this.config.ground?.height,
          eyeHeight: this.config.eyeHeight,
          start: this.config.walkStart ?? undefined,
          area: this.config.walkAreaTrusted ? this.config.walkArea ?? null : null,
          areaTrusted: Boolean(this.config.walkArea && this.config.walkAreaTrusted),
        }
    const start: [number, number] =
      this.walkSetup?.start ?? host.start ?? [this.camera.position.x, this.camera.position.y]
    return {
      ground: this.walkSetup?.ground ?? host.ground ?? bounds?.min[2] ?? 0,
      eyeHeight: this.walkSetup?.eyeHeight ?? host.eyeHeight ?? Math.max(this.boundsRadius * 0.08, 0.001),
      start,
      area: host.area,
      areaTrusted: host.areaTrusted,
    }
  }

  getWalkDefaults(): {
    ground: number
    eyeHeight: number
    start: [number, number]
    area: ModelViewConfig['walkArea']
    areaTrusted: boolean
  } {
    return this.effectiveWalkConfig()
  }

  configureWalk(config: { ground: number; eyeHeight: number; start: [number, number] }): void {
    const { ground, eyeHeight, start } = config
    if (
      !Number.isFinite(ground) ||
      !Number.isFinite(eyeHeight) ||
      eyeHeight <= 0 ||
      !Number.isFinite(start[0]) ||
      !Number.isFinite(start[1])
    ) {
      throw new ViewerError('INVALID_BOUNDS', '步行参数必须是有限数值，视角高必须大于 0。')
    }
    this.walkSetup = { ground, eyeHeight, start }
    this.groundHeight = ground
    this.eyeHeight = eyeHeight
    if (this.mode === 'walk') this.enterWalkPose()
    this.noteParameterInteraction()
  }

  setFlySpeed(value: number): void {
    if (Number.isFinite(value) && value > 0) this.flySpeed = clamp(value, 0.05, 5)
    this.noteParameterInteraction()
  }

  setWalkSpeed(value: number): void {
    if (Number.isFinite(value) && value > 0) this.walkSpeed = clamp(value, 0.05, 5)
    this.noteParameterInteraction()
  }

  private releaseModel(): void {
    if (this.model) {
      this.model.dispose()
      this.model = null
    }
    if (this.sparkRenderer) {
      this.scene.remove(this.sparkRenderer)
      this.sparkRenderer.clearSplats()
      this.sparkRenderer.dispose()
      this.sparkRenderer = null
    }
    if (this.lights) {
      this.scene.remove(this.lights)
      this.lights = null
      this.hemiLight = null
      this.dirLight = null
      this.ambientLight = null
    }
    this.renderer.renderLists.dispose()
    this.renderer.info.reset()
    this.info = null
    this.initialCamera = null
  }

  private releaseSpark(): void {
    if (this.sparkRenderer) {
      this.scene.remove(this.sparkRenderer)
      this.sparkRenderer.clearSplats()
      this.sparkRenderer.dispose()
      this.sparkRenderer = null
    }
  }

  private setupLights(enabled: boolean): void {
    if (this.lights) {
      this.scene.remove(this.lights)
      this.lights = null
    }
    this.hemiLight = null
    this.dirLight = null
    this.ambientLight = null
    if (!enabled) return
    const group = new THREE.Group()
    group.name = 'viewer-soft-light'
    this.hemiLight = new THREE.HemisphereLight(0xe7f2ff, 0x2b3438, 1.05)
    this.ambientLight = new THREE.AmbientLight(0xffffff, 0.22)
    this.dirLight = new THREE.DirectionalLight(0xfff6e8, 1.5)
    this.dirLight.position
      .copy(this.boundsCenter)
      .add(new THREE.Vector3(0.9, -1.1, 1.7).multiplyScalar(this.boundsRadius * 3))
    this.dirLight.target.position.copy(this.boundsCenter)
    group.add(this.hemiLight, this.ambientLight, this.dirLight, this.dirLight.target)
    this.lights = group
    this.scene.add(group)
  }

  private applyLights(): void {
    if (!this.lights) return
    const soft = this.display.softLight
    const intensity = this.display.lightIntensity
    if (this.hemiLight) this.hemiLight.intensity = soft ? 1.05 * intensity : 0
    if (this.dirLight) this.dirLight.intensity = soft ? 1.5 * intensity : 0
    if (this.ambientLight) this.ambientLight.intensity = 0.22
  }

  private syncOrbitFromCamera(): void {
    const offset = this.camera.position.clone().sub(this.orbitTarget)
    this.orbitRadius = Math.max(offset.length(), 1e-6)
    this.orbitPolar = Math.acos(clamp(offset.z / this.orbitRadius, -1, 1))
    this.orbitAzimuth = Math.atan2(offset.y, offset.x)
  }

  private applyOrbit(): void {
    const sinPolar = Math.sin(this.orbitPolar)
    this.camera.position.set(
      this.orbitTarget.x + sinPolar * Math.cos(this.orbitAzimuth) * this.orbitRadius,
      this.orbitTarget.y + sinPolar * Math.sin(this.orbitAzimuth) * this.orbitRadius,
      this.orbitTarget.z + Math.cos(this.orbitPolar) * this.orbitRadius,
    )
    this.camera.up.set(0, 0, 1)
    this.camera.lookAt(this.orbitTarget)
  }

  private syncYawPitchFromCamera(): void {
    const direction = new THREE.Vector3()
    this.camera.getWorldDirection(direction)
    const state = cameraYawPitch(direction)
    this.yaw = state.yaw
    this.pitch = state.pitch
  }

  private applyYawPitch(): void {
    const direction = directionFromYawPitch(this.yaw, this.pitch)
    this.camera.up.set(0, 0, 1)
    this.camera.lookAt(this.camera.position.clone().add(direction))
  }

  private enterWalkPose(): void {
    const effective = this.effectiveWalkConfig()
    let [x, y] = effective.start
    if (effective.areaTrusted && effective.area) {
      x = clamp(x, effective.area.minX, effective.area.maxX)
      y = clamp(y, effective.area.minY, effective.area.maxY)
    }
    this.groundHeight = effective.ground
    this.eyeHeight = effective.eyeHeight
    this.camera.position.set(x, y, effective.ground + effective.eyeHeight)
    this.applyYawPitch()
  }

  private startLoop(): void {
    if (this.raf !== null || this.disposed || !this.visible) return
    if (this.phase !== 'ready') return
    this.lastFrameAt = performance.now()
    this.raf = window.requestAnimationFrame(this.loop)
  }

  private stopLoop(): void {
    if (this.raf !== null) {
      window.cancelAnimationFrame(this.raf)
      this.raf = null
    }
  }

  private loop = (now: number): void => {
    this.raf = null
    if (this.disposed || !this.visible) return
    const delta = Math.min(0.1, Math.max(0, (now - this.lastFrameAt) / 1000))
    if (this.lastFrameAt > 0 && this.phase === 'ready') {
      this.frameTimes.push(now - this.lastFrameAt)
      if (this.frameTimes.length > 240) this.frameTimes.shift()
    }
    this.lastFrameAt = now
    if (this.phase === 'ready') {
      this.updateCamera(delta, now)
      this.renderer.info.reset()
      this.composer.render()
      if (this.timings.firstFrame === 0) this.timings.firstFrame = performance.now()
      if (this.recording) this.drawRecordingFrame()
      if (now - this.lastStatsAt >= 1000) this.emitStats()
    }
    this.raf = window.requestAnimationFrame(this.loop)
  }

  private updateCamera(delta: number, now: number): void {
    if (this.mode === 'orbit') {
      const degrees = this.autoRotate.advance(now, this.mode, this.visible)
      if (degrees !== 0) {
        this.orbitAzimuth -= THREE.MathUtils.degToRad(degrees)
        this.applyOrbit()
      }
      return
    }
    if (this.mode === 'fly') {
      this.updateFly(delta)
    } else {
      this.updateWalk(delta)
    }
  }

  private movementSpeed(base: number): number {
    const forward = new THREE.Vector3()
    this.camera.getWorldDirection(forward)
    const scaled = Math.max(this.boundsRadius, 0.1) * base
    if (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')) return scaled * 4
    if (this.keys.has('ControlLeft') || this.keys.has('ControlRight')) return scaled * 0.25
    return scaled
  }

  private updateFly(delta: number): void {
    const forward = directionFromYawPitch(this.yaw, this.pitch)
    const right = forward.clone().cross(new THREE.Vector3(0, 0, 1)).normalize()
    const move = new THREE.Vector3()
    if (this.keys.has('KeyW')) move.add(forward)
    if (this.keys.has('KeyS')) move.sub(forward)
    if (this.keys.has('KeyD')) move.add(right)
    if (this.keys.has('KeyA')) move.sub(right)
    if (move.lengthSq() === 0) return
    const speed = this.movementSpeed(this.flySpeed)
    this.camera.position.addScaledVector(move.normalize(), speed * delta)
  }

  private updateWalk(delta: number): void {
    const forward = directionFromYawPitch(this.yaw, 0)
    const right = forward.clone().cross(new THREE.Vector3(0, 0, 1)).normalize()
    const move = new THREE.Vector3()
    if (this.keys.has('KeyW')) move.add(forward)
    if (this.keys.has('KeyS')) move.sub(forward)
    if (this.keys.has('KeyD')) move.add(right)
    if (this.keys.has('KeyA')) move.sub(right)
    if (move.lengthSq() !== 0) {
      const speed = this.movementSpeed(this.walkSpeed)
      this.camera.position.addScaledVector(move.normalize(), speed * delta)
    }
    this.camera.position.z = this.groundHeight + this.eyeHeight
  }

  private resize(): void {
    const width = this.canvas.clientWidth || this.host.clientWidth || 1
    const height = this.canvas.clientHeight || this.host.clientHeight || 1
    this.renderer.setSize(width, height, false)
    this.composer.setSize(width, height)
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    if (this.isReady()) {
      this.renderer.info.reset()
      this.composer.render()
    }
  }

  private emitStats(): void {
    if (!this.isReady()) return
    this.lastStatsAt = performance.now()
    const samples = [...this.frameTimes].sort((a, b) => a - b)
    const at = (quantile: number) =>
      samples.length === 0 ? 0 : samples[Math.min(samples.length - 1, Math.floor(quantile * samples.length))]!
    const mean = samples.length > 0 ? samples.reduce((sum, value) => sum + value, 0) / samples.length : 0
    const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory
    const info = this.renderer.info
    const stats: ViewerStats = {
      at: Date.now(),
      phase: this.phase,
      fps: mean > 0 ? 1000 / mean : 0,
      frameCount: samples.length,
      p50Ms: at(0.5),
      p95Ms: at(0.95),
      longestMs: samples.length > 0 ? samples[samples.length - 1]! : 0,
      longFrames: samples.filter((value) => value > 50).length,
      dpr: this.renderer.getPixelRatio(),
      width: this.canvas.width,
      height: this.canvas.height,
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      points: info.render.points,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      jsHeapBytes: memory?.usedJSHeapSize ?? null,
    }
    this.lastStats = stats
    this.emit({ type: 'stats', stats })
  }

  private drawRecordingFrame(): void {
    const session = this.recording
    if (!session) return
    const sourceWidth = this.canvas.width
    const sourceHeight = this.canvas.height
    if (sourceWidth <= 0 || sourceHeight <= 0) return
    const scale = Math.min(session.width / sourceWidth, session.height / sourceHeight)
    const drawWidth = Math.max(2, Math.round(sourceWidth * scale))
    const drawHeight = Math.max(2, Math.round(sourceHeight * scale))
    const x = Math.round((session.width - drawWidth) / 2)
    const y = Math.round((session.height - drawHeight) / 2)
    session.context.fillStyle = '#080d12'
    session.context.fillRect(0, 0, session.width, session.height)
    session.context.drawImage(this.canvas, x, y, drawWidth, drawHeight)
  }

  private emitRecording(): void {
    if (!this.recording) {
      this.emit({
        type: 'recording',
        state: { recording: false, elapsedMs: 0, remainingMs: RECORDING_TARGET_MS, targetMs: RECORDING_TARGET_MS },
      })
      return
    }
    const elapsed = Math.min(RECORDING_TARGET_MS, performance.now() - this.recording.startedAt)
    const state: RecordingState = {
      recording: true,
      elapsedMs: elapsed,
      remainingMs: Math.max(0, RECORDING_TARGET_MS - elapsed),
      targetMs: RECORDING_TARGET_MS,
    }
    this.emit({ type: 'recording', state })
  }

  private emitAutoRotate(): void {
    this.emit({
      type: 'autoRotate',
      enabled: this.autoRotate.isEnabled,
      userDisabled: this.autoRotate.isUserDisabled,
    })
  }

  private setPhase(phase: ViewerPhase, detail?: string): void {
    this.phase = phase
    this.emit({ type: 'phase', phase, detail })
  }

  private emit(event: ModelViewerEvent): void {
    if (this.disposed && event.type !== 'ended') return
    this.options.onEvent?.(event)
  }

  private bindEvents(): void {
    this.canvas.addEventListener('pointerdown', this.onPointerDown)
    this.canvas.addEventListener('pointermove', this.onPointerMove)
    this.canvas.addEventListener('pointerup', this.onPointerUp)
    this.canvas.addEventListener('pointercancel', this.onPointerUp)
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false })
    this.canvas.addEventListener('contextmenu', this.onContextMenu)
    this.canvas.addEventListener('keydown', this.onKeyDown)
    this.canvas.addEventListener('keyup', this.onKeyUp)
    this.canvas.addEventListener('blur', this.onCanvasBlur)
    this.canvas.addEventListener('lostpointercapture', this.onLostPointerCapture)
    document.addEventListener('visibilitychange', this.onVisibilityChange)
    window.addEventListener('blur', this.onBlur)
    window.addEventListener('keyup', this.onWindowKeyUp)
    this.canvas.addEventListener('webglcontextlost', this.onContextLost)
    this.canvas.style.touchAction = 'pan-y'
    if (!this.canvas.hasAttribute('tabindex')) this.canvas.tabIndex = 0
    if (typeof IntersectionObserver !== 'undefined') {
      this.intersectionObserver = new IntersectionObserver(
        (entries) => {
          const entry = entries[entries.length - 1]
          this.intersectionVisible = entry?.isIntersecting ?? true
          this.updateVisibility()
        },
        { threshold: 0.01 },
      )
      this.intersectionObserver.observe(this.canvas)
    }
  }

  private intersectionObserver: IntersectionObserver | null = null

  private unbindEvents(): void {
    this.canvas.removeEventListener('pointerdown', this.onPointerDown)
    this.canvas.removeEventListener('pointermove', this.onPointerMove)
    this.canvas.removeEventListener('pointerup', this.onPointerUp)
    this.canvas.removeEventListener('pointercancel', this.onPointerUp)
    this.canvas.removeEventListener('wheel', this.onWheel)
    this.canvas.removeEventListener('contextmenu', this.onContextMenu)
    this.canvas.removeEventListener('keydown', this.onKeyDown)
    this.canvas.removeEventListener('keyup', this.onKeyUp)
    this.canvas.removeEventListener('blur', this.onCanvasBlur)
    this.canvas.removeEventListener('lostpointercapture', this.onLostPointerCapture)
    document.removeEventListener('visibilitychange', this.onVisibilityChange)
    window.removeEventListener('blur', this.onBlur)
    window.removeEventListener('keyup', this.onWindowKeyUp)
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost)
    this.intersectionObserver?.disconnect()
    this.intersectionObserver = null
  }

  private updateVisibility(): void {
    const next = this.intersectionVisible && !document.hidden
    if (next === this.visible) return
    this.visible = next
    if (!next) {
      this.clearInput()
      this.autoRotate.pause(performance.now())
      if (this.recording) void this.stopRecording('hidden')
      this.stopLoop()
    } else {
      this.autoRotate.resume(performance.now())
      this.startLoop()
    }
  }

  private clearInput(): void {
    this.keys.clear()
    this.drag = null
    this.touchPointers.clear()
    this.touchLast = null
    for (const pointerId of this.capturedPointers) {
      try {
        this.canvas.releasePointerCapture(pointerId)
      } catch {
        // 指针已结束或合成事件没有捕获时忽略。
      }
    }
    this.capturedPointers.clear()
  }

  private capturePointer(pointerId: number): void {
    try {
      this.canvas.setPointerCapture(pointerId)
      this.capturedPointers.add(pointerId)
    } catch {
      // 合成事件或浏览器不支持捕获时仍继续处理；不使用 pointer lock。
    }
  }

  private noteInteraction(): void {
    this.autoRotate.noteInteraction(performance.now())
  }

  private localPoint(event: PointerEvent | WheelEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (this.phase !== 'ready') return
    this.canvas.focus({ preventScroll: true })
    const point = this.localPoint(event)
    this.noteInteraction()
    if (event.pointerType === 'touch') {
      if (!this.touchEnabled) return
      event.preventDefault()
      this.capturePointer(event.pointerId)
      this.autoRotate.beginInteraction(performance.now())
      this.touchPointers.set(event.pointerId, point)
      if (this.touchPointers.size === 1) {
        this.touchLast = { ...point, distance: 0, midX: point.x, midY: point.y }
      } else if (this.touchPointers.size === 2) {
        this.touchLast = this.touchState()
      }
      return
    }
    if (event.button === 0) {
      if (this.mode === 'fly') return
      this.drag = {
        kind: this.mode === 'orbit' ? 'rotate' : 'walkClick',
        pointerId: event.pointerId,
        startX: point.x,
        startY: point.y,
        lastX: point.x,
        lastY: point.y,
        moved: false,
      }
    } else if (event.button === 1 && this.mode === 'orbit') {
      event.preventDefault()
      this.drag = {
        kind: 'pan',
        pointerId: event.pointerId,
        startX: point.x,
        startY: point.y,
        lastX: point.x,
        lastY: point.y,
        moved: false,
      }
    } else if (event.button === 2) {
      event.preventDefault()
      if (this.mode === 'orbit') return
      this.drag = {
        kind: 'look',
        pointerId: event.pointerId,
        startX: point.x,
        startY: point.y,
        lastX: point.x,
        lastY: point.y,
        moved: false,
      }
      this.syncYawPitchFromCamera()
    } else {
      return
    }
    this.capturePointer(event.pointerId)
    this.autoRotate.beginInteraction(performance.now())
  }

  private onPointerMove = (event: PointerEvent): void => {
    if (this.phase !== 'ready') return
    const point = this.localPoint(event)
    if (event.pointerType === 'touch') {
      if (!this.touchEnabled) return
      if (!this.touchPointers.has(event.pointerId)) return
      event.preventDefault()
      this.touchPointers.set(event.pointerId, point)
      if (this.touchPointers.size === 1 && this.touchLast) {
        const dx = point.x - this.touchLast.x
        const dy = point.y - this.touchLast.y
        this.touchLast = { ...point, distance: 0, midX: point.x, midY: point.y }
        if (this.mode === 'orbit') this.rotateOrbit(dx, dy)
        else if (this.mode === 'fly' || this.mode === 'walk') this.look(dx, dy)
        this.noteInteraction()
      } else if (this.touchPointers.size >= 2) {
        const next = this.touchState()
        if (this.touchLast) {
          const dx = next.midX - this.touchLast.midX
          const dy = next.midY - this.touchLast.midY
          this.pan(dx, dy)
          if (this.touchLast.distance > 0 && next.distance > 0) {
            this.zoomBy(Math.log(this.touchLast.distance / next.distance) * 120)
          }
        }
        this.touchLast = next
        this.noteInteraction()
      }
      return
    }
    if (!this.drag || this.drag.pointerId !== event.pointerId) return
    const dx = point.x - this.drag.lastX
    const dy = point.y - this.drag.lastY
    this.drag.lastX = point.x
    this.drag.lastY = point.y
    if (Math.hypot(point.x - this.drag.startX, point.y - this.drag.startY) > 4) this.drag.moved = true
    if (this.drag.kind === 'rotate') this.rotateOrbit(dx, dy)
    else if (this.drag.kind === 'pan') this.pan(dx, dy)
    else if (this.drag.kind === 'look') this.look(dx, dy)
    this.noteInteraction()
  }

  private onPointerUp = (event: PointerEvent): void => {
    if (event.pointerType === 'touch') {
      this.touchPointers.delete(event.pointerId)
      if (this.touchPointers.size === 1) {
        const remaining = [...this.touchPointers.values()][0]!
        this.touchLast = { ...remaining, distance: 0, midX: remaining.x, midY: remaining.y }
      } else if (this.touchPointers.size === 0) {
        this.touchLast = null
        this.autoRotate.endInteraction(performance.now())
      }
      this.noteInteraction()
      return
    }
    const drag = this.drag
    this.drag = null
    if (!drag) return
    if (drag.kind === 'walkClick' && !drag.moved) {
      this.tryWalkTeleport(this.localPoint(event))
    }
    this.autoRotate.endInteraction(performance.now())
  }

  private touchState(): { x: number; y: number; distance: number; midX: number; midY: number } {
    const points = [...this.touchPointers.values()]
    const first = points[0] ?? { x: 0, y: 0 }
    const second = points[1] ?? first
    return {
      x: first.x,
      y: first.y,
      distance: Math.hypot(second.x - first.x, second.y - first.y),
      midX: (first.x + second.x) / 2,
      midY: (first.y + second.y) / 2,
    }
  }

  private rotateOrbit(dx: number, dy: number): void {
    if (this.mode !== 'orbit') return
    const speed = 0.006
    this.orbitAzimuth -= dx * speed
    this.orbitPolar = clamp(this.orbitPolar - dy * speed, 0.03, Math.PI - 0.03)
    this.applyOrbit()
  }

  private pan(dx: number, dy: number): void {
    const distance = this.camera.position.distanceTo(this.orbitTarget)
    const worldPerPixel =
      (2 * distance * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2)) /
      Math.max(1, this.canvas.clientHeight)
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0)
    const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1)
    const offset = right.multiplyScalar(-dx * worldPerPixel).add(up.multiplyScalar(dy * worldPerPixel))
    this.camera.position.add(offset)
    this.orbitTarget.add(offset)
    this.syncOrbitFromCamera()
  }

  private look(dx: number, dy: number): void {
    const speed = 0.004
    this.yaw -= dx * speed
    this.pitch = clamp(this.pitch - dy * speed, THREE.MathUtils.degToRad(-85), THREE.MathUtils.degToRad(85))
    this.applyYawPitch()
  }

  private zoomBy(delta: number): void {
    if (this.mode === 'orbit') {
      this.orbitRadius = clamp(this.orbitRadius * Math.exp(delta * 0.0012), this.minDistance, this.maxDistance)
      this.applyOrbit()
      return
    }
    const forward = new THREE.Vector3()
    this.camera.getWorldDirection(forward)
    this.camera.position.addScaledVector(forward, delta * this.boundsRadius * 0.002)
    if (this.mode === 'walk') this.camera.position.z = this.groundHeight + this.eyeHeight
  }

  private tryWalkTeleport(point: { x: number; y: number }): void {
    if (this.mode !== 'walk') return
    const effective = this.effectiveWalkConfig()
    const area = effective.area
    if (!area || !effective.areaTrusted) return
    const rect = this.canvas.getBoundingClientRect()
    const ndc = new THREE.Vector2((point.x / rect.width) * 2 - 1, -(point.y / rect.height) * 2 + 1)
    const raycaster = new THREE.Raycaster()
    raycaster.setFromCamera(ndc, this.camera)
    if (Math.abs(raycaster.ray.direction.z) < 1e-6) return
    const t = (effective.ground - raycaster.ray.origin.z) / raycaster.ray.direction.z
    if (t <= 0) return
    const target = raycaster.ray.at(t, new THREE.Vector3())
    if (target.x < area.minX || target.x > area.maxX || target.y < area.minY || target.y > area.maxY) {
      return
    }
    const confirmed = window.confirm(
      'Walk 只提供地面高度约束，不防穿墙，也没有真实碰撞。确认传送到该点吗？',
    )
    if (!confirmed) return
    this.camera.position.set(target.x, target.y, effective.ground + effective.eyeHeight)
    this.noteInteraction()
  }

  private onWheel = (event: WheelEvent): void => {
    if (this.phase !== 'ready') return
    event.preventDefault()
    this.noteInteraction()
    const scale = event.deltaMode === 1 ? 16 : 1
    this.zoomBy(event.deltaY * scale)
  }

  private onContextMenu = (event: MouseEvent): void => {
    event.preventDefault()
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (this.phase !== 'ready') return
    if (isTextInput(event.target)) return
    if (event.metaKey || event.altKey) return
    const code = event.code
    const movementKey = ['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(code)
    // Ctrl 作为减速修饰键只对 canvas 聚焦时的 WASD 生效；其他 Ctrl 组合键放行。
    if (event.ctrlKey && !movementKey && code !== 'ControlLeft' && code !== 'ControlRight') return
    if (code === 'KeyF') {
      event.preventDefault()
      this.resetView()
      return
    }
    // 只有 Fly/Walk 才消费 WASD；Orbit 下不拦截 Ctrl+W/A/S/D 等浏览器组合。
    if (movementKey && this.mode === 'orbit') return
    if (movementKey && event.ctrlKey) event.preventDefault()
    if (movementKey && !this.keys.has(code)) {
      this.autoRotate.beginInteraction(performance.now())
    }
    if (
      ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight'].includes(
        code,
      )
    ) {
      if (this.mode === 'orbit' && ['ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight'].includes(code)) {
        return
      }
      this.keys.add(code)
      this.noteInteraction()
    }
  }

  private endKeyInteraction(code: string): void {
    this.keys.delete(code)
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(code)) {
      const stillMoving = ['KeyW', 'KeyA', 'KeyS', 'KeyD'].some((key) => this.keys.has(key))
      if (!stillMoving) this.autoRotate.endInteraction(performance.now())
    }
  }

  private onKeyUp = (event: KeyboardEvent): void => {
    this.endKeyInteraction(event.code)
  }

  private onWindowKeyUp = (event: KeyboardEvent): void => {
    this.endKeyInteraction(event.code)
  }

  private onBlur = (): void => {
    this.parameterInteractionActive = false
    this.clearInput()
    this.autoRotate.endInteraction(performance.now())
  }

  private onCanvasBlur = (): void => {
    this.clearInput()
    // 点击设置里的滑块/输入框会让 canvas 失焦；参数交互由 input 自己的
    // pointerdown/focus 持有，不能在 blur 时提前结束等待。
    if (!this.parameterInteractionActive) this.autoRotate.endInteraction(performance.now())
  }

  private onLostPointerCapture = (event: PointerEvent): void => {
    this.capturedPointers.delete(event.pointerId)
    // 正常 pointerup 也会丢失捕获；不能清掉仍按住的其他触点。
    if (this.touchPointers.has(event.pointerId)) {
      this.onPointerUp(event)
      return
    }
    if (this.drag?.pointerId === event.pointerId) {
      this.drag = null
      this.autoRotate.endInteraction(performance.now())
    }
  }

  private onVisibilityChange = (): void => {
    this.updateVisibility()
  }

  private onContextLost = (event: Event): void => {
    event.preventDefault()
    if (this.phase === 'ended' || this.disposed) return
    this.gate.cancel()
    this.parameterInteractionActive = false
    this.clearInput()
    this.autoRotate.pause(performance.now())
    this.stopLoop()
    if (this.recording) void this.stopRecording('error')
    this.releaseModel()
    this.error = toViewerErrorInfo(new ViewerError('CONTEXT_LOST'))
    this.setPhase('error')
    this.emit({ type: 'error', error: this.error })
  }
}
