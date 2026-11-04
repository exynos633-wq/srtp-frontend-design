import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useGSAP } from '@gsap/react'
import { useQueryClient } from '@tanstack/react-query'
import gsap from 'gsap'
import { Vector3 } from 'three'
import type { GlobeCity } from '../../types/city'
import {
  GLOBE_FOV,
  INITIAL_VIEW,
  MAX_LATITUDE,
  MAX_ZOOM,
  MIN_LATITUDE,
  MIN_ZOOM,
  OPENING_VIEW,
  cameraDistanceForDiameter,
  clamp,
  globeDiameterForViewport,
  globeViewOffset,
  isPointFrontFacing,
  latLonToVector3,
  nearestFrontPoint,
  normalizeLongitude,
  placeCityBubble,
  shortestLongitudeDelta,
  type CityBubblePlacement,
  type GlobeView,
} from '../../lib/globeMath'
import { queryKeys } from '../../api/queryKeys'
import { DUR, EASE, SEC } from '../../lib/motion'
import { CityBubble, type CityBubbleMode } from './CityBubble'
import { Earth } from './Earth'
import styles from './GlobeExperience.module.css'

interface EngineView extends GlobeView {
  /** 开场专用：相机距离缩放，结束/接管后回到 1，不混入用户缩放范围。 */
  introDistance: number
}

interface HomeMemory {
  visited: boolean
  view: GlobeView
}

interface ScreenPoint {
  x: number
  y: number
  front: boolean
}

/** 拖拽采样：只保留最近几个 pointermove 的 (t, x, y)，用于松手速度。 */
interface DragSample {
  t: number
  x: number
  y: number
}

/** 1 px 拖拽对应的经纬度（与 v1.0 手感一致）。 */
const DRAG_DEGREES_PER_PIXEL = 0.2
/** §5 松手惯性：保留最近 5 个采样，用最近 80ms 的位移估算速度。 */
const INERTIA_SAMPLES = 5
const INERTIA_WINDOW_MS = 80
/** 松手前 120ms 内没有移动视为慢拖停住，不产生惯性。 */
const INERTIA_STOP_MS = 120
/** 指数摩擦系数：总投射距离 = v · d / (1 - d)。 */
const INERTIA_DECAY = 0.998
/**
 * 投射上限：屏幕 450px ≈ 90°。公式本身按滚动像素推导，快速甩动会算出两圈以上，
 * 对可无限旋转的地球必须限幅（v2.0 §5 实机校准）。
 */
const INERTIA_MAX_PX = 450

/**
 * 由采样估算惯性（px/s → 经纬度增量 + 时长）。
 * 速度按最近 80ms 采样求；project = (v / 1000) · d / (1 - d) 得到投影像素，
 * 再按 1px = 0.2° 换算并限幅到 90°；时长随实际投射距离 200–600ms。
 */
function inertiaFromSamples(samples: DragSample[], now: number, lastMoveAt: number) {
  if (samples.length < 2 || now - lastMoveAt > INERTIA_STOP_MS) return null
  const last = samples[samples.length - 1]
  const first =
    samples.find((sample) => last.t - sample.t <= INERTIA_WINDOW_MS) ?? samples[samples.length - 2]
  const dt = last.t - first.t
  if (dt <= 0) return null
  const vx = ((last.x - first.x) / dt) * 1000
  const vy = ((last.y - first.y) / dt) * 1000
  const project = INERTIA_DECAY / (1 - INERTIA_DECAY)
  const projectedX = (vx / 1000) * project
  const projectedY = (vy / 1000) * project
  const projectedLength = Math.hypot(projectedX, projectedY)
  const limit = projectedLength > INERTIA_MAX_PX ? INERTIA_MAX_PX / projectedLength : 1
  const reach = projectedLength * limit
  return {
    longitude: -projectedX * limit * DRAG_DEGREES_PER_PIXEL,
    latitude: projectedY * limit * DRAG_DEGREES_PER_PIXEL,
    duration: clamp(200 + reach * 0.5, 200, 600) / 1000,
  }
}

/** 气泡从点位方向长出来（§5）：点位在气泡的哪一侧，原点就落在那一侧。 */
const BUBBLE_ORIGIN: Record<CityBubblePlacement['side'], string> = {
  right: 'left center',
  left: 'right center',
  above: 'center bottom',
  below: 'center top',
}

/** 动效设计 v2.0 §4 地球开场表（毫秒，相对本组件挂载；镜头时长用 SEC.cinema）。 */
const OPENING_MS = {
  decorationsAt: 260,
  decorations: 900,
  terrainAt: 260,
  terrain: 900,
  terrainStagger: 60,
  pointsAt: 800,
  point: 320,
  pointStagger: 70,
  hintAt: 1000,
  hint: 300,
} as const

const openingSeconds = (milliseconds: number) => milliseconds / 1000

/** 模块内存只保存浏览状态，不保存 Three 对象；离开页面后场景本身被卸载。 */
const memory: HomeMemory = {
  visited: false,
  view: { ...INITIAL_VIEW },
}

interface GlobeExperienceProps {
  cities: GlobeCity[]
  reducedMotion: boolean
}

export default function GlobeExperience({ cities, reducedMotion }: GlobeExperienceProps) {
  const stageRef = useRef<HTMLDivElement>(null)
  const pointLayerRef = useRef<HTMLDivElement>(null)
  const cartographyRef = useRef<HTMLDivElement>(null)
  const hintRef = useRef<HTMLDivElement>(null)
  const pointIntroRef = useRef<gsap.core.Tween | null>(null)
  const pointRefs = useRef(new Map<string, HTMLButtonElement>())
  const screenPositionsRef = useRef(new Map<string, ScreenPoint>())
  const openingRef = useRef<gsap.core.Timeline | null>(null)
  const cameraTweenRef = useRef<gsap.core.Tween | null>(null)
  const dragRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    lastX: number
    lastY: number
    moved: boolean
    lastMoveAt: number
    samples: DragSample[]
  } | null>(null)
  const pointersRef = useRef(new Map<number, { x: number; y: number }>())
  const pinchRef = useRef<{ distance: number; zoom: number } | null>(null)

  const bubbleLayerRef = useRef<HTMLDivElement>(null)
  const bubbleSectionRef = useRef<HTMLElement>(null)
  const connectorRef = useRef<SVGLineElement>(null)
  const beamRef = useRef<SVGLineElement>(null)
  const bubbleSizeRef = useRef({ width: 0, height: 0 })
  const hoverOpenRef = useRef<number | null>(null)
  const hoverCloseRef = useRef<number | null>(null)
  const hoverCityRef = useRef<string | null>(null)
  const closeTimerRef = useRef<number | null>(null)
  const closeTweenRef = useRef<gsap.core.Tween | null>(null)
  const closeTokenRef = useRef(0)
  const pendingFocusRef = useRef<string | null>(null)
  const suppressFocusRef = useRef<string | null>(null)
  const suppressTimerRef = useRef<number | null>(null)

  const startView = memory.visited ? memory.view : reducedMotion ? INITIAL_VIEW : OPENING_VIEW
  const viewRef = useRef<EngineView>({
    ...startView,
    introDistance: memory.visited || reducedMotion ? 1 : 1.1,
  })
  const [opening, setOpening] = useState(() => !memory.visited && !reducedMotion)
  const [bubbleCityId, setBubbleCityId] = useState<string | null>(null)
  const [bubbleMode, setBubbleMode] = useState<CityBubbleMode>('hover')
  const [bubbleClosing, setBubbleClosing] = useState(false)
  const [bubbleSize, setBubbleSize] = useState({ width: 0, height: 0 })
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 })
  const [pendingCityName, setPendingCityName] = useState<string | null>(null)
  const queryClient = useQueryClient()
  const bubbleCity = cities.find((city) => city.id === bubbleCityId) ?? null
  const selectedCityId = bubbleMode === 'pinned' ? bubbleCityId : null

  const rememberView = useCallback((target?: GlobeView) => {
    const view = viewRef.current
    memory.view = {
      longitude: normalizeLongitude(target?.longitude ?? view.longitude),
      latitude: clamp(target?.latitude ?? view.latitude, MIN_LATITUDE, MAX_LATITUDE),
      zoom: clamp(target?.zoom ?? view.zoom, MIN_ZOOM, MAX_ZOOM),
    }
  }, [])

  const finishOpening = useCallback(() => {
    const view = viewRef.current
    view.introDistance = 1
    view.longitude = INITIAL_VIEW.longitude
    view.latitude = INITIAL_VIEW.latitude
    view.zoom = INITIAL_VIEW.zoom
    openingRef.current = null
    memory.visited = true
    rememberView()
    setOpening(false)
  }, [rememberView])

  /** 开场被打断时，装饰与点位直接落到最终可见状态（§9）。 */
  const settleOpeningVisuals = useCallback(() => {
    const cartography = cartographyRef.current
    if (cartography) {
      gsap.killTweensOf(cartography)
      gsap.set(cartography, { opacity: 1, scale: 1 })
      const paths = cartography.querySelectorAll<SVGPathElement>('[data-globe-terrain] path')
      if (paths.length) {
        gsap.killTweensOf(paths)
        gsap.set(paths, { strokeDashoffset: 0 })
      }
    }
    const hint = hintRef.current
    if (hint) {
      gsap.killTweensOf(hint)
      gsap.set(hint, { opacity: 1 })
    }
    pointIntroRef.current?.kill()
    pointIntroRef.current = null
    const points = pointLayerRef.current?.querySelectorAll<HTMLElement>('[data-city-point]')
    if (points?.length) {
      gsap.killTweensOf(points)
      gsap.set(points, { clearProps: 'opacity' })
    }
  }, [])

  /** 任何用户输入都立即结束剩余开场；之后的交互只由控制器写视图。导航入场归 HomePage。 */
  const takeOver = useCallback(() => {
    if (openingRef.current) {
      openingRef.current.kill()
      openingRef.current = null
    }
    settleOpeningVisuals()
    setOpening(false)
    cameraTweenRef.current?.kill()
    cameraTweenRef.current = null
    memory.visited = true

    const view = viewRef.current
    if (Math.abs(view.introDistance - 1) > 0.001) {
      gsap.to(view, { introDistance: 1, duration: SEC.base, ease: EASE.out })
    }
    rememberView()
  }, [rememberView, settleOpeningVisuals])

  const clearHoverTimers = useCallback(() => {
    if (hoverOpenRef.current !== null) {
      window.clearTimeout(hoverOpenRef.current)
      hoverOpenRef.current = null
    }
    if (hoverCloseRef.current !== null) {
      window.clearTimeout(hoverCloseRef.current)
      hoverCloseRef.current = null
    }
    hoverCityRef.current = null
  }, [])

  const clearSuppressTimer = useCallback(() => {
    if (suppressTimerRef.current !== null) {
      window.clearTimeout(suppressTimerRef.current)
      suppressTimerRef.current = null
    }
  }, [])

  const suppressNextFocus = useCallback(
    (cityId: string) => {
      suppressFocusRef.current = cityId
      clearSuppressTimer()
      suppressTimerRef.current = window.setTimeout(() => {
        if (suppressFocusRef.current === cityId) suppressFocusRef.current = null
        suppressTimerRef.current = null
      }, 450)
    },
    [clearSuppressTimer],
  )

  const clearCloseArtifacts = useCallback(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
    closeTweenRef.current?.kill()
    closeTweenRef.current = null
  }, [])

  const dropBubble = useCallback(
    (focusStage = false) => {
      closeTokenRef.current += 1
      clearHoverTimers()
      clearCloseArtifacts()
      pendingFocusRef.current = null
      setPendingCityName(null)
      setBubbleCityId(null)
      setBubbleMode('hover')
      setBubbleClosing(false)
      if (focusStage) stageRef.current?.focus({ preventScroll: true })
    },
    [clearCloseArtifacts, clearHoverTimers],
  )

  const showBubble = useCallback(
    (city: GlobeCity, mode: CityBubbleMode) => {
      clearHoverTimers()
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current)
        closeTimerRef.current = null
      }
      closeTweenRef.current?.kill()
      closeTweenRef.current = null
      closeTokenRef.current += 1
      setBubbleClosing(false)
      setBubbleCityId(city.id)
      setBubbleMode(mode)
      setPendingCityName(null)
      if (bubbleCityId !== city.id) {
        setBubbleSize({ width: 0, height: 0 })
        bubbleSizeRef.current = { width: 0, height: 0 }
      }
      if (bubbleCityId === city.id) {
        const section = bubbleSectionRef.current
        if (section) {
          gsap.killTweensOf(section)
          gsap.to(section, { opacity: 1, scale: 1, y: 0, duration: SEC.base, ease: EASE.out })
        }
        const line = connectorRef.current
        if (line) {
          gsap.killTweensOf(line)
          gsap.to(line, { opacity: 0.58, strokeDashoffset: 0, duration: SEC.base, ease: EASE.out })
        }
      }
    },
    [bubbleCityId, clearHoverTimers],
  )

  const closeBubble = useCallback(
    (restoreFocus = false) => {
      if (!bubbleCityId || !bubbleCity) return
      clearHoverTimers()
      pendingFocusRef.current = null
      setPendingCityName(null)
      cameraTweenRef.current?.kill()
      cameraTweenRef.current = null
      // 关闭时立即收掉连线光点，不等气泡淡出结束。
      const beam = beamRef.current
      if (beam) {
        gsap.killTweensOf(beam)
        gsap.set(beam, { opacity: 0 })
      }

      const token = closeTokenRef.current + 1
      closeTokenRef.current = token
      const finalize = () => {
        if (token !== closeTokenRef.current) return
        if (closeTimerRef.current !== null) {
          window.clearTimeout(closeTimerRef.current)
          closeTimerRef.current = null
        }
        setBubbleCityId(null)
        setBubbleMode('hover')
        setBubbleClosing(false)
      }

      const section = bubbleSectionRef.current
      if (section && !reducedMotion && !bubbleClosing) {
        setBubbleClosing(true)
        // 从当前值接管：先杀掉打开/上一次关闭的补间，不排队。
        closeTweenRef.current?.kill()
        gsap.killTweensOf(section)
        closeTweenRef.current = gsap.to(section, {
          opacity: 0,
          scale: 0.98,
          y: 6,
          duration: SEC.fast,
          ease: EASE.out,
          onComplete: () => {
            closeTweenRef.current = null
            finalize()
          },
        })
        const line = connectorRef.current
        if (line) {
          gsap.killTweensOf(line)
          gsap.to(line, { opacity: 0, strokeDashoffset: 1, duration: SEC.fast, ease: EASE.out })
        }
        closeTimerRef.current = window.setTimeout(finalize, DUR.fast + 80)
      } else {
        finalize()
      }

      if (restoreFocus) {
        suppressNextFocus(bubbleCity.id)
        pointRefs.current.get(bubbleCity.id)?.focus({ preventScroll: true })
      }
    },
    [bubbleCity, bubbleCityId, bubbleClosing, clearHoverTimers, reducedMotion, suppressNextFocus],
  )

  const handleCityMissing = useCallback(() => {
    dropBubble(true)
    void queryClient.invalidateQueries({ queryKey: queryKeys.globe.cities() })
  }, [dropBubble, queryClient])

  const focusCity = useCallback(
    (city: GlobeCity, onDone?: () => void) => {
      takeOver()
      const view = viewRef.current
      const delta = shortestLongitudeDelta(view.longitude, city.center.longitude)
      const targetLatitude = clamp(city.center.latitude, MIN_LATITUDE, MAX_LATITUDE)
      const targetLongitude = view.longitude + delta
      const complete = () => {
        view.longitude = normalizeLongitude(targetLongitude)
        view.latitude = targetLatitude
        cameraTweenRef.current = null
        rememberView()
        onDone?.()
      }

      if (reducedMotion) {
        complete()
        return
      }

      const proxy = { longitude: view.longitude, latitude: view.latitude }
      // §5：聚焦城市 550–750ms，最短经度路径。
      const duration = clamp(0.55 + (Math.abs(delta) / 180) * 0.2, 0.55, 0.75)
      cameraTweenRef.current = gsap.to(proxy, {
        longitude: targetLongitude,
        latitude: targetLatitude,
        duration,
        ease: EASE.inOut,
        onUpdate: () => {
          view.longitude = proxy.longitude
          view.latitude = proxy.latitude
        },
        onComplete: complete,
      })
    },
    [reducedMotion, rememberView, takeOver],
  )

  const nearestFrontCity = useCallback(
    (clientX: number, clientY: number): GlobeCity | null => {
      const stage = stageRef.current
      if (!stage) return null
      const rect = stage.getBoundingClientRect()
      const x = clientX - rect.left
      const y = clientY - rect.top
      const candidates: Array<ScreenPoint & { city: GlobeCity }> = []
      for (const city of cities) {
        const point = screenPositionsRef.current.get(city.id)
        if (point) candidates.push({ city, ...point })
      }
      return nearestFrontPoint(candidates, x, y)?.city ?? null
    },
    [cities],
  )

  const pinBubble = useCallback(() => {
    clearHoverTimers()
    if (bubbleMode === 'hover') setBubbleMode('pinned')
  }, [bubbleMode, clearHoverTimers])

  const scheduleHoverOpen = useCallback(
    (city: GlobeCity) => {
      if (bubbleMode === 'pinned' || bubbleClosing) return
      if (bubbleCityId === city.id) {
        if (hoverCloseRef.current !== null) {
          window.clearTimeout(hoverCloseRef.current)
          hoverCloseRef.current = null
        }
        return
      }
      if (hoverCityRef.current === city.id && hoverOpenRef.current !== null) return
      if (hoverOpenRef.current !== null) {
        window.clearTimeout(hoverOpenRef.current)
        hoverOpenRef.current = null
      }
      hoverCityRef.current = city.id
      hoverOpenRef.current = window.setTimeout(() => {
        hoverOpenRef.current = null
        showBubble(city, 'hover')
      }, 120)
    },
    [bubbleCityId, bubbleClosing, bubbleMode, showBubble],
  )

  const scheduleHoverClose = useCallback(() => {
    if (bubbleMode !== 'hover' || bubbleClosing) return
    clearHoverTimers()
    hoverCloseRef.current = window.setTimeout(() => {
      hoverCloseRef.current = null
      if (bubbleSectionRef.current?.contains(document.activeElement)) return
      closeBubble(false)
    }, 200)
  }, [bubbleClosing, bubbleMode, clearHoverTimers, closeBubble])

  const handlePointFocus = useCallback(
    (city: GlobeCity) => {
      if (suppressFocusRef.current === city.id) {
        suppressFocusRef.current = null
        clearSuppressTimer()
        return
      }
      if (bubbleMode === 'pinned' && bubbleCityId === city.id) return

      const point = screenPositionsRef.current.get(city.id)
      if (!point || point.front) {
        showBubble(city, 'pinned')
        return
      }

      pendingFocusRef.current = city.id
      setPendingCityName(city.name)
      focusCity(city, () => {
        if (pendingFocusRef.current !== city.id) return
        if (document.activeElement !== pointRefs.current.get(city.id)) return
        pendingFocusRef.current = null
        setPendingCityName(null)
        showBubble(city, 'pinned')
      })
    },
    [
      bubbleCityId,
      bubbleMode,
      clearSuppressTimer,
      focusCity,
      showBubble,
    ],
  )

  const handlePointClick = useCallback(
    (city: GlobeCity, event: React.MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation()
      const nearest = nearestFrontCity(event.clientX, event.clientY) ?? city
      pendingFocusRef.current = null
      setPendingCityName(null)
      showBubble(nearest, 'pinned')
      focusCity(nearest)
      const point = pointRefs.current.get(nearest.id)
      if (point && document.activeElement !== point) {
        suppressNextFocus(nearest.id)
        point.focus({ preventScroll: true })
      }
    },
    [focusCity, nearestFrontCity, showBubble, suppressNextFocus],
  )

  const handlePointPointerEnter = useCallback(
    (city: GlobeCity, event: React.PointerEvent<HTMLButtonElement>) => {
      if (event.pointerType !== 'mouse') return
      const nearest = nearestFrontCity(event.clientX, event.clientY) ?? city
      scheduleHoverOpen(nearest)
    },
    [nearestFrontCity, scheduleHoverOpen],
  )

  const handlePointPointerMove = useCallback(
    (city: GlobeCity, event: React.PointerEvent<HTMLButtonElement>) => {
      if (event.pointerType !== 'mouse') return
      const nearest = nearestFrontCity(event.clientX, event.clientY) ?? city
      if (nearest.id !== hoverCityRef.current) scheduleHoverOpen(nearest)
    },
    [nearestFrontCity, scheduleHoverOpen],
  )

  const handleBubbleFocusLeave = useCallback(
    (next: Node | null) => {
      if (next instanceof HTMLElement) {
        if (next.closest('[data-city-bubble]') || next.closest('[data-city-point]')) return
      }
      closeBubble(false)
    },
    [closeBubble],
  )

  useGSAP(
    () => {
      const view = viewRef.current

      if (reducedMotion) {
        const target = memory.visited ? memory.view : INITIAL_VIEW
        view.longitude = target.longitude
        view.latitude = target.latitude
        view.zoom = target.zoom
        view.introDistance = 1
        memory.visited = true
        rememberView(target)
        setOpening(false)
        return
      }

      if (memory.visited) {
        view.longitude = memory.view.longitude
        view.latitude = memory.view.latitude
        view.zoom = memory.view.zoom
        view.introDistance = 1
        setOpening(false)
        return
      }

      // 懒加载导致本组件可能晚于文案挂载：镜头与装饰节奏从挂载起算（§4 时间表）。
      const mobile =
        window.matchMedia?.('(max-width: 767px)').matches === true
      const cartography = cartographyRef.current
      const hint = hintRef.current
      const terrainPaths = mobile
        ? null
        : cartography?.querySelectorAll<SVGPathElement>('[data-globe-terrain] path') ?? null

      const timeline = gsap.timeline({ onComplete: finishOpening })
      openingRef.current = timeline
      // 开场动画写代理对象，再同步到 view；useGSAP 清理时不会把用户视角一起回滚。
      const proxy = {
        longitude: view.longitude,
        latitude: view.latitude,
        introDistance: view.introDistance,
      }
      const syncView = () => {
        if (!openingRef.current) return
        view.longitude = proxy.longitude
        view.latitude = proxy.latitude
        view.introDistance = proxy.introDistance
      }
      // 镜头：introDistance 1.10→1 + 经度 OPENING_VIEW→INITIAL_VIEW，1200ms cinema。
      timeline.fromTo(
        proxy,
        { introDistance: 1.1 },
        { introDistance: 1, duration: SEC.cinema, ease: EASE.cinema, onUpdate: syncView },
        0,
      )
      timeline.to(
        proxy,
        {
          longitude: INITIAL_VIEW.longitude,
          latitude: INITIAL_VIEW.latitude,
          duration: SEC.cinema,
          ease: EASE.cinema,
          onUpdate: syncView,
        },
        0,
      )
      // 装饰层 260ms：opacity + scale 入场；地形线用 pathLength=1 做绘线，错峰 60ms。
      if (cartography) {
        timeline.fromTo(
          cartography,
          { opacity: 0, scale: mobile ? 1 : 0.98 },
          {
            opacity: 1,
            scale: 1,
            duration: mobile ? SEC.base : openingSeconds(OPENING_MS.decorations),
            ease: EASE.out,
          },
          openingSeconds(OPENING_MS.decorationsAt),
        )
      }
      if (terrainPaths?.length) {
        timeline.fromTo(
          terrainPaths,
          { strokeDasharray: 1, strokeDashoffset: 1 },
          {
            strokeDashoffset: 0,
            duration: openingSeconds(OPENING_MS.terrain),
            stagger: openingSeconds(OPENING_MS.terrainStagger),
            ease: EASE.out,
          },
          openingSeconds(OPENING_MS.terrainAt),
        )
      }
      // 操作提示 1000ms。
      if (hint) {
        timeline.fromTo(
          hint,
          { opacity: 0 },
          { opacity: 1, duration: openingSeconds(OPENING_MS.hint), ease: EASE.out },
          openingSeconds(OPENING_MS.hintAt),
        )
      }
      // 城市点位 800ms：只淡入当前正面点，背面点仍由 data-front 的 CSS 隐藏、可 Tab 到达。
      timeline.call(
        () => {
          const points = pointLayerRef.current?.querySelectorAll<HTMLElement>(
            '[data-city-point][data-front="true"]',
          )
          if (!points?.length) return
          gsap.killTweensOf(points)
          pointIntroRef.current = gsap.fromTo(
            points,
            { opacity: 0 },
            {
              opacity: 1,
              duration: openingSeconds(OPENING_MS.point),
              stagger: openingSeconds(OPENING_MS.pointStagger),
              ease: EASE.out,
              clearProps: 'opacity',
              onComplete: () => {
                pointIntroRef.current = null
              },
            },
          )
        },
        undefined,
        openingSeconds(OPENING_MS.pointsAt),
      )

      return () => {
        timeline.kill()
        openingRef.current = null
        // 打断/切到减少动态时直接落到最终可见状态（§9）。
        settleOpeningVisuals()
      }
    },
    { dependencies: [reducedMotion, settleOpeningVisuals] },
  )

  useLayoutEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const update = () =>
      setStageSize({ width: stage.clientWidth, height: stage.clientHeight })
    update()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(update)
    observer.observe(stage)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const startedAt = performance.now()
    return () => {
      const view = viewRef.current
      rememberView()
      if (performance.now() - startedAt > 120) memory.visited = true
      openingRef.current?.kill()
      openingRef.current = null
      cameraTweenRef.current?.kill()
      cameraTweenRef.current = null
      clearHoverTimers()
      clearCloseArtifacts()
      clearSuppressTimer()
      gsap.killTweensOf(view)
    }
  }, [clearCloseArtifacts, clearHoverTimers, clearSuppressTimer, rememberView])

  useEffect(() => {
    if (!bubbleCityId || bubbleCity) return
    const timer = window.setTimeout(() => dropBubble(true), 0)
    return () => window.clearTimeout(timer)
  }, [bubbleCity, bubbleCityId, dropBubble])

  // 连接线 240ms 画出（§5 取最近令牌 SEC.base）：pathLength=1 归一化，
  // 不读 getTotalLength，也不在逐帧里反复重置 dash 状态。
  useEffect(() => {
    if (!bubbleCityId) return
    const line = connectorRef.current
    if (!line) return
    gsap.killTweensOf(line)
    if (reducedMotion) {
      gsap.set(line, { opacity: 0.58, strokeDashoffset: 0 })
      return
    }
    gsap.fromTo(
      line,
      { opacity: 0, strokeDashoffset: 1 },
      { opacity: 0.58, strokeDashoffset: 0, duration: SEC.base, ease: EASE.out },
    )
  }, [bubbleCity, bubbleCityId, reducedMotion])

  // §4.1 连线光点：选中城市时一束 2px 光点 1.2s（SEC.cinema = --dur-beam）从点位跑到气泡，
  // 跑完即隐去、只留 1px 连接线。端点由 SceneSync 每帧写，补间只改 dashoffset/opacity，
  // 不读 getTotalLength（pathLength=1 已归一化）。关闭或切城时 kill 并立即隐藏。
  useEffect(() => {
    if (!selectedCityId || reducedMotion) return
    const beam = beamRef.current
    if (!beam) return
    gsap.killTweensOf(beam)
    gsap.set(beam, { opacity: 1, strokeDashoffset: 1 })
    const tween = gsap.to(beam, {
      strokeDashoffset: 0,
      duration: SEC.cinema,
      ease: EASE.out,
      onComplete: () => gsap.set(beam, { opacity: 0 }),
    })
    return () => {
      tween.kill()
      gsap.set(beam, { opacity: 0 })
    }
  }, [reducedMotion, selectedCityId])

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return

    const handleWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) return
      if ((event.target as HTMLElement).closest('[data-city-bubble]')) return
      if (document.activeElement !== stage) return
      const rect = stage.getBoundingClientRect()
      const diameter = globeDiameterForViewport(rect.width, rect.height)
      const offset = globeViewOffset(rect.width, rect.height)
      const centerX = rect.left + offset.horizontal * rect.width
      const centerY = rect.top + offset.vertical * rect.height
      // 只有指针落在地球上时滚轮才缩放；页面其余区域不抢滚轮。
      if (Math.hypot(event.clientX - centerX, event.clientY - centerY) > diameter / 2) return
      event.preventDefault()
      if (event.deltaY === 0) return
      takeOver()
      const view = viewRef.current
      view.zoom = clamp(view.zoom * (event.deltaY > 0 ? 0.92 : 1.08), MIN_ZOOM, MAX_ZOOM)
      rememberView()
    }

    stage.addEventListener('wheel', handleWheel, { passive: false })
    return () => stage.removeEventListener('wheel', handleWheel)
  }, [rememberView, takeOver])

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    const target = event.target as HTMLElement
    if (target.closest('[data-city-bubble]')) return
    if (target.closest('[data-city-point]')) return

    event.preventDefault()
    const stage = event.currentTarget
    stage.focus({ preventScroll: true })
    if (bubbleCityId) closeBubble(false)
    takeOver()
    stage.setPointerCapture?.(event.pointerId)
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })

    if (pointersRef.current.size >= 2) {
      const [first, second] = [...pointersRef.current.values()]
      pinchRef.current = {
        distance: Math.hypot(second.x - first.x, second.y - first.y),
        zoom: viewRef.current.zoom,
      }
      dragRef.current = null
      return
    }

    const now = event.timeStamp || performance.now()
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      moved: false,
      lastMoveAt: now,
      samples: [{ t: now, x: event.clientX, y: event.clientY }],
    }
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!pointersRef.current.has(event.pointerId)) return
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })

    if (pointersRef.current.size >= 2 && pinchRef.current) {
      const [first, second] = [...pointersRef.current.values()]
      const distance = Math.hypot(second.x - first.x, second.y - first.y)
      if (pinchRef.current.distance > 0) {
        viewRef.current.zoom = clamp(
          pinchRef.current.zoom * (distance / pinchRef.current.distance),
          MIN_ZOOM,
          MAX_ZOOM,
        )
      }
      return
    }

    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    if (!drag.moved) {
      const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY)
      if (distance < 5) return
      drag.moved = true
      if (bubbleCityId) closeBubble(false)
    }

    const dx = event.clientX - drag.lastX
    const dy = event.clientY - drag.lastY
    drag.lastX = event.clientX
    drag.lastY = event.clientY
    drag.lastMoveAt = event.timeStamp || performance.now()
    drag.samples.push({ t: drag.lastMoveAt, x: event.clientX, y: event.clientY })
    if (drag.samples.length > INERTIA_SAMPLES) drag.samples.shift()

    const view = viewRef.current
    view.longitude = normalizeLongitude(view.longitude - dx * DRAG_DEGREES_PER_PIXEL)
    view.latitude = clamp(
      view.latitude + dy * DRAG_DEGREES_PER_PIXEL,
      MIN_LATITUDE,
      MAX_LATITUDE,
    )
  }

  const handlePointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    pointersRef.current.delete(event.pointerId)
    if (pointersRef.current.size < 2) pinchRef.current = null

    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragRef.current = null

    if (!drag.moved) return

    const now = event.timeStamp || performance.now()
    const inertia = reducedMotion ? null : inertiaFromSamples(drag.samples, now, drag.lastMoveAt)
    const view = viewRef.current
    if (inertia && (Math.abs(inertia.longitude) > 0.05 || Math.abs(inertia.latitude) > 0.05)) {
      const proxy = { longitude: view.longitude, latitude: view.latitude }
      cameraTweenRef.current?.kill()
      cameraTweenRef.current = gsap.to(proxy, {
        // 目标保持连续经度，跨 ±180° 时按实际方向插值，完成后再归一化。
        longitude: view.longitude + inertia.longitude,
        latitude: clamp(view.latitude + inertia.latitude, MIN_LATITUDE, MAX_LATITUDE),
        duration: inertia.duration,
        // §5：惯性收尾用 power3.out（EASE.enter 与 tokens 同为 power3.out）。
        ease: EASE.enter,
        onUpdate: () => {
          view.longitude = proxy.longitude
          view.latitude = proxy.latitude
        },
        onComplete: () => {
          view.longitude = normalizeLongitude(proxy.longitude)
          cameraTweenRef.current = null
          rememberView()
        },
      })
    }
    rememberView()
  }

  const handlePointerCancel = (event: React.PointerEvent<HTMLDivElement>) => {
    pointersRef.current.delete(event.pointerId)
    if (pointersRef.current.size < 2) pinchRef.current = null
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return
    const view = viewRef.current
    const step = event.shiftKey ? 10 : 5
    let handled = true

    switch (event.key) {
      case 'ArrowLeft':
        view.longitude = normalizeLongitude(view.longitude + step)
        break
      case 'ArrowRight':
        view.longitude = normalizeLongitude(view.longitude - step)
        break
      case 'ArrowUp':
        view.latitude = clamp(view.latitude + step, MIN_LATITUDE, MAX_LATITUDE)
        break
      case 'ArrowDown':
        view.latitude = clamp(view.latitude - step, MIN_LATITUDE, MAX_LATITUDE)
        break
      case '+':
      case '=':
        view.zoom = clamp(view.zoom * 1.1, MIN_ZOOM, MAX_ZOOM)
        break
      case '-':
      case '_':
        view.zoom = clamp(view.zoom * 0.9, MIN_ZOOM, MAX_ZOOM)
        break
      case 'Escape':
        if (bubbleCityId) closeBubble(true)
        break
      default:
        handled = false
    }

    if (!handled) return
    event.preventDefault()
    if (event.key.startsWith('Arrow')) {
      if (bubbleCityId) closeBubble(false)
      takeOver()
      viewRef.current = view
      rememberView()
    } else if (event.key === '+' || event.key === '=' || event.key === '-' || event.key === '_') {
      takeOver()
      viewRef.current = view
      rememberView()
    }
  }

  const instructionsId = 'globe-instructions'
  const mobile = stageSize.width > 0 && stageSize.width < 768
  const fallbackHeight =
    typeof window === 'undefined' ? 800 : Math.max(480, window.innerHeight)
  const bubbleMaxHeight = Math.max(
    180,
    (stageSize.height || fallbackHeight) - (mobile ? 112 : 120),
  )
  const viewportArea =
    typeof window === 'undefined' ? 0 : window.innerWidth * window.innerHeight
  const navGlassArea = mobile ? 0 : stageSize.width * 72
  const bubbleSolid =
    bubbleSize.width > 0 &&
    viewportArea > 0 &&
    (navGlassArea + bubbleSize.width * bubbleSize.height) / viewportArea > 0.22
  const selectedText = bubbleCity
    ? `${bubbleCity.name}，${bubbleCity.workCount} 件已发布作品。`
    : pendingCityName
      ? `正在转向${pendingCityName}。`
      : ''

  const handleMeasure = useCallback((size: { width: number; height: number }) => {
    bubbleSizeRef.current = size
    setBubbleSize((current) =>
      current.width === size.width && current.height === size.height ? current : size,
    )
  }, [])

  return (
    <div
      ref={stageRef}
      className={styles.stage}
      data-globe-stage="true"
      data-opening={opening ? 'true' : 'false'}
      data-reduced-motion={reducedMotion ? 'true' : 'false'}
      data-selected-city={selectedCityId ?? ''}
      data-bubble-city={bubbleCityId ?? ''}
      data-bubble-mode={bubbleMode}
      tabIndex={0}
      role="group"
      aria-label="三维地球探索"
      aria-describedby={instructionsId}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerCancel}
      onKeyDown={handleKeyDown}
    >
      <p id={instructionsId} className={styles.srOnly}>
        拖动旋转地球，滚轮或加减号缩放，方向键微调角度。按 Tab 可浏览城市点位，按 Enter
        打开城市作品，按 Escape 关闭。
      </p>

      <div ref={cartographyRef} className={styles.cartography} aria-hidden="true">
        <svg className={styles.orbits} viewBox="0 0 1000 1000" fill="none">
          <circle cx="500" cy="500" r="460" className={styles.orbitTrack} />
          <circle cx="500" cy="500" r="480" className={styles.orbitSegments} />
          <ellipse cx="500" cy="500" rx="496" ry="300" transform="rotate(-28 500 500)" className={styles.orbitTrack} />
          <g className={styles.orbitTicks}>
            {Array.from({ length: 72 }, (_, index) => (
              <path key={index} d={`M500 40v${index % 6 === 0 ? 14 : 5}`} transform={`rotate(${index * 5} 500 500)`} />
            ))}
          </g>
          <g className={styles.orbitMarkers}>
            <path d="M492 20h16M500 12v16M492 980h16M500 972v16" />
            <circle cx="40" cy="500" r="3" />
            <circle cx="960" cy="500" r="3" />
          </g>
        </svg>
        <svg
          className={styles.terrain}
          data-globe-terrain="true"
          viewBox="0 0 520 200"
          fill="none"
        >
          <g>
            {[0, 1, 2, 3, 4, 5, 6].map((index) => (
              <path
                key={index}
                pathLength={1}
                transform={`translate(${index * -8} ${index * 12})`}
                d="M-40 70C24 114 64 0 144 28S236 126 314 74 424 18 560 62M-40 82C28 132 64 20 144 45S242 146 320 92 432 38 560 80"
              />
            ))}
          </g>
        </svg>
        <div className={styles.mapCaption}>
          <span>地理视野</span>
          <span>EARTH / SPATIAL ARCHIVE</span>
        </div>
      </div>

      <div className={styles.canvas}>
        <Canvas
          dpr={[1, 1.75]}
          gl={{ alpha: true, antialias: true, powerPreference: 'high-performance' }}
          camera={{ fov: GLOBE_FOV, near: 0.1, far: 100, position: [0, 0, 4] }}
          onCreated={({ gl }) => { gl.setClearColor(0x000000, 0); gl.toneMappingExposure = 1.2 }}
        >
          <SceneSync
            cities={cities}
            viewRef={viewRef}
            pointRefs={pointRefs}
            screenPositionsRef={screenPositionsRef}
            bubbleCityId={bubbleCityId}
            bubbleLayerRef={bubbleLayerRef}
            bubbleSectionRef={bubbleSectionRef}
            bubbleSizeRef={bubbleSizeRef}
            connectorRef={connectorRef}
            beamRef={beamRef}
          />
          <Earth reducedMotion={reducedMotion} />
        </Canvas>
      </div>

      <div className={styles.vignette} aria-hidden="true" />

      {bubbleCity && (
        <svg className={styles.connector} aria-hidden="true">
          <line ref={connectorRef} data-connector-line className={styles.connectorLine} pathLength={1} />
          <line
            ref={beamRef}
            className={styles.connectorBeam}
            pathLength={1}
            data-connector-beam="true"
          />
        </svg>
      )}

      <div className={styles.points} ref={pointLayerRef} role="group" aria-label="城市点位">
        {cities.map((city) => (
          <Fragment key={city.id}>
            <button
              type="button"
              className={styles.point}
              data-city-point="true"
              data-city-id={city.id}
              data-work-count={city.workCount}
              data-front="false"
              data-open={bubbleCityId === city.id ? 'true' : 'false'}
              aria-label={`${city.name}，${city.workCount} 件已发布作品`}
              aria-pressed={selectedCityId === city.id}
              aria-expanded={bubbleCityId === city.id}
              tabIndex={0}
              ref={(element) => {
                if (element) pointRefs.current.set(city.id, element)
                else pointRefs.current.delete(city.id)
              }}
              onPointerDown={(event) => event.stopPropagation()}
              onPointerEnter={(event) => handlePointPointerEnter(city, event)}
              onPointerMove={(event) => handlePointPointerMove(city, event)}
              onPointerLeave={(event) => {
                if (event.pointerType === 'mouse') scheduleHoverClose()
              }}
              onFocus={() => handlePointFocus(city)}
              onBlur={() => {
                if (pendingFocusRef.current === city.id) {
                  pendingFocusRef.current = null
                  setPendingCityName(null)
                }
              }}
              onClick={(event) => handlePointClick(city, event)}
              onKeyDown={(event) => {
                if (event.key === 'Escape' && bubbleCityId) {
                  event.preventDefault()
                  event.stopPropagation()
                  closeBubble(true)
                }
              }}
            >
              <span className={styles.dot} aria-hidden="true" />
            </button>

            {bubbleCity?.id === city.id && (
              <div ref={bubbleLayerRef} className={styles.bubbleLayer}>
                <CityBubble
                  key={city.id}
                  city={city}
                  mode={bubbleMode}
                  reducedMotion={reducedMotion}
                  maxHeight={bubbleMaxHeight}
                  solid={bubbleSolid}
                  closing={bubbleClosing}
                  sectionRef={bubbleSectionRef}
                  onMeasure={handleMeasure}
                  onClose={() => closeBubble(true)}
                  onPin={pinBubble}
                  onMissing={handleCityMissing}
                  onPointerEnter={clearHoverTimers}
                  onPointerLeave={scheduleHoverClose}
                  onFocusLeave={handleBubbleFocusLeave}
                />
              </div>
            )}
          </Fragment>
        ))}
      </div>

      <div ref={hintRef} className={styles.hint}>
        {pendingCityName ? (
          <span className={styles.hintCity}>正在转向{pendingCityName}…</span>
        ) : bubbleCity ? (
          <>
            <span className={styles.hintCity}>{bubbleCity.name}</span>
            <span>{bubbleCity.workCount} 件已发布作品</span>
          </>
        ) : (
          <>
            <span className={styles.hintDesktop}>拖动旋转 · 滚轮缩放 · 方向键微调</span>
            <span className={styles.hintMobile}>单指旋转 · 双指缩放</span>
          </>
        )}
      </div>

      <p className={styles.srOnly} role="status" aria-live="polite">
        {selectedText}
      </p>
    </div>
  )
}

interface SceneSyncProps {
  cities: GlobeCity[]
  viewRef: React.MutableRefObject<EngineView>
  pointRefs: React.MutableRefObject<Map<string, HTMLButtonElement>>
  screenPositionsRef: React.MutableRefObject<Map<string, ScreenPoint>>
  bubbleCityId: string | null
  bubbleLayerRef: RefObject<HTMLDivElement | null>
  bubbleSectionRef: RefObject<HTMLElement | null>
  bubbleSizeRef: RefObject<{ width: number; height: number }>
  connectorRef: RefObject<SVGLineElement | null>
  beamRef: RefObject<SVGLineElement | null>
}

/** 唯一写相机的位置；GSAP/控制器只改 viewRef，逐帧不触发 React 状态更新。 */
function SceneSync({
  cities,
  viewRef,
  pointRefs,
  screenPositionsRef,
  bubbleCityId,
  bubbleLayerRef,
  bubbleSectionRef,
  bubbleSizeRef,
  connectorRef,
  beamRef,
}: SceneSyncProps) {
  const camera = useThree((state) => state.camera)
  const size = useThree((state) => state.size)
  const positions = useMemo(
    () => cities.map((city) => latLonToVector3(city.center.latitude, city.center.longitude)),
    [cities],
  )
  const temp = useMemo(() => ({ point: new Vector3() }), [])

  useLayoutEffect(() => {
    if (size.width === 0 || size.height === 0) return
    const offset = globeViewOffset(size.width, size.height)
    camera.setViewOffset(size.width, size.height, offset.x, offset.y, size.width, size.height)
    camera.updateProjectionMatrix()
    return () => camera.clearViewOffset()
  }, [camera, size.width, size.height])

  useFrame(() => {
    if (size.width === 0 || size.height === 0) return
    const view = viewRef.current
    const diameter = globeDiameterForViewport(size.width, size.height)
    const distance = cameraDistanceForDiameter(size.height, diameter)
    const radius = (distance / view.zoom) * view.introDistance

    camera.position.copy(latLonToVector3(view.latitude, view.longitude, radius))
    camera.up.set(0, 1, 0)
    camera.lookAt(0, 0, 0)
    camera.updateMatrixWorld()

    screenPositionsRef.current.clear()

    for (let index = 0; index < cities.length; index += 1) {
      const city = cities[index]
      const element = pointRefs.current.get(city.id)
      if (!element) continue

      const point = temp.point.copy(positions[index])
      const front = isPointFrontFacing(positions[index], camera.position)
      point.project(camera)
      const x = (point.x * 0.5 + 0.5) * size.width
      const y = (-point.y * 0.5 + 0.5) * size.height
      const visible =
        front &&
        point.z > -1 &&
        point.z < 1 &&
        x > -24 &&
        x < size.width + 24 &&
        y > -24 &&
        y < size.height + 24

      screenPositionsRef.current.set(city.id, { x, y, front: visible })
      element.style.transform = `translate3d(${x}px, ${y}px, 0)`
      element.dataset.front = visible ? 'true' : 'false'
      element.style.pointerEvents = visible ? 'auto' : 'none'
      element.tabIndex = 0
      element.removeAttribute('aria-hidden')
    }

    const layer = bubbleLayerRef.current
    const line = connectorRef.current
    const beam = beamRef.current
    if (!layer || !line) return
    const point = bubbleCityId ? screenPositionsRef.current.get(bubbleCityId) : null
    const bubble = bubbleSizeRef.current
    if (!point?.front || !bubbleCityId || bubble.width < 1 || bubble.height < 1) {
      layer.style.visibility = 'hidden'
      line.style.visibility = 'hidden'
      if (beam) beam.style.visibility = 'hidden'
      return
    }

    // Reserve the editorial headline column when positioning the city card.
    const safeLeft = size.width >= 768 ? size.width * 0.38 : 0
    const placement = placeCityBubble({
      x: point.x - safeLeft,
      y: point.y,
      stageWidth: size.width - safeLeft,
      stageHeight: size.height,
      bubbleWidth: bubble.width,
      bubbleHeight: bubble.height,
      mobile: size.width < 768,
    })
    if (!placement) {
      layer.style.visibility = 'hidden'
      line.style.visibility = 'hidden'
      if (beam) beam.style.visibility = 'hidden'
      return
    }

    layer.style.transform = `translate3d(${placement.left + safeLeft}px, ${placement.top}px, 0)`
    layer.style.visibility = 'visible'
    // 气泡的开合动画写在 section 上，layer 只负责定位；原点按点位在气泡哪一侧决定。
    const section = bubbleSectionRef.current
    if (section) {
      const origin = BUBBLE_ORIGIN[placement.side]
      if (section.style.transformOrigin !== origin) section.style.transformOrigin = origin
    }
    line.style.visibility = 'visible'
    line.setAttribute('x1', String(point.x))
    line.setAttribute('y1', String(point.y))
    line.setAttribute('x2', String(placement.lineX + safeLeft))
    line.setAttribute('y2', String(placement.lineY))
    // 光点与主连接线共用同一组端点，避免两套 placement 计算。
    if (beam) {
      beam.style.visibility = 'visible'
      beam.setAttribute('x1', String(point.x))
      beam.setAttribute('y1', String(point.y))
      beam.setAttribute('x2', String(placement.lineX + safeLeft))
      beam.setAttribute('y2', String(placement.lineY))
    }
  })

  return null
}
