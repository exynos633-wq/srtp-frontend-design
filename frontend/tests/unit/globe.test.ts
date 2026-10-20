import { describe, expect, it } from 'vitest'
import {
  ATMOSPHERE_SCALE,
  FRONT_FACING_THRESHOLD,
  GLOBE_FOV,
  MAX_LATITUDE,
  MIN_LATITUDE,
  cameraDistanceForDiameter,
  clamp,
  globeDiameterForViewport,
  globeViewOffset,
  inertiaTargetLongitude,
  isFrontFacing,
  isPointFrontFacing,
  latLonToVector3,
  nearestFrontPoint,
  normalizeLongitude,
  placeCityBubble,
  shortestLongitudeDelta,
} from '../../src/lib/globeMath'

describe('地球坐标与构图', () => {
  it('经度连续归一化到 [-180, 180)', () => {
    expect(normalizeLongitude(190)).toBe(-170)
    expect(normalizeLongitude(-190)).toBe(170)
    expect(normalizeLongitude(540)).toBe(-180)
  })

  it('选择最短经度方向，不绕远路', () => {
    expect(shortestLongitudeDelta(170, -170)).toBe(20)
    expect(shortestLongitudeDelta(-170, 170)).toBe(-20)
    expect(shortestLongitudeDelta(0, 90)).toBe(90)
  })

  it('经纬度与 Three.js 球面 UV 对齐', () => {
    const equator = latLonToVector3(0, 0)
    expect(equator.x).toBeCloseTo(1)
    expect(equator.y).toBeCloseTo(0)
    expect(equator.z).toBeCloseTo(0)

    const northPole = latLonToVector3(90, 0)
    expect(northPole.y).toBeCloseTo(1)
  })

  it('只让朝向相机的点参与命中', () => {
    const camera = latLonToVector3(0, 90, 5)
    expect(isFrontFacing(0, 90, camera)).toBe(true)
    expect(isFrontFacing(0, 270, camera)).toBe(false)
    expect(FRONT_FACING_THRESHOLD).toBeGreaterThan(0)
  })

  it('纬度被限制在可视范围内', () => {
    expect(clamp(90, MIN_LATITUDE, MAX_LATITUDE)).toBe(MAX_LATITUDE)
    expect(clamp(-90, MIN_LATITUDE, MAX_LATITUDE)).toBe(MIN_LATITUDE)
  })
})

describe('拖拽惯性跨越日期变更线', () => {
  it('向东跨过 +180° 时保持正的连续目标，完成后归一化', () => {
    const from = 179
    const target = inertiaTargetLongitude(from, -3)
    expect(target).toBeCloseTo(181.4)
    expect(target - from).toBeCloseTo(2.4)
    expect(normalizeLongitude(target)).toBeCloseTo(-178.6)
  })

  it('向西跨过 -180° 时保持负的连续目标，完成后归一化', () => {
    const from = -179
    const target = inertiaTargetLongitude(from, 3)
    expect(target).toBeCloseTo(-181.4)
    expect(target - from).toBeCloseTo(-2.4)
    expect(normalizeLongitude(target)).toBeCloseTo(178.6)
  })
})

describe('透视相机可见性与命中', () => {
  const cameraAt = (distance: number) => latLonToVector3(0, 90, distance)

  it('近距离相机按真实地平线隐藏外侧点', () => {
    const camera = cameraAt(3)
    expect(isFrontFacing(0, 90, camera)).toBe(true)
    expect(isFrontFacing(0, 155, camera)).toBe(true)
    // 距离 3 时地平线约 70.53°：70° 仍可见，71° 已遮挡。
    expect(isFrontFacing(0, 160, camera)).toBe(true)
    expect(isFrontFacing(0, 161, camera)).toBe(false)
    expect(isFrontFacing(0, 165, camera)).toBe(false)
    expect(isPointFrontFacing(latLonToVector3(0, 165), camera)).toBe(false)
  })

  it('远距离相机放宽可见范围，但仍隐藏背面点', () => {
    const camera = cameraAt(8)
    expect(isFrontFacing(0, 165, camera)).toBe(true)
    expect(isFrontFacing(0, 180, camera)).toBe(false)
  })

  it('相机位于球心时不把任何点当成正面', () => {
    const camera = latLonToVector3(0, 90, 0)
    expect(isFrontFacing(0, 90, camera)).toBe(false)
  })

  it('隐藏点不参与最近正面点选择', () => {
    const hidden = { id: 'hidden', x: 100, y: 100, front: false }
    const visible = { id: 'visible', x: 125, y: 100, front: true }
    expect(nearestFrontPoint([hidden, visible], 102, 100)?.id).toBe('visible')
    expect(nearestFrontPoint([hidden], 100, 100)).toBeNull()
  })

  it('地平线外的点即使投影位置最近也不能命中', () => {
    const camera = cameraAt(3)
    const occluded = { id: 'occluded', x: 100, y: 100, front: isFrontFacing(0, 165, camera) }
    expect(occluded.front).toBe(false)
    expect(nearestFrontPoint([occluded], 100, 100)).toBeNull()
  })
})

describe('地球直径与相机', () => {
  it('桌面、手机和中间宽度使用规范构图', () => {
    expect(globeDiameterForViewport(1440, 900)).toBe(760)
    expect(globeDiameterForViewport(390, 844)).toBeCloseTo(405)
    expect(globeDiameterForViewport(320, 800)).toBeCloseTo((320 * 405) / 390)
  })

  it('相机距离让球体连同边缘光的外径接近目标像素', () => {
    const height = 900
    const diameter = 760
    const distance = cameraDistanceForDiameter(height, diameter)
    const angularRadius = Math.asin(ATMOSPHERE_SCALE / distance)
    const projected =
      (2 * Math.tan(angularRadius) * height) / (2 * Math.tan((GLOBE_FOV * Math.PI) / 360))
    expect(projected).toBeCloseTo(diameter, 0)
  })

  it('桌面球心偏左，手机球心略偏上', () => {
    const desktop = globeViewOffset(1440, 900)
    expect(desktop.horizontal).toBe(0.45)
    expect(desktop.x).toBeCloseTo(72)
    expect(desktop.y).toBeCloseTo(0)

    const mobile = globeViewOffset(390, 844)
    expect(mobile.vertical).toBe(0.45)
    expect(mobile.y).toBeCloseTo(42.2)
  })
})

describe('城市气泡避让', () => {
  it('优先放在点位右侧，并让连接线落在气泡边缘', () => {
    const placement = placeCityBubble({
      x: 800,
      y: 450,
      stageWidth: 1440,
      stageHeight: 900,
      bubbleWidth: 360,
      bubbleHeight: 300,
      mobile: false,
    })
    expect(placement).not.toBeNull()
    expect(placement?.side).toBe('right')
    expect(placement?.left).toBe(818)
    expect(placement?.top).toBe(366)
    expect(placement?.lineX).toBe(818)
    expect(placement?.lineY).toBe(450)
  })

  it('右侧不足时放到左侧', () => {
    const placement = placeCityBubble({
      x: 1300,
      y: 450,
      stageWidth: 1440,
      stageHeight: 900,
      bubbleWidth: 360,
      bubbleHeight: 300,
      mobile: false,
    })
    expect(placement?.side).toBe('left')
    expect(placement?.left).toBe(922)
    expect(placement?.lineX).toBe(1282)
  })

  it('横向都放不下时放到上方', () => {
    const placement = placeCityBubble({
      x: 200,
      y: 350,
      stageWidth: 400,
      stageHeight: 500,
      bubbleWidth: 360,
      bubbleHeight: 200,
      mobile: true,
    })
    expect(placement?.side).toBe('above')
    expect(placement?.top).toBe(136)
    expect(placement?.lineY).toBe(336)
  })

  it('空间不足时沿边缘平移，不缩小气泡或越界', () => {
    const placement = placeCityBubble({
      x: 160,
      y: 200,
      stageWidth: 320,
      stageHeight: 400,
      bubbleWidth: 280,
      bubbleHeight: 300,
      mobile: true,
    })
    expect(placement).not.toBeNull()
    expect(placement!.left).toBeGreaterThanOrEqual(16)
    expect(placement!.left + 280).toBeLessThanOrEqual(304)
    expect(placement!.top).toBeGreaterThanOrEqual(16)
    expect(placement!.top + 300).toBeLessThanOrEqual(384)
  })
})
