export interface ViewerRecordingResult {
  mimeType: string
  extension: string
  sourceName: string
  wallClockMs: number
  complete: boolean
  reason: string
  blob: Blob
}

export interface ViewerDebug {
  phase: string
  mode: string
  error: { code: string; title: string; message: string } | null
  info: {
    format: string
    sourceName: string
    bytes: number
    splats: number | null
    triangles: number | null
    shDegree: number | null
    sourceUp: string
    orientation: { x: number; y: number; z: number }
    bounds: { size: number[] }
  } | null
  stats: {
    width: number
    height: number
    dpr: number
    fps: number
    p50Ms: number
    p95Ms: number
    longestMs: number
    longFrames: number
    drawCalls: number
    triangles: number
    geometries: number
    textures: number
    jsHeapBytes: number | null
  } | null
  camera: { position: number[]; target: number[]; up: number[]; near: number; far: number }
  autoRotate: { enabled: boolean; userDisabled: boolean }
  display: {
    bloom: boolean
    bloomStrength: number
    splatScale: number
    lightIntensity: number
    emissionIntensity: number
  }
  sourceUpOverride: 'y' | 'z' | null
  orientation: { x: number; y: number; z: number }
  speed: { fly: number; walk: number }
  walk: { ground: number; eyeHeight: number; start: [number, number] | null; areaTrusted: boolean }
  recording: {
    elapsedMs: number
    width: number
    height: number
    liveTracks: number
  } | null
  stopping: boolean
  lastRecordingTrackStates: string[]
  timings: {
    loadStart: number
    readEnd: number
    parseStart: number
    initializeStart: number
    ready: number
    firstFrame: number
  }
}

declare global {
  interface Window {
    __srtpModelViewer?: {
      getDebugState: () => ViewerDebug
      getPhase: () => string
      getStats: () => ViewerDebug['stats']
      getLastRecording: () => ViewerRecordingResult | null
      setAutoRotate: (enabled: boolean) => void
      setTouchEnabled: (enabled: boolean) => void
      setSourceUp: (up: 'y' | 'z' | null) => void
      beginParameterInteraction: () => void
      endParameterInteraction: () => void
      keys?: Set<string>
    }
    __srtpLastViewerDisposal?: {
      at: number
      info: { format: string; bytes: number } | null
      lastStats: ViewerDebug['stats']
      timings: ViewerDebug['timings']
      geometries: number
      textures: number
      recording: null
      videoTracks: number
    }
  }
}
