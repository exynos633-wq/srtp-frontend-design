import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ModelFormat } from '../../types/work'
import { classNames } from '../../lib/classNames'
import { prefersReducedMotion } from '../../lib/prefersReducedMotion'
import { toViewerErrorInfo } from '../../viewer/errors'
import { ModelViewer } from '../../viewer/ModelViewer'
import type {
  ModelInfo,
  ModelSource,
  ModelViewConfig,
  ModelViewerEvent,
  RecordingResult,
  RecordingState,
  ViewerErrorInfo,
  ViewerMode,
  ViewerPhase,
  ViewerStats,
} from '../../viewer/types'
import { RECORDING_TARGET_MS } from '../../viewer/types'
import { downloadBlob, isLowPowerDevice, sanitizeFilename, timestampForFilename } from '../../viewer/viewerMath'
import { canControlEmission } from '../../viewer/emission'
import { Button } from '../ui/Button'
import {
  CloseIcon,
  ExitFullscreenIcon,
  FlyIcon,
  FullscreenIcon,
  ImageIcon,
  InfoIcon,
  OrbitIcon,
  RecordIcon,
  ResetIcon,
  SettingsIcon,
  StopIcon,
  WalkIcon,
  ZoomIcon,
} from './icons'
import styles from './ModelViewport.module.css'

const EMPTY_CONFIG: ModelViewConfig = {}

const EMPTY_RECORDING: RecordingState = {
  recording: false,
  elapsedMs: 0,
  remainingMs: RECORDING_TARGET_MS,
  targetMs: RECORDING_TARGET_MS,
}

const PHASE_LABEL: Record<ViewerPhase, string> = {
  idle: '等待开始',
  read: '正在读取模型文件',
  parse: '正在解析模型结构',
  initialize: '正在初始化渲染资源',
  ready: '模型就绪',
  error: '加载失败',
  ended: '已结束',
}

export interface ModelViewportProps {
  source: ModelSource | null
  modelName: string
  modelFormat?: ModelFormat | null
  viewConfig?: ModelViewConfig
  dprCap?: number
  lowPower?: boolean
  autoRotateDefault?: boolean
  onPhase?: (phase: ViewerPhase) => void
  onReady?: (info: ModelInfo) => void
  onError?: (error: ViewerErrorInfo) => void
  onEnd?: () => void | Promise<void>
  onZoom?: () => void
  endLabel?: string
  showEnd?: boolean
  className?: string
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GiB`
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${bytes} B`
}

function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`
}

function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  return value.toLocaleString('zh-CN')
}

function formatMetric(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return value.toFixed(digits)
}

/**
 * 查看器 UI。DOM 只接收阶段/统计/录制等低频事件，不逐帧 setState；
 * 画布、相机和 Three 场景由 ModelViewer 单独持有。
 */
export function ModelViewport({
  source,
  modelName,
  modelFormat,
  viewConfig,
  dprCap,
  lowPower,
  autoRotateDefault,
  onPhase,
  onReady,
  onError,
  onEnd,
  onZoom,
  endLabel = '结束预览',
  showEnd = true,
  className,
}: ModelViewportProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const viewerRef = useRef<ModelViewer | null>(null)
  const callbacksRef = useRef({ onPhase, onReady, onError, onEnd })
  const messageTimerRef = useRef<number | null>(null)

  const [phase, setPhase] = useState<ViewerPhase>('idle')
  const [info, setInfo] = useState<ModelInfo | null>(null)
  const [error, setError] = useState<ViewerErrorInfo | null>(null)
  const [progress, setProgress] = useState<{ loaded: number; total: number | null; percent: number | null } | null>(null)
  const [stats, setStats] = useState<ViewerStats | null>(null)
  const [mode, setMode] = useState<ViewerMode>('orbit')
  const [autoRotate, setAutoRotate] = useState(false)
  const [recording, setRecording] = useState<RecordingState>(EMPTY_RECORDING)
  const [recordingResult, setRecordingResult] = useState<RecordingResult | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [infoOpen, setInfoOpen] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [message, setMessage] = useState('')
  const [bloom, setBloom] = useState(false)
  const [bloomStrength, setBloomStrengthValue] = useState(0.25)
  const [uniformTone, setUniformTone] = useState(false)
  const [splatScale, setSplatScaleValue] = useState(1)
  const [softLight, setSoftLight] = useState(true)
  const [lightIntensity, setLightIntensity] = useState(1)
  const [emission, setEmission] = useState(false)
  const [emissionIntensity, setEmissionIntensity] = useState(1.6)
  const [flySpeed, setFlySpeed] = useState(0.6)
  const [walkSpeed, setWalkSpeed] = useState(0.3)
  const [sourceUpChoice, setSourceUpChoice] = useState<'auto' | 'z' | 'y'>(viewConfig?.sourceUp ?? 'auto')
  const sourceUpChoiceRef = useRef(sourceUpChoice)
  const [touchEnabled, setTouchEnabled] = useState(false)
  const [recordingBusy, setRecordingBusy] = useState(false)
  const [walkSetupOpen, setWalkSetupOpen] = useState(false)
  const [walkGround, setWalkGround] = useState(0)
  const [walkEye, setWalkEye] = useState(1)
  const [walkStartX, setWalkStartX] = useState(0)
  const [walkStartY, setWalkStartY] = useState(0)
  const [walkConfirmed, setWalkConfirmed] = useState(false)
  const [walkAreaTrusted, setWalkAreaTrusted] = useState(false)

  const reducedMotion = useMemo(() => prefersReducedMotion(), [])
  const detectedLowPower = useMemo(() => isLowPowerDevice(), [])
  const effectiveLowPower = lowPower ?? detectedLowPower
  const coarsePointer = useMemo(
    () => typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches,
    [],
  )
  const config = viewConfig ?? EMPTY_CONFIG
  const initialAutoRotate = autoRotateDefault ?? !reducedMotion
  const isGaussian = info?.format === 'gaussian-ply' || (!info && modelFormat === 'gaussian-ply')
  const isGlb = info?.format === 'glb' || (!info && modelFormat === 'glb')

  useEffect(() => {
    callbacksRef.current = { onPhase, onReady, onError, onEnd }
  }, [onEnd, onError, onPhase, onReady])

  const notify = useCallback((text: string) => {
    setMessage(text)
    if (messageTimerRef.current !== null) window.clearTimeout(messageTimerRef.current)
    messageTimerRef.current = window.setTimeout(() => {
      messageTimerRef.current = null
      setMessage('')
    }, 5000)
  }, [])

  const handleEvent = useCallback(
    (event: ModelViewerEvent) => {
      switch (event.type) {
        case 'phase':
          setPhase(event.phase)
          callbacksRef.current.onPhase?.(event.phase)
          if (event.phase === 'read' || event.phase === 'parse' || event.phase === 'initialize') {
            setError(null)
            setRecordingResult(null)
          }
          if (event.phase === 'error') setProgress(null)
          break
        case 'progress':
          setProgress({
            loaded: event.progress.loadedBytes,
            total: event.progress.totalBytes,
            percent: event.progress.percent,
          })
          break
        case 'info':
          setInfo(event.info)
          break
        case 'ready':
          setInfo(event.info)
          setError(null)
          setProgress(null)
          callbacksRef.current.onReady?.(event.info)
          notify('模型已加载，可用鼠标或触控操作。')
          break
        case 'error':
          setError(event.error)
          setProgress(null)
          setRecordingBusy(false)
          callbacksRef.current.onError?.(event.error)
          break
        case 'stats':
          setStats(event.stats)
          break
        case 'mode':
          setMode(event.mode)
          if (event.mode !== 'walk') setWalkSetupOpen(false)
          break
        case 'autoRotate':
          setAutoRotate(event.enabled)
          break
        case 'recording':
          setRecording(event.state)
          break
        case 'recordingReady':
          setRecordingResult(event.result)
          notify(
            event.result.complete
              ? `录制完成：${formatSeconds(event.result.wallClockMs)}（完整 35 秒）。`
              : `录制已停止：${formatSeconds(event.result.wallClockMs)}，不足 35 秒。`,
          )
          break
        case 'screenshot':
          downloadBlob(event.blob, event.filename)
          notify(`PNG 已生成：${event.filename}`)
          break
        case 'ended':
          callbacksRef.current.onEnd?.()
          break
      }
    },
    [notify],
  )
  const handleEventRef = useRef(handleEvent)
  useEffect(() => {
    handleEventRef.current = handleEvent
  }, [handleEvent])

  useEffect(() => {
    const canvas = canvasRef.current
    const root = rootRef.current
    if (!canvas || !root) return
    let viewer: ModelViewer
    try {
      viewer = new ModelViewer(canvas, root, {
        autoRotate: initialAutoRotate,
        reducedMotion,
        dprCap,
        lowPower: effectiveLowPower,
        onEvent: (event) => handleEventRef.current(event),
      })
    } catch (failure) {
      const info = toViewerErrorInfo(failure)
      window.queueMicrotask(() => {
        setError(info)
        setPhase('error')
        callbacksRef.current.onError?.(info)
      })
      return
    }
    viewerRef.current = viewer
    if (import.meta.env.DEV) {
      ;(window as unknown as { __srtpModelViewer?: ModelViewer }).__srtpModelViewer = viewer
    }
    const onFullscreenChange = () => setFullscreen(document.fullscreenElement === root)
    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange)
      const debugWindow = window as unknown as { __srtpModelViewer?: ModelViewer }
      if (debugWindow.__srtpModelViewer === viewer) delete debugWindow.__srtpModelViewer
      viewer.dispose()
      viewerRef.current = null
    }
    // 查看器只在挂载时创建；DPR 变化走 setDprCap，source/config 变化走单独重载。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    viewerRef.current?.setDprCap(dprCap ?? 1.5, effectiveLowPower)
  }, [dprCap, effectiveLowPower])

  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer) return
    setInfo(null)
    setError(null)
    setStats(null)
    setRecordingResult(null)
    setProgress(null)
    setWalkSetupOpen(false)
    const nextSourceUp = config.sourceUp ?? 'auto'
    sourceUpChoiceRef.current = nextSourceUp
    setSourceUpChoice(nextSourceUp)
    void viewer.load(source, config)
  }, [source, config])

  useEffect(() => {
    // 初始 load 已带 viewConfig.orientation；只有用户实际改 select 时才重置方向。
    if (sourceUpChoiceRef.current === sourceUpChoice) return
    sourceUpChoiceRef.current = sourceUpChoice
    viewerRef.current?.setSourceUp(sourceUpChoice === 'auto' ? null : sourceUpChoice)
  }, [sourceUpChoice])

  useEffect(
    () => () => {
      if (messageTimerRef.current !== null) window.clearTimeout(messageTimerRef.current)
    },
    [],
  )

  function toggleBloom() {
    const next = !bloom
    setBloom(next)
    viewerRef.current?.setBloom(next, bloomStrength)
  }

  function changeBloomStrength(value: number) {
    setBloomStrengthValue(value)
    viewerRef.current?.setBloomStrength(value)
  }

  function toggleTone() {
    const next = !uniformTone
    setUniformTone(next)
    viewerRef.current?.setUniformTone(next)
  }

  function changeSplatScale(value: number) {
    setSplatScaleValue(value)
    viewerRef.current?.setSplatScale(value)
  }

  function toggleSoftLight() {
    const next = !softLight
    setSoftLight(next)
    viewerRef.current?.setSoftLight(next, lightIntensity)
  }

  function changeLightIntensity(value: number) {
    setLightIntensity(value)
    viewerRef.current?.setSoftLight(softLight, value)
  }

  function toggleEmission() {
    if (!emissiveAvailable) return
    const next = !emission
    setEmission(next)
    viewerRef.current?.setEmission(next, emissionIntensity)
  }

  function changeEmissionIntensity(value: number) {
    setEmissionIntensity(value)
    viewerRef.current?.setEmission(emission, value)
  }

  function changeFlySpeed(value: number) {
    setFlySpeed(value)
    viewerRef.current?.setFlySpeed(value)
  }

  function changeWalkSpeed(value: number) {
    setWalkSpeed(value)
    viewerRef.current?.setWalkSpeed(value)
  }

  function changeSourceUp(value: 'auto' | 'z' | 'y') {
    setSourceUpChoice(value)
  }

  function rotateOrientation(axis: 'x' | 'y' | 'z') {
    viewerRef.current?.rotateOrientation(axis)
  }

  function resetOrientation() {
    viewerRef.current?.resetOrientation()
  }

  function openWalkSetup() {
    const viewer = viewerRef.current
    if (!viewer) return
    viewer.beginParameterInteraction()
    const defaults = viewer.getWalkDefaults()
    setWalkGround(Number(defaults.ground.toFixed(4)))
    setWalkEye(Number(defaults.eyeHeight.toFixed(4)))
    setWalkStartX(Number(defaults.start[0].toFixed(4)))
    setWalkStartY(Number(defaults.start[1].toFixed(4)))
    setWalkAreaTrusted(defaults.areaTrusted)
    setWalkConfirmed(false)
    setWalkSetupOpen(true)
    setSettingsOpen(true)
    setInfoOpen(false)
  }

  function confirmWalk() {
    const viewer = viewerRef.current
    if (!viewer) return
    const ground = Number(walkGround)
    const eyeHeight = Number(walkEye)
    const startX = Number(walkStartX)
    const startY = Number(walkStartY)
    if (
      ![ground, eyeHeight, startX, startY].every((value) => Number.isFinite(value)) ||
      eyeHeight <= 0
    ) {
      notify('步行参数必须是有限数值，视角高必须大于 0。')
      return
    }
    try {
      viewer.configureWalk({ ground, eyeHeight, start: [startX, startY] })
      viewer.setMode('walk')
      viewer.endParameterInteraction()
      setMode('walk')
      setWalkSetupOpen(false)
      notify(
        walkAreaTrusted
          ? '已进入步行模式：仅地面约束；可信区域内点击地面会二次确认传送。'
          : '已进入步行模式：仅地面约束；没有可信步行区域，点击传送已禁用。',
      )
    } catch (failure) {
      notify(toViewerErrorInfo(failure).message)
    }
  }

  function toggleAutoRotate() {
    const next = !autoRotate
    setAutoRotate(next)
    viewerRef.current?.setAutoRotate(next)
  }

  function toggleTouch() {
    const next = !touchEnabled
    setTouchEnabled(next)
    viewerRef.current?.setTouchEnabled(next)
  }

  function resetDisplay() {
    setBloom(false)
    setBloomStrengthValue(0.25)
    setUniformTone(false)
    setSplatScaleValue(1)
    setSoftLight(true)
    setLightIntensity(1)
    setEmission(false)
    setEmissionIntensity(1.6)
    viewerRef.current?.resetDisplay()
    notify('显示参数已恢复默认；相机视角未改变。')
  }

  function resetView() {
    viewerRef.current?.resetView()
    notify('视角已复位到初始位置。')
  }

  function changeMode(next: ViewerMode) {
    if (walkSetupOpen && next !== 'walk') {
      viewerRef.current?.endParameterInteraction()
      setWalkSetupOpen(false)
    }
    if (next === mode) return
    if (next !== 'orbit' && coarsePointer) return
    if (next === 'walk') {
      openWalkSetup()
      return
    }
    viewerRef.current?.setMode(next)
    setMode(next)
  }

  async function capture() {
    try {
      await viewerRef.current?.capturePng()
    } catch (failure) {
      const next = toViewerErrorInfo(failure)
      notify(`${next.title}：${next.message}`)
    }
  }

  async function toggleRecording() {
    const viewer = viewerRef.current
    if (!viewer) return
    try {
      if (viewer.isRecording()) {
        setRecordingBusy(true)
        try {
          await viewer.stopRecording('manual')
        } finally {
          setRecordingBusy(false)
        }
      } else {
        await viewer.startRecording()
        notify('开始录制 35 秒；切换页面或替换模型会提前结束。')
      }
    } catch (failure) {
      setRecordingBusy(false)
      const next = toViewerErrorInfo(failure)
      notify(`${next.title}：${next.message}`)
    }
  }

  async function endPreview() {
    const viewer = viewerRef.current
    if (viewer?.isRecording()) await viewer.stopRecording('end')
    await onEnd?.()
  }

  async function toggleFullscreen() {
    const root = rootRef.current
    if (!root) return
    viewerRef.current?.clearUserInput()
    try {
      if (document.fullscreenElement === root) {
        await document.exitFullscreen()
      } else if (document.fullscreenElement) {
        notify('宿主页面正在全屏；查看器不会退出其他元素的全屏，请先由宿主退出。')
      } else {
        await root.requestFullscreen()
      }
    } catch {
      notify('浏览器未允许进入全屏；可用页内放大查看。')
    }
  }

  function downloadRecording(result: RecordingResult) {
    const name = `${sanitizeFilename(result.sourceName || modelName || 'model')}-${timestampForFilename()}.${result.extension}`
    downloadBlob(result.blob, name)
  }

  const phaseBusy = phase === 'read' || phase === 'parse' || phase === 'initialize'
  const ready = phase === 'ready'
  const hasEmissive = Boolean(info?.format === 'glb' && info.hasEmissive)
  // 统一色调会换成无发光的替代材质；此时禁用控件，切回原色后保留设置。
  const emissiveAvailable = canControlEmission(hasEmissive, uniformTone)
  const progressPercent = progress?.percent ?? null
  const sourceLabel =
    source?.kind === 'file' ? source.file.name : source?.kind === 'url' ? source.name ?? source.url : '未配置'
  const recordingLabel = recording.recording
    ? `录制中 ${formatSeconds(recording.elapsedMs)} · 剩余 ${formatSeconds(recording.remainingMs)}`
    : recordingResult
      ? `已录 ${formatSeconds(recordingResult.wallClockMs)}${recordingResult.complete ? ' · 完整' : ' · 不足 35 秒'}`
      : '35 秒录制'

  return (
    <div
      ref={rootRef}
      className={classNames(styles.root, className)}
      data-cursor-label="拖动模型"
      data-viewer-phase={phase}
      data-viewer-ready={ready ? 'true' : 'false'}
      data-viewer-format={info?.format ?? modelFormat ?? ''}
      data-viewer-settings-open={settingsOpen ? 'true' : 'false'}
    >
      <div className={styles.stage}>
        <canvas
          ref={canvasRef}
          className={styles.canvas}
          tabIndex={0}
          aria-label={`${modelName} 三维模型画布。方向键不移动；WASD 在飞行或步行模式移动，F 复位视角，鼠标左键旋转、中键平移、滚轮缩放。`}
          data-viewer-canvas
        />

        <div className={styles.topBar}>
          <div className={styles.toolbar} role="toolbar" aria-label="模型查看工具栏">
            <div className={styles.segment} role="group" aria-label="相机模式">
              <button
                type="button"
                className={classNames(styles.iconButton, mode === 'orbit' && styles.iconButtonActive)}
                aria-label="环绕模式"
                aria-pressed={mode === 'orbit'}
                title="环绕：左键旋转，中键平移，滚轮缩放"
                onClick={() => changeMode('orbit')}
              >
                <OrbitIcon />
              </button>
              <button
                type="button"
                className={classNames(styles.iconButton, mode === 'fly' && styles.iconButtonActive)}
                aria-label="飞行模式"
                aria-pressed={mode === 'fly'}
                title={coarsePointer ? '飞行模式为桌面核心功能，触屏未启用' : '飞行：WASD 移动，Shift 加速，Ctrl 减速，右键观察'}
                disabled={coarsePointer || !ready}
                onClick={() => changeMode('fly')}
              >
                <FlyIcon />
              </button>
              <button
                type="button"
                className={classNames(styles.iconButton, mode === 'walk' && styles.iconButtonActive)}
                aria-label="步行模式"
                aria-pressed={mode === 'walk' || walkSetupOpen}
                title={
                  coarsePointer
                    ? '步行模式为桌面核心功能，触屏未启用'
                    : '步行：先编辑地面/视角高/起点并确认；仅地面约束，不防穿墙'
                }
                disabled={coarsePointer || !ready}
                onClick={() => changeMode('walk')}
              >
                <WalkIcon />
              </button>
            </div>

            <div className={styles.toolActions}>
              <button
                type="button"
                className={styles.iconButton}
                aria-label="复位视角"
                title="复位到初始视角（F）"
                disabled={!ready}
                onClick={resetView}
              >
                <ResetIcon />
              </button>
              <button
                type="button"
                className={classNames(styles.iconButton, infoOpen && styles.iconButtonActive)}
                aria-label="模型信息"
                aria-pressed={infoOpen}
                title="模型信息"
                onClick={() => {
                  setInfoOpen((value) => !value)
                  setSettingsOpen(false)
                }}
              >
                <InfoIcon />
              </button>
              <button
                type="button"
                className={classNames(styles.iconButton, settingsOpen && styles.iconButtonActive)}
                aria-label="显示设置"
                aria-pressed={settingsOpen}
                title="显示设置"
                onClick={() => {
                  setSettingsOpen((value) => !value)
                  setInfoOpen(false)
                }}
              >
                <SettingsIcon />
              </button>
              {onZoom ? (
                <button
                  type="button"
                  className={styles.iconButton}
                  data-action="zoom"
                  aria-label="放大查看"
                  title="页内放大查看"
                  disabled={!ready}
                  onClick={() => {
                    viewerRef.current?.clearUserInput()
                    onZoom()
                  }}
                >
                  <ZoomIcon />
                </button>
              ) : null}
              <button
                type="button"
                className={styles.iconButton}
                aria-label={fullscreen ? '退出全屏' : '全屏查看'}
                title={fullscreen ? '退出全屏' : '全屏查看'}
                onClick={() => void toggleFullscreen()}
              >
                {fullscreen ? <ExitFullscreenIcon /> : <FullscreenIcon />}
              </button>
              <button
                type="button"
                className={styles.iconButton}
                aria-label="保存 PNG 截图"
                title="保存当前画面 PNG（含 Bloom）"
                disabled={!ready}
                onClick={() => void capture()}
              >
                <ImageIcon />
              </button>
              <button
                type="button"
                className={classNames(styles.iconButton, recording.recording && styles.iconButtonDanger)}
                aria-label={recordingBusy ? '正在停止录制' : recording.recording ? '停止录制' : '录制 35 秒'}
                title={recordingBusy ? '正在释放录制资源' : recording.recording ? '停止录制' : '录制 35 秒视频（无音频）'}
                disabled={!ready || recordingBusy}
                onClick={() => void toggleRecording()}
              >
                {recording.recording || recordingBusy ? <StopIcon /> : <RecordIcon />}
              </button>
              {showEnd ? (
                <Button
                  className={styles.endButton}
                  onClick={() => void endPreview()}
                  disabled={!onEnd}
                >
                  {endLabel}
                </Button>
              ) : null}
            </div>
          </div>
          <p className={styles.recordingLine} role="status">
            {recording.recording ? recordingLabel : recordingResult ? recordingLabel : ''}
            {recordingResult && !recording.recording ? (
              <button
                type="button"
                className={styles.downloadLink}
                onClick={() => downloadRecording(recordingResult)}
              >
                下载视频
              </button>
            ) : null}
          </p>
        </div>

        {phaseBusy ? (
          <div className={styles.statusOverlay} role="status" aria-live="polite">
            <div className={styles.statusCard}>
              <span className={styles.spinner} aria-hidden="true" />
              <p className={styles.statusTitle}>{PHASE_LABEL[phase]}</p>
              {progress ? (
                <>
                  <p className={styles.statusText}>
                    {formatBytes(progress.loaded)}
                    {progress.total !== null ? ` / ${formatBytes(progress.total)}` : ''}
                    {progressPercent !== null ? ` · ${progressPercent.toFixed(1)}%` : ''}
                  </p>
                  <div
                    className={styles.progressTrack}
                    role="progressbar"
                    aria-label="模型读取进度"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={progressPercent === null ? undefined : Math.round(progressPercent)}
                    aria-valuetext={
                      progressPercent === null ? `已读取 ${formatBytes(progress.loaded)}` : `${progressPercent.toFixed(0)}%`
                    }
                  >
                    <span
                      className={styles.progressBar}
                      style={{ width: `${progressPercent ?? 8}%` }}
                    />
                  </div>
                  <p className={styles.statusHint}>仅显示实际已读取字节，不使用计时假进度。</p>
                </>
              ) : (
                <p className={styles.statusText}>正在处理真实模型，请稍候。</p>
              )}
            </div>
          </div>
        ) : null}

        {error ? (
          <div className={styles.statusOverlay} role="alert">
            <div className={classNames(styles.statusCard, styles.errorCard)}>
              <p className={styles.statusTitle}>{error.title}</p>
              <p className={styles.statusText}>{error.message}</p>
              <p className={styles.statusHint}>{error.advice}</p>
              <p className={styles.errorCode}>错误代码：{error.code}</p>
              <div className={styles.statusActions}>
                {error.retryable ? (
                  <Button variant="primary" onClick={() => void viewerRef.current?.reload()}>
                    手动重试
                  </Button>
                ) : null}
                {showEnd ? (
                  <Button onClick={() => void endPreview()} disabled={!onEnd}>
                    {endLabel}
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

        {infoOpen ? (
          <aside className={styles.infoPanel} aria-label="模型信息">
            <div className={styles.panelHead}>
              <h3 className={styles.panelTitle}>模型信息</h3>
              <button type="button" className={styles.closeButton} aria-label="关闭模型信息" onClick={() => setInfoOpen(false)}>
                <CloseIcon />
              </button>
            </div>
            <dl className={styles.infoList}>
              <div>
                <dt>来源</dt>
                <dd className={styles.break}>{sourceLabel}</dd>
              </div>
              <div>
                <dt>格式</dt>
                <dd>{info?.format === 'gaussian-ply' ? '3DGS 高斯 PLY' : info?.format === 'glb' ? 'glTF 2.0 GLB' : isGaussian ? '3DGS 高斯 PLY' : isGlb ? 'glTF 2.0 GLB' : '—'}</dd>
              </div>
              <div>
                <dt>大小</dt>
                <dd>{info ? formatBytes(info.bytes) : '—'}</dd>
              </div>
              <div>
                <dt>显示坐标系</dt>
                <dd>右手 Z-up · 源 {info?.sourceUp === 'y' ? 'Y-up（已纠正）' : 'Z-up（原样）'}</dd>
              </div>
              <div>
                <dt>方向叠加</dt>
                <dd>
                  X {info?.orientation.x ?? 0} · Y {info?.orientation.y ?? 0} · Z {info?.orientation.z ?? 0}
                </dd>
              </div>
              <div>
                <dt>包围盒</dt>
                <dd>
                  {info
                    ? `${info.bounds.size.map((value) => value.toFixed(2)).join(' × ')}（相对单位）`
                    : '—'}
                </dd>
              </div>
              {info?.splats !== null && info?.splats !== undefined ? (
                <div>
                  <dt>高斯点</dt>
                  <dd>{formatNumber(info.splats)}</dd>
                </div>
              ) : null}
              {info?.triangles !== null && info?.triangles !== undefined ? (
                <div>
                  <dt>三角面</dt>
                  <dd>{formatNumber(info.triangles)}</dd>
                </div>
              ) : null}
              {info?.shDegree !== null && info?.shDegree !== undefined ? (
                <div>
                  <dt>球谐阶数</dt>
                  <dd>{info.shDegree}（f_rest {info.shDegree === 0 ? 0 : info.shDegree === 1 ? 9 : info.shDegree === 2 ? 24 : 45}）</dd>
                </div>
              ) : null}
              <div>
                <dt>材质 / 贴图</dt>
                <dd>
                  {info ? `${formatNumber(info.materials)} / ${formatNumber(info.textures)}` : '—'}
                </dd>
              </div>
            </dl>
            <h4 className={styles.infoSubTitle}>当前会话帧统计</h4>
            <dl className={styles.infoList}>
              <div>
                <dt>canvas / DPR</dt>
                <dd>
                  {stats ? `${stats.width}×${stats.height} / ${stats.dpr}` : '等待帧统计…'}
                </dd>
              </div>
              <div>
                <dt>fps / p50 / p95</dt>
                <dd>
                  {stats
                    ? `${formatMetric(stats.fps)} / ${formatMetric(stats.p50Ms)}ms / ${formatMetric(stats.p95Ms)}ms`
                    : '—'}
                </dd>
              </div>
              <div>
                <dt>长帧 &gt; 50ms</dt>
                <dd>{stats ? `${stats.longFrames} / ${stats.frameCount}` : '—'}</dd>
              </div>
              <div>
                <dt>draw / 三角面 / 点</dt>
                <dd>
                  {stats
                    ? `${stats.drawCalls} / ${formatNumber(stats.triangles)} / ${formatNumber(stats.points)}`
                    : '—'}
                </dd>
              </div>
              <div>
                <dt>GPU 几何 / 纹理</dt>
                <dd>{stats ? `${stats.geometries} / ${stats.textures}` : '—'}</dd>
              </div>
              <div>
                <dt>JS 堆（若可读）</dt>
                <dd>{stats?.jsHeapBytes ? formatBytes(stats.jsHeapBytes) : '浏览器未提供'}</dd>
              </div>
            </dl>
            <p className={styles.panelNote}>统计来自当前浏览器会话，不跨设备外推；无单位数值不宣称米。</p>
          </aside>
        ) : null}

        {message ? (
          <p className={styles.toast} role="status">
            {message}
          </p>
        ) : null}
      </div>

      {settingsOpen ? (
        <aside className={styles.settings} aria-label="显示设置" data-viewer-shortcut-ignore="true">
          <div className={styles.panelHead}>
            <h3 className={styles.panelTitle}>显示设置</h3>
            <button
              type="button"
              className={styles.closeButton}
              aria-label="关闭显示设置"
              onClick={() => {
                viewerRef.current?.endParameterInteraction()
                setSettingsOpen(false)
                setWalkSetupOpen(false)
              }}
            >
              <CloseIcon />
            </button>
          </div>

          {walkSetupOpen ? (
            <section className={styles.walkSetup} aria-label="步行设置">
              <h4 className={styles.panelTitle}>进入步行模式</h4>
              <p className={styles.settingHint}>
                Walk 只提供地面高度约束，不防穿墙，也没有真实碰撞。包围盒底部只是建议值，
                必须确认后才会启用。
              </p>
              <div className={styles.settingRow}>
                <label className={styles.settingLabel} htmlFor="viewer-walk-ground">
                  地面高度
                </label>
                <input
                  id="viewer-walk-ground"
                  type="number"
                  step="0.01"
                  value={walkGround}
                  onFocus={() => viewerRef.current?.beginParameterInteraction()}
                  onBlur={() => viewerRef.current?.endParameterInteraction()}
                  onChange={(event) => setWalkGround(Number(event.target.value))}
                />
                <output className={styles.mono}>相对单位</output>
              </div>
              <div className={styles.settingRow}>
                <label className={styles.settingLabel} htmlFor="viewer-walk-eye">
                  视角高
                </label>
                <input
                  id="viewer-walk-eye"
                  type="number"
                  min="0.001"
                  step="0.01"
                  value={walkEye}
                  onFocus={() => viewerRef.current?.beginParameterInteraction()}
                  onBlur={() => viewerRef.current?.endParameterInteraction()}
                  onChange={(event) => setWalkEye(Number(event.target.value))}
                />
                <output className={styles.mono}>相对单位</output>
              </div>
              <div className={styles.walkStartRow}>
                <span className={styles.settingLabel}>起点 X / Y</span>
                <input
                  id="viewer-walk-start-x"
                  aria-label="步行起点 X"
                  type="number"
                  step="0.01"
                  value={walkStartX}
                  onFocus={() => viewerRef.current?.beginParameterInteraction()}
                  onBlur={() => viewerRef.current?.endParameterInteraction()}
                  onChange={(event) => setWalkStartX(Number(event.target.value))}
                />
                <input
                  id="viewer-walk-start-y"
                  aria-label="步行起点 Y"
                  type="number"
                  step="0.01"
                  value={walkStartY}
                  onFocus={() => viewerRef.current?.beginParameterInteraction()}
                  onBlur={() => viewerRef.current?.endParameterInteraction()}
                  onChange={(event) => setWalkStartY(Number(event.target.value))}
                />
              </div>
              <label className={styles.walkConfirm}>
                <input
                  type="checkbox"
                  checked={walkConfirmed}
                  onChange={(event) => setWalkConfirmed(event.target.checked)}
                />
                我确认仅地面高度约束，不是真实碰撞，也不防穿墙
              </label>
              <p className={styles.settingHint}>
                {walkAreaTrusted
                  ? '已配置可信有限步行区域；点击地面会二次确认后传送。'
                  : '没有可信有限步行区域：点击传送已禁用，只能地面行走。'}
              </p>
              <div className={styles.settingsActions}>
                <Button
                  onClick={() => {
                    viewerRef.current?.endParameterInteraction()
                    setWalkSetupOpen(false)
                  }}
                >
                  取消
                </Button>
                <Button variant="primary" disabled={!walkConfirmed} onClick={confirmWalk}>
                  确认进入步行
                </Button>
              </div>
            </section>
          ) : null}

          <div className={styles.settingRow}>
            <label className={styles.settingLabel} htmlFor="viewer-source-up">
              源坐标系
            </label>
            <select
              id="viewer-source-up"
              value={sourceUpChoice}
              onChange={(event) => changeSourceUp(event.target.value as 'auto' | 'z' | 'y')}
            >
              <option value="auto">自动（GLB Y-up / PLY Z-up）</option>
              <option value="z">Z-up 原样</option>
              <option value="y">Y-up（90° 纠正）</option>
            </select>
          </div>
          <p className={styles.settingHint}>
            只改根节点旋转，不改文件；切换后同步真实边界、target、初始相机与地面约束。
            “自动”按识别出的真实格式选择，不看后缀。
          </p>

          <div className={styles.orientationRow}>
            <span className={styles.settingLabel}>显示方向纠正</span>
            <div className={styles.choiceGroup} role="group" aria-label="显示方向纠正">
              <button type="button" className={styles.choice} onClick={() => rotateOrientation('x')}>
                X +90°
              </button>
              <button type="button" className={styles.choice} onClick={() => rotateOrientation('y')}>
                Y +90°
              </button>
              <button type="button" className={styles.choice} onClick={() => rotateOrientation('z')}>
                Z +90°
              </button>
            </div>
            <button
              type="button"
              className={styles.choice}
              disabled={!info || (info.orientation.x === 0 && info.orientation.y === 0 && info.orientation.z === 0)}
              onClick={resetOrientation}
            >
              重置方向
            </button>
          </div>
          <p className={styles.settingHint}>
            当前叠加：X {info?.orientation.x ?? 0} · Y {info?.orientation.y ?? 0} · Z {info?.orientation.z ?? 0}
            （每轴 0–3 次 +90°）。方向改变会回到 Orbit，并作废旧 Walk 地面/区域确认，需重新确认。
          </p>

          <div className={styles.settingRow}>
            <label className={styles.settingLabel} htmlFor="viewer-bloom">
              泛光 Bloom
            </label>
            <input
              id="viewer-bloom"
              type="checkbox"
              checked={bloom}
              onChange={toggleBloom}
            />
          </div>
          <div className={styles.settingRow}>
            <label className={styles.settingLabel} htmlFor="viewer-bloom-strength">
              Bloom 强度
            </label>
            <input
              id="viewer-bloom-strength"
              type="range"
              min="0.05"
              max="1.5"
              step="0.05"
              value={bloomStrength}
              disabled={!bloom}
              onPointerDown={() => viewerRef.current?.beginParameterInteraction()}
              onPointerUp={() => viewerRef.current?.endParameterInteraction()}
              onPointerCancel={() => viewerRef.current?.endParameterInteraction()}
              onBlur={() => viewerRef.current?.endParameterInteraction()}
              onChange={(event) => changeBloomStrength(Number(event.target.value))}
            />
            <output className={styles.mono}>{bloomStrength.toFixed(2)}</output>
          </div>

          <div className={styles.settingRow}>
            <span className={styles.settingLabel}>快速着色</span>
            <div className={styles.choiceGroup} role="group" aria-label="快速着色">
              <button
                type="button"
                className={classNames(styles.choice, !uniformTone && styles.choiceActive)}
                aria-pressed={!uniformTone}
                onClick={() => {
                  if (uniformTone) toggleTone()
                }}
              >
                原色
              </button>
              <button
                type="button"
                className={classNames(styles.choice, uniformTone && styles.choiceActive)}
                aria-pressed={uniformTone}
                onClick={() => {
                  if (!uniformTone) toggleTone()
                }}
              >
                统一色调
              </button>
            </div>
          </div>

          <div className={styles.settingRow}>
            <label className={styles.settingLabel} htmlFor="viewer-splat-scale">
              单 splat 尺度
            </label>
            <input
              id="viewer-splat-scale"
              type="range"
              min="0.25"
              max="3"
              step="0.05"
              value={splatScale}
              disabled={!isGaussian}
              onPointerDown={() => viewerRef.current?.beginParameterInteraction()}
              onPointerUp={() => viewerRef.current?.endParameterInteraction()}
              onPointerCancel={() => viewerRef.current?.endParameterInteraction()}
              onBlur={() => viewerRef.current?.endParameterInteraction()}
              onChange={(event) => changeSplatScale(Number(event.target.value))}
            />
            <output className={styles.mono}>×{splatScale.toFixed(2)}</output>
          </div>
          <p className={styles.settingHint}>
            {isGaussian
              ? '只乘每个高斯的局部尺度，不缩放整个 Object3D，不重建点数据。'
              : '仅高斯 PLY 可用；GLB 不提供整体或局部尺寸缩放。'}
          </p>

          <div className={styles.settingRow}>
            <label className={styles.settingLabel} htmlFor="viewer-soft-light">
              柔和补光
            </label>
            <input
              id="viewer-soft-light"
              type="checkbox"
              checked={softLight}
              disabled={!isGlb}
              onChange={toggleSoftLight}
            />
          </div>
          <div className={styles.settingRow}>
            <label className={styles.settingLabel} htmlFor="viewer-light-intensity">
              补光强度
            </label>
            <input
              id="viewer-light-intensity"
              type="range"
              min="0"
              max="2"
              step="0.05"
              value={lightIntensity}
              disabled={!isGlb || !softLight}
              onPointerDown={() => viewerRef.current?.beginParameterInteraction()}
              onPointerUp={() => viewerRef.current?.endParameterInteraction()}
              onPointerCancel={() => viewerRef.current?.endParameterInteraction()}
              onBlur={() => viewerRef.current?.endParameterInteraction()}
              onChange={(event) => changeLightIntensity(Number(event.target.value))}
            />
            <output className={styles.mono}>×{lightIntensity.toFixed(2)}</output>
          </div>
          <p className={styles.settingHint}>
            {isGlb ? '仅 GLB 使用不可见场景补光，保留原材质与贴图；默认强度 1。' : '仅 GLB 可用；高斯使用自身颜色。'}
          </p>

          <div className={styles.settingRow}>
            <label className={styles.settingLabel} htmlFor="viewer-emission">
              原有发光材质
            </label>
            <input
              id="viewer-emission"
              type="checkbox"
              checked={emission}
              disabled={!emissiveAvailable || !ready}
              onChange={toggleEmission}
            />
          </div>
          <div className={styles.settingRow}>
            <label className={styles.settingLabel} htmlFor="viewer-emission-intensity">
              发光强度
            </label>
            <input
              id="viewer-emission-intensity"
              type="range"
              min="0.1"
              max="3"
              step="0.1"
              value={emissionIntensity}
              disabled={!emissiveAvailable || !emission || !ready}
              onPointerDown={() => viewerRef.current?.beginParameterInteraction()}
              onPointerUp={() => viewerRef.current?.endParameterInteraction()}
              onPointerCancel={() => viewerRef.current?.endParameterInteraction()}
              onBlur={() => viewerRef.current?.endParameterInteraction()}
              onChange={(event) => changeEmissionIntensity(Number(event.target.value))}
            />
            <output className={styles.mono}>×{emissionIntensity.toFixed(1)}</output>
          </div>
          <p className={styles.settingHint}>
            {hasEmissive
              ? uniformTone
                ? '统一色调使用无发光的替代材质，发光控件已禁用；切回原色后保留原有设置。'
                : '只增强模型原本已有的发光材质（emissive/emissiveMap），不创建新的自发光。'
              : '当前模型没有可确认的原有发光材质，或为高斯模型，不能启用。'}
          </p>

          <div className={styles.settingRow}>
            <label className={styles.settingLabel} htmlFor="viewer-auto-rotate">
              自动旋转
            </label>
            <input
              id="viewer-auto-rotate"
              type="checkbox"
              checked={autoRotate}
              onChange={toggleAutoRotate}
            />
          </div>
          <p className={styles.settingHint}>
            默认 6°/s，仅环绕模式；按住拖动/滑块/移动键期间一直暂停，松开或失焦后等待 15 秒恢复。关闭后不会自动再开启。
          </p>

          <div className={styles.settingRow}>
            <label className={styles.settingLabel} htmlFor="viewer-fly-speed">
              飞行相对速度
            </label>
            <input
              id="viewer-fly-speed"
              type="range"
              min="0.05"
              max="2"
              step="0.05"
              value={flySpeed}
              disabled={coarsePointer}
              onPointerDown={() => viewerRef.current?.beginParameterInteraction()}
              onPointerUp={() => viewerRef.current?.endParameterInteraction()}
              onPointerCancel={() => viewerRef.current?.endParameterInteraction()}
              onBlur={() => viewerRef.current?.endParameterInteraction()}
              onChange={(event) => changeFlySpeed(Number(event.target.value))}
            />
            <output className={styles.mono}>×{flySpeed.toFixed(2)}</output>
          </div>
          <div className={styles.settingRow}>
            <label className={styles.settingLabel} htmlFor="viewer-walk-speed">
              步行相对速度
            </label>
            <input
              id="viewer-walk-speed"
              type="range"
              min="0.05"
              max="2"
              step="0.05"
              value={walkSpeed}
              disabled={coarsePointer}
              onPointerDown={() => viewerRef.current?.beginParameterInteraction()}
              onPointerUp={() => viewerRef.current?.endParameterInteraction()}
              onPointerCancel={() => viewerRef.current?.endParameterInteraction()}
              onBlur={() => viewerRef.current?.endParameterInteraction()}
              onChange={(event) => changeWalkSpeed(Number(event.target.value))}
            />
            <output className={styles.mono}>×{walkSpeed.toFixed(2)}</output>
          </div>
          <p className={styles.settingHint}>
            速度按模型尺度与 dt 计算；飞行/步行为桌面核心功能，触屏不启用。参数变化不重解析模型。
          </p>

          <div className={styles.settingRow}>
            <label className={styles.settingLabel} htmlFor="viewer-touch">
              启用触控操作
            </label>
            <input
              id="viewer-touch"
              type="checkbox"
              checked={touchEnabled}
              onChange={toggleTouch}
            />
          </div>
          <p className={styles.settingHint}>
            启用后仅画布内：单指旋转、双指平移与缩放；不劫持正文滚动。飞行/步行为桌面核心功能。
          </p>

          <div className={styles.settingsActions}>
            <Button onClick={resetDisplay}>恢复显示默认</Button>
            <span className={styles.settingHint}>只重置显示参数，不动相机。</span>
          </div>
          <p className={styles.panelNote}>
            参数更新只改变 uniform 或材质，不重新解析模型，也不重建全量点数据。
          </p>
        </aside>
      ) : null}
    </div>
  )
}
