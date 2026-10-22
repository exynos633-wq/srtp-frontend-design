import type { ModelFormat } from '../types/work'

/** 宿主显式提供的模型 URL；version 变化表示资源版本变化。 */
export interface UrlModelSource {
  kind: 'url'
  url: string
  version: string
  name?: string
}

/**
 * 查看器的模型来源。URL 必须带 version：替换资源后 version 变化，
 * 查看器据此丢弃旧任务与旧缓存；File 只存在于本地内存，不进入请求缓存。
 */
export type ModelSource =
  | UrlModelSource
  | {
      kind: 'file'
      file: File
      version?: string
      name?: string
    }


export type ViewerPhase =
  | 'idle'
  | 'read'
  | 'parse'
  | 'initialize'
  | 'ready'
  | 'error'
  | 'ended'

export type ViewerMode = 'orbit' | 'fly' | 'walk'

/** 源文件坐标系。GLB 标准为 Y-up；3DGS PLY 默认按 Z-up 原样展示。 */
export type SourceUp = 'y' | 'z'

export interface WalkArea {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

export interface ModelViewConfig {
  /** 显示坐标系固定右手 Z-up；这里只声明源坐标系，不改文件。 */
  sourceUp?: SourceUp
  /** 在源方向纠正后叠加绕显示坐标轴 X/Y/Z 的 +90°（计数 0..3）。 */
  orientation?: OrientationCorrection
  /** 根节点尺度标定（不是相机缩放，也不改文件）。 */
  scale?: number
  /** 可选初始相机；坐标为模型根节点变换后的世界坐标。 */
  initialCamera?: {
    position?: [number, number, number]
    target?: [number, number, number]
  } | null
  /** 可选地面约束。未设置时 Walk 使用 bounds 底部作为建议值。 */
  ground?: { height: number } | null
  /** 可信的有限步行区域；没有时禁用点击传送，只能地面行走。 */
  walkArea?: WalkArea | null
  walkAreaTrusted?: boolean
  /** 视角高度，默认按模型尺度推导；无单位时不宣称米。 */
  eyeHeight?: number
  /** 合法起点；未设置时从地面/中心附近开始。 */
  walkStart?: [number, number] | null
}

export interface ModelViewerOptions {
  autoRotate?: boolean
  /** 度/秒；默认 6。 */
  autoRotateSpeed?: number
  /** 交互结束后恢复自动旋转的等待时间，默认 15000ms。 */
  resumeDelayMs?: number
  /** 像素比上限；默认 1.5，低档设备 1。 */
  dprCap?: number
  lowPower?: boolean
  reducedMotion?: boolean
  flySpeed?: number
  walkSpeed?: number
  backgroundColor?: number
  /** 录制结束是否自动下载；卸载清理时永远不自动下载。 */
  autoDownloadRecording?: boolean
  onEvent?: (event: ModelViewerEvent) => void
}

export interface BoundsInfo {
  min: [number, number, number]
  max: [number, number, number]
  size: [number, number, number]
  center: [number, number, number]
}

export interface OrientationCorrection {
  /** 每个轴在源方向纠正之后再叠加多少个 +90°。 */
  x: number
  y: number
  z: number
}

export interface ModelInfo {
  format: ModelFormat
  sourceName: string
  bytes: number
  sourceUp: SourceUp
  orientation: OrientationCorrection
  bounds: BoundsInfo
  splats: number | null
  triangles: number | null
  materials: number | null
  textures: number | null
  shDegree: number | null
  /** 仅 GLB：是否存在可确认的原有发光材质；高斯为 null。 */
  hasEmissive: boolean | null
}

export type ViewerErrorCode =
  | 'NO_SOURCE'
  | 'UNSUPPORTED_SOURCE'
  | 'WEBGL2_UNAVAILABLE'
  | 'CONTEXT_LOST'
  | 'NETWORK'
  | 'HTTP'
  | 'ABORTED'
  | 'MAGIC'
  | 'PLY_HEADER'
  | 'PLY_FORMAT'
  | 'PLY_FIELDS'
  | 'PLY_LENGTH'
  | 'PLY_VALUES'
  | 'GLB_HEADER'
  | 'GLB_JSON'
  | 'GLB_EXTERNAL'
  | 'GLB_EXTENSION'
  | 'DECODER_REQUIRED'
  | 'PARSE'
  | 'SPARK'
  | 'EMPTY_MODEL'
  | 'INVALID_BOUNDS'
  | 'RECORDING_UNSUPPORTED'
  | 'RECORDING_BUSY'
  | 'SCREENSHOT_FAILED'
  | 'UNKNOWN'

export interface ViewerErrorInfo {
  code: ViewerErrorCode
  title: string
  message: string
  advice: string
  retryable: boolean
}

export interface ReadProgress {
  phase: 'read'
  loadedBytes: number
  totalBytes: number | null
  percent: number | null
}

export interface ViewerStats {
  at: number
  phase: ViewerPhase
  fps: number
  frameCount: number
  p50Ms: number
  p95Ms: number
  longestMs: number
  longFrames: number
  dpr: number
  width: number
  height: number
  drawCalls: number
  triangles: number
  points: number
  geometries: number
  textures: number
  jsHeapBytes: number | null
}

export type RecordingStopReason = 'complete' | 'manual' | 'hidden' | 'replace' | 'end' | 'error' | 'unmount'

export interface RecordingResult {
  blob: Blob
  mimeType: string
  extension: 'webm' | 'mp4'
  /** 录制开始时的模型来源名，停止晚于替换时仍保留旧身份。 */
  sourceName: string
  /** 从开始到 stop 的墙钟时间，不是已解码媒体时长。 */
  wallClockMs: number
  complete: boolean
  reason: RecordingStopReason
}

export interface RecordingState {
  recording: boolean
  elapsedMs: number
  remainingMs: number
  targetMs: number
}

export type ModelViewerEvent =
  | { type: 'phase'; phase: ViewerPhase; detail?: string }
  | { type: 'progress'; progress: ReadProgress }
  | { type: 'ready'; info: ModelInfo }
  | { type: 'info'; info: ModelInfo }
  | { type: 'error'; error: ViewerErrorInfo }
  | { type: 'stats'; stats: ViewerStats }
  | { type: 'mode'; mode: ViewerMode }
  | { type: 'autoRotate'; enabled: boolean; userDisabled: boolean }
  | { type: 'recording'; state: RecordingState }
  | { type: 'recordingReady'; result: RecordingResult }
  | { type: 'screenshot'; blob: Blob; filename: string }
  | { type: 'ended' }

export const DEFAULT_AUTO_ROTATE_SPEED = 6
export const DEFAULT_RESUME_DELAY_MS = 15_000
export const DEFAULT_DPR_CAP = 1.5
export const LOW_POWER_DPR_CAP = 1
export const RECORDING_TARGET_MS = 35_000
