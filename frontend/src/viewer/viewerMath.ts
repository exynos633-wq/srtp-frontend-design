import * as THREE from 'three'
import { ViewerError } from './errors'
import type { BoundsInfo, SourceUp } from './types'

export const LOW_POWER_DPR_CAP = 1
export const DEFAULT_DPR_CAP = 1.5

export function resolveDpr(cap: number, lowPower: boolean): number {
  const device = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1
  const effectiveCap = lowPower ? Math.min(cap, LOW_POWER_DPR_CAP) : cap
  return Math.max(1, Math.min(device, effectiveCap))
}

export function isLowPowerDevice(): boolean {
  if (typeof navigator === 'undefined') return false
  const cores = navigator.hardwareConcurrency ?? 8
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8
  return cores <= 4 || memory <= 4
}

/** 源坐标系到显示坐标系（右手 Z-up）的根节点旋转；不改源文件。 */
export function sourceUpRotation(up: SourceUp): THREE.Euler {
  // glTF 标准 Y-up：绕 X +90°，把 +Y 转到 +Z；3DGS PLY 首期按 Z-up 原样。
  return up === 'y' ? new THREE.Euler(Math.PI / 2, 0, 0) : new THREE.Euler(0, 0, 0)
}

export function assertFiniteBounds(bounds: BoundsInfo): void {
  const values = [...bounds.min, ...bounds.max, ...bounds.size, ...bounds.center]
  if (!values.every((value) => Number.isFinite(value))) throw new ViewerError('INVALID_BOUNDS')
  if (Math.hypot(...bounds.size) < 1e-9) throw new ViewerError('INVALID_BOUNDS', '包围盒尺寸为零。')
}

export function boxToBounds(box: THREE.Box3): BoundsInfo {
  const min = box.min
  const max = box.max
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  return {
    min: [min.x, min.y, min.z],
    max: [max.x, max.y, max.z],
    size: [size.x, size.y, size.z],
    center: [center.x, center.y, center.z],
  }
}

export interface FittedCamera {
  position: THREE.Vector3
  target: THREE.Vector3
  near: number
  far: number
  radius: number
  minDistance: number
  maxDistance: number
}

/**
 * 用有效包围盒和画布宽高适配完整外部视图。距离同时满足水平与垂直视场，
 * 不用固定距离，也不为球形全景壳自动猜内部视角。
 */
export function fitCameraToBounds(
  bounds: BoundsInfo,
  aspect: number,
  fovDeg = 45,
): FittedCamera {
  const size = new THREE.Vector3(...bounds.size)
  const target = new THREE.Vector3(...bounds.center)
  const radius = Math.max(size.length() / 2, 1e-6)
  const direction = new THREE.Vector3(0.9, -1, 0.72).normalize()
  const camera = new THREE.PerspectiveCamera(fovDeg, Math.max(0.2, aspect), 0.001, radius * 1000)
  camera.up.set(0, 0, 1)
  const corners = [
    new THREE.Vector3(bounds.min[0], bounds.min[1], bounds.min[2]),
    new THREE.Vector3(bounds.max[0], bounds.min[1], bounds.min[2]),
    new THREE.Vector3(bounds.min[0], bounds.max[1], bounds.min[2]),
    new THREE.Vector3(bounds.max[0], bounds.max[1], bounds.min[2]),
    new THREE.Vector3(bounds.min[0], bounds.min[1], bounds.max[2]),
    new THREE.Vector3(bounds.max[0], bounds.min[1], bounds.max[2]),
    new THREE.Vector3(bounds.min[0], bounds.max[1], bounds.max[2]),
    new THREE.Vector3(bounds.max[0], bounds.max[1], bounds.max[2]),
  ]
  let distance = Math.max(radius * 2.4, 1e-5)
  const projected = new THREE.Vector3()
  for (let iteration = 0; iteration < 14; iteration += 1) {
    camera.position.copy(target).addScaledVector(direction, distance)
    camera.lookAt(target)
    camera.updateMatrixWorld(true)
    let extent = 0
    for (const corner of corners) {
      projected.copy(corner).project(camera)
      extent = Math.max(extent, Math.abs(projected.x), Math.abs(projected.y))
    }
    if (extent > 0.9) distance *= 1.08
    else if (extent < 0.8) distance *= 0.94
    else break
  }
  const position = target.clone().addScaledVector(direction, distance)
  const near = Math.max(radius / 2000, 0.001)
  const far = Math.max(radius * 80, distance * 8)
  return {
    position,
    target,
    near,
    far,
    radius,
    minDistance: Math.max(radius * 0.015, 1e-5),
    maxDistance: Math.max(radius * 30, distance * 4),
  }
}

export function cameraYawPitch(direction: THREE.Vector3): { yaw: number; pitch: number } {
  const normalized = direction.clone().normalize()
  return {
    yaw: Math.atan2(normalized.y, normalized.x),
    pitch: Math.asin(THREE.MathUtils.clamp(normalized.z, -1, 1)),
  }
}

export function directionFromYawPitch(yaw: number, pitch: number): THREE.Vector3 {
  const cosPitch = Math.cos(pitch)
  return new THREE.Vector3(cosPitch * Math.cos(yaw), cosPitch * Math.sin(yaw), Math.sin(pitch))
}

/** 固定录制输出尺寸：起始比例、最长边不超过 1280，宽高取偶数。 */
export function recordingSize(width: number, height: number, maxEdge = 1280): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: 2, height: 2 }
  const scale = Math.min(1, maxEdge / Math.max(width, height))
  const even = (value: number) => Math.max(2, Math.round(value / 2) * 2)
  return { width: even(width * scale), height: even(height * scale) }
}

export function sanitizeFilename(name: string): string {
  const cleaned = Array.from(name)
    .map((character) => (character.charCodeAt(0) < 32 ? '-' : character))
    .join('')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return cleaned.slice(0, 80) || 'model'
}

export function timestampForFilename(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

export interface RecordingMime {
  mimeType: string
  extension: 'webm' | 'mp4'
}

/** 只在浏览器实际报告支持时选择 MIME，扩展名与容器一致。 */
export function pickRecordingMime(): RecordingMime | null {
  if (typeof MediaRecorder === 'undefined') return null
  const candidates: RecordingMime[] = [
    { mimeType: 'video/webm;codecs=vp9', extension: 'webm' },
    { mimeType: 'video/webm;codecs=vp8', extension: 'webm' },
    { mimeType: 'video/webm', extension: 'webm' },
    { mimeType: 'video/mp4;codecs=avc1.42E01E', extension: 'mp4' },
    { mimeType: 'video/mp4', extension: 'mp4' },
  ]
  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate.mimeType)) ?? null
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.rel = 'noopener'
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
