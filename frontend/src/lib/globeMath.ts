import { Vector3 } from 'three'

/** 地球场景的纯计算部分：经纬度、构图、可见性与相机距离。 */
export const GLOBE_FOV = 35
export const MIN_ZOOM = 1
export const MAX_ZOOM = 1.6
/** 边缘光外壳相对球体的放大比例，用于把目标直径换算成相机距离。 */
export const ATMOSPHERE_SCALE = 1.028
export const MIN_LATITUDE = -70
export const MAX_LATITUDE = 70
/** 球面点积在可见地平线之外的极小余量，避免边缘点被当成正面。 */
export const FRONT_FACING_THRESHOLD = 0.01

export interface GlobeView {
  longitude: number
  latitude: number
  /** 1.00–1.60，由相机距离体现。 */
  zoom: number
}

export const INITIAL_VIEW: GlobeView = {
  longitude: 105,
  latitude: 35,
  zoom: 1,
}

/** 开场从稍微拉远、偏西的视角靠近中国。 */
export const OPENING_VIEW: GlobeView = {
  longitude: 95,
  latitude: 28,
  zoom: 1,
}

const DEG2RAD = Math.PI / 180

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** 水平连续旋转，结果落在 [-180, 180)。 */
export function normalizeLongitude(longitude: number): number {
  return ((((longitude + 180) % 360) + 360) % 360) - 180
}

/** 从 from 到 to 的最短经度方向，避免绕远路。 */
export function shortestLongitudeDelta(from: number, to: number): number {
  return ((((to - from + 540) % 360) + 360) % 360) - 180
}

/**
 * 拖拽松手后的惯性目标保持连续经度；跨越 ±180° 时不在补间中途换向。
 * 结果只在补间完成后归一化。
 */
export function inertiaTargetLongitude(longitude: number, lastDx: number): number {
  return longitude - lastDx * 0.2 * 4
}

/** 与 Three.js SphereGeometry 默认 UV 对应的等距圆柱坐标。 */
export function latLonToVector3(latitude: number, longitude: number, radius = 1): Vector3 {
  const phi = (90 - latitude) * DEG2RAD
  const theta = (longitude + 180) * DEG2RAD
  return new Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta),
  )
}

/**
 * 单位球面上的点 P 与相机 C：只有 P·C > 1 才位于相机可见的地平线内。
 * 归一化相机方向会丢掉距离，透视相机必须按真实距离判断。
 */
export function isPointFrontFacing(
  point: Vector3,
  cameraPosition: Vector3,
  threshold = FRONT_FACING_THRESHOLD,
): boolean {
  if (cameraPosition.lengthSq() < 1e-8) return false
  return point.dot(cameraPosition) > 1 + threshold
}

/** 点是否位于朝向相机的一侧；背面与地平线外的点不能命中。 */
export function isFrontFacing(
  latitude: number,
  longitude: number,
  cameraPosition: Vector3,
  threshold = FRONT_FACING_THRESHOLD,
): boolean {
  return isPointFrontFacing(latLonToVector3(latitude, longitude), cameraPosition, threshold)
}

/** 从投影点位中选最近的可命中点；隐藏点不参与指针命中。 */
export function nearestFrontPoint<T extends { x: number; y: number; front: boolean }>(
  points: Iterable<T>,
  x: number,
  y: number,
  maxDistance = 26,
): T | null {
  let nearest: T | null = null
  let nearestDistance = maxDistance
  for (const point of points) {
    if (!point.front) continue
    const distance = Math.hypot(point.x - x, point.y - y)
    if (distance < nearestDistance) {
      nearestDistance = distance
      nearest = point
    }
  }
  return nearest
}

/**
 * v2 展陈构图：桌面留出左侧标题，手机上方留出介绍与入口。
 */
export function globeDiameterForViewport(width: number, height: number): number {
  if (width < 768) return Math.min(width * 0.94, height * 0.56)
  if (width < 1024) return Math.min(width * 0.6, height * 0.72)
  return Math.min(760, width * 0.54, height * 0.94)
}

/** 相机到球心的距离：让球体连同边缘光的外径接近目标像素。 */
export function cameraDistanceForDiameter(
  viewportHeight: number,
  diameter: number,
  fov = GLOBE_FOV,
): number {
  const safeDiameter = Math.max(1, diameter)
  const halfFov = (fov * DEG2RAD) / 2
  // 透视下球体轮廓略大于 tan 公式；按外沿半径反解相机距离。
  const screenRatio = (safeDiameter * Math.tan(halfFov)) / viewportHeight
  const distance = ATMOSPHERE_SCALE / Math.sin(Math.atan(screenRatio))
  return clamp(distance, 2.2, 24)
}

/** 与可见标题错开：桌面偏右，手机偏下。 */
export function globeViewOffset(
  width: number,
  height: number,
): { x: number; y: number; horizontal: number; vertical: number } {
  const horizontal = width < 768 ? 0.5 : 0.69
  const vertical = width < 768 ? 0.64 : 0.54
  return {
    x: (0.5 - horizontal) * width,
    y: (0.5 - vertical) * height,
    horizontal,
    vertical,
  }
}

export interface CityBubblePlacement {
  left: number
  top: number
  side: 'right' | 'left' | 'above' | 'below'
  /** 连接线落点：气泡靠近点位的那条边。 */
  lineX: number
  lineY: number
}

/**
 * 城市气泡的避让：优先右侧，其次左侧、上方、下方，最后沿边缘平移。
 * 输入与输出都是场景坐标，便于单元测试和逐帧定位。
 */
export function placeCityBubble({
  x,
  y,
  stageWidth,
  stageHeight,
  bubbleWidth,
  bubbleHeight,
  mobile,
}: {
  x: number
  y: number
  stageWidth: number
  stageHeight: number
  bubbleWidth: number
  bubbleHeight: number
  mobile: boolean
}): CityBubblePlacement | null {
  const margin = mobile ? 16 : 24
  const topInset = mobile ? 16 : 96
  const gap = mobile ? 14 : 18
  const maxWidth = Math.max(0, stageWidth - margin * 2)
  const maxHeight = Math.max(0, stageHeight - topInset - margin)
  if (maxWidth <= 0 || maxHeight <= 0) return null

  const width = Math.min(Math.max(1, bubbleWidth), maxWidth)
  const height = Math.min(Math.max(1, bubbleHeight), maxHeight)
  const lowest = stageHeight - margin - height
  const centredLeft = clamp(x - width / 2, margin, stageWidth - margin - width)
  const centredTop = clamp(y - height / 2, topInset, lowest)

  let left: number
  let top: number
  let side: CityBubblePlacement['side'] = 'right'

  if (x + gap + width <= stageWidth - margin) {
    left = x + gap
    top = clamp(y - height * 0.28, topInset, lowest)
  } else if (x - gap - width >= margin) {
    left = x - gap - width
    top = clamp(y - height * 0.28, topInset, lowest)
    side = 'left'
  } else if (y - gap - height >= topInset) {
    top = y - gap - height
    left = centredLeft
    side = 'above'
  } else if (y + gap + height <= stageHeight - margin) {
    top = y + gap
    left = centredLeft
    side = 'below'
  } else {
    // 空间不足时优先保留右下方向，并沿边缘平移；不缩小命中区。
    const spaceRight = stageWidth - margin - x
    const spaceLeft = x - margin
    if (spaceRight >= spaceLeft) {
      left = clamp(x + gap, margin, stageWidth - margin - width)
    } else {
      left = clamp(x - gap - width, margin, stageWidth - margin - width)
      side = 'left'
    }
    top = centredTop
  }

  const lineInset = 16
  const lineX =
    side === 'left'
      ? left + width
      : side === 'above' || side === 'below'
        ? clamp(x, left + lineInset, left + width - lineInset)
        : left
  const lineY =
    side === 'above'
      ? top + height
      : side === 'below'
        ? top
        : clamp(y, top + lineInset, top + height - lineInset)

  return { left, top, side, lineX, lineY }
}

/** 仅用于启动检测；不在渲染过程中创建 WebGL 上下文。 */
export function isWebGLAvailable(): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false
  try {
    const canvas = document.createElement('canvas')
    const context =
      canvas.getContext('webgl2') ??
      canvas.getContext('webgl') ??
      canvas.getContext('experimental-webgl')
    return Boolean(context)
  } catch {
    return false
  }
}
