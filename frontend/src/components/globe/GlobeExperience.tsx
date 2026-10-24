import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
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
  inertiaTargetLongitude,
  isPointFrontFacing,
  latLonToVector3,
  nearestFrontPoint,
  normalizeLongitude,
  placeCityBubble,
  shortestLongitudeDelta,
  type GlobeView,
} from '../../lib/globeMath'
import { queryKeys } from '../../api/queryKeys'
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

/** 开场相机参数；2026-10-22 实机校准为更远的飞入与更大的转向。 */
const OPENING_INTRO_DISTANCE = 1.45
const OPENING_DURATION = 1.65
const POINT_REVEAL_DELAY = 0.65

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
    lastDx: number
    lastDy: number
  } | null>(null)
  const pointersRef = useRef(new Map<number, { x: number; y: number }>())
  const pinchRef = useRef<{ distance: number; zoom: number } | null>(null)

  const bubbleLayerRef = useRef<HTMLDivElement>(null)
  const bubbleSectionRef = useRef<HTMLElement>(null)
  const connectorRef = useRef<SVGLineElement>(null)
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
    introDistance: memory.visited || reducedMotion ? 1 : OPENING_INTRO_DISTANCE,
  })
  const [opening, setOpening] = useState(() => !memory.visited && !reducedMotion)
  const [bubbleCityId, setBubbleCityId] = useState<string | null>(null)
  const [bubbleMode, setBubbleMode] = useState<CityBubbleMode>('hover')
  const [bubbleClosing, setBubbleClosing] = useState(false)
  const [bubbleSize, setBubbleSize] = useState({ width: 0, height: 0 })
  const [stageSize, setStageSize] = useState({ width: 0, height: 0, viewportHeight: 0 })
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

  /** 任何用户输入都立即结束剩余开场；之后的交互只由控制器写视图。 */
  const takeOver = useCallback(() => {
    if (openingRef.current) {
      openingRef.current.kill()
      openingRef.current = null
    }
    setOpening(false)
    cameraTweenRef.current?.kill()
    cameraTweenRef.current = null
    memory.visited = true

    const nav = document.querySelector<HTMLElement>('[data-public-nav]')
    if (nav) {
      gsap.killTweensOf(nav)
      gsap.set(nav, { clearProps: 'transform,opacity,visibility' })
    }

    const view = viewRef.current
    if (Math.abs(view.introDistance - 1) > 0.001) {
      gsap.to(view, { introDistance: 1, duration: 0.22, ease: 'power2.out' })
    }
    rememberView()
  }, [rememberView])

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
          gsap.to(section, { opacity: 1, y: 0, duration: 0.2, ease: 'power2.out' })
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
        closeTweenRef.current?.kill()
        closeTweenRef.current = gsap.to(section, {
          opacity: 0,
          y: 6,
          duration: 0.18,
          ease: 'power2.in',
          onComplete: () => {
            closeTweenRef.current = null
            finalize()
          },
        })
        closeTimerRef.current = window.setTimeout(finalize, 260)
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
      const duration = clamp(0.5 + (Math.abs(delta) / 180) * 0.3, 0.5, 0.8)
      cameraTweenRef.current = gsap.to(proxy, {
        longitude: targetLongitude,
        latitude: targetLatitude,
        duration,
        ease: 'power2.inOut',
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
      const nav = document.querySelector<HTMLElement>('[data-public-nav]')

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
      if (nav) {
        timeline.fromTo(
          nav,
          { y: -12, autoAlpha: 0.55 },
          { y: 0, autoAlpha: 1, duration: 0.5, ease: 'power2.out' },
          0,
        )
      }
      timeline.fromTo(
        proxy,
        { introDistance: OPENING_INTRO_DISTANCE },
        { introDistance: 1, duration: OPENING_DURATION, ease: 'power2.inOut', onUpdate: syncView },
        0.08,
      )
      timeline.to(
        proxy,
        {
          longitude: INITIAL_VIEW.longitude,
          latitude: INITIAL_VIEW.latitude,
          duration: OPENING_DURATION,
          ease: 'power2.inOut',
          onUpdate: syncView,
        },
        0.08,
      )

      return () => {
        timeline.kill()
        openingRef.current = null
        if (nav) gsap.set(nav, { clearProps: 'transform,opacity,visibility' })
      }
    },
    { dependencies: [reducedMotion] },
  )

  // 点位错峰只作用于当前可见点；背面点保持不可见但可用 Tab 到达。
  useGSAP(
    () => {
      const points = pointLayerRef.current?.querySelectorAll<HTMLElement>(
        '[data-city-point][data-front="true"]',
      )
      if (!points?.length) return
      if (reducedMotion) {
        gsap.set(points, { clearProps: 'opacity' })
        return
      }
      gsap.fromTo(
        points,
        { opacity: 0 },
        {
          opacity: 1,
          duration: 0.55,
          stagger: 0.09,
          delay: POINT_REVEAL_DELAY,
          ease: 'power2.out',
          clearProps: 'opacity',
        },
      )
    },
    { dependencies: [cities.length, reducedMotion] },
  )

  useLayoutEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const update = () =>
      setStageSize({ width: stage.clientWidth, height: stage.clientHeight, viewportHeight: window.innerHeight })
    update()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    observer?.observe(stage)
    window.addEventListener('resize', update)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', update)
    }
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

    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      moved: false,
      lastDx: 0,
      lastDy: 0,
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
    drag.lastDx = dx
    drag.lastDy = dy

    const view = viewRef.current
    view.longitude = normalizeLongitude(view.longitude - dx * 0.2)
    view.latitude = clamp(view.latitude + dy * 0.2, MIN_LATITUDE, MAX_LATITUDE)
  }

  const handlePointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    pointersRef.current.delete(event.pointerId)
    if (pointersRef.current.size < 2) pinchRef.current = null

    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragRef.current = null

    if (!drag.moved) return

    if (Math.abs(drag.lastDx) > 1 || Math.abs(drag.lastDy) > 1) {
      const view = viewRef.current
      const proxy = { longitude: view.longitude, latitude: view.latitude }
      cameraTweenRef.current = gsap.to(proxy, {
        // 目标保持连续经度，跨 ±180° 时按实际方向插值，完成后再归一化。
        longitude: inertiaTargetLongitude(view.longitude, drag.lastDx),
        latitude: clamp(view.latitude + drag.lastDy * 0.2 * 3, MIN_LATITUDE, MAX_LATITUDE),
        duration: 0.28,
        ease: 'power2.out',
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
    // 短屏首页允许纵向滚动，气泡仍按可见视口预算保留内部滚动。
    Math.min(stageSize.height || fallbackHeight,
      (stageSize.viewportHeight || fallbackHeight) - (mobile ? 100 : 0)) - (mobile ? 112 : 120),
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
      data-cursor-label="拖动"
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

      <div className={styles.canvas}>
        <Canvas
          flat
          dpr={[1, 1.75]}
          gl={{ alpha: true, antialias: true, powerPreference: 'high-performance' }}
          camera={{ fov: GLOBE_FOV, near: 0.1, far: 100, position: [0, 0, 4] }}
          onCreated={({ gl }) => gl.setClearColor(0x000000, 0)}
        >
          <SceneSync
            cities={cities}
            viewRef={viewRef}
            pointRefs={pointRefs}
            screenPositionsRef={screenPositionsRef}
            bubbleCityId={bubbleCityId}
            bubbleLayerRef={bubbleLayerRef}
            bubbleSizeRef={bubbleSizeRef}
            connectorRef={connectorRef}
          />
          <Earth />
        </Canvas>
      </div>

      <div className={styles.vignette} aria-hidden="true" />

      {bubbleCity && (
        <svg className={styles.connector} aria-hidden="true">
          <line ref={connectorRef} className={styles.connectorLine} pathLength={1} />
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

      <div className={styles.hint}>
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
  bubbleLayerRef: React.MutableRefObject<HTMLDivElement | null>
  bubbleSizeRef: React.MutableRefObject<{ width: number; height: number }>
  connectorRef: React.MutableRefObject<SVGLineElement | null>
}

/** 唯一写相机的位置；GSAP/控制器只改 viewRef，逐帧不触发 React 状态更新。 */
function SceneSync({
  cities,
  viewRef,
  pointRefs,
  screenPositionsRef,
  bubbleCityId,
  bubbleLayerRef,
  bubbleSizeRef,
  connectorRef,
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
    if (!layer || !line) return
    const point = bubbleCityId ? screenPositionsRef.current.get(bubbleCityId) : null
    const bubble = bubbleSizeRef.current
    if (!point?.front || !bubbleCityId || bubble.width < 1 || bubble.height < 1) {
      layer.style.visibility = 'hidden'
      line.style.visibility = 'hidden'
      line.style.strokeDashoffset = '1'
      return
    }

    const placement = placeCityBubble({
      x: point.x,
      y: point.y,
      stageWidth: size.width,
      stageHeight: size.height,
      bubbleWidth: bubble.width,
      bubbleHeight: bubble.height,
      mobile: size.width < 768,
    })
    if (!placement) {
      layer.style.visibility = 'hidden'
      line.style.visibility = 'hidden'
      line.style.strokeDashoffset = '1'
      return
    }

    layer.style.transform = `translate3d(${placement.left}px, ${placement.top}px, 0)`
    layer.style.visibility = 'visible'
    line.style.visibility = 'visible'
    line.style.strokeDashoffset = '0'
    line.setAttribute('x1', String(point.x))
    line.setAttribute('y1', String(point.y))
    line.setAttribute('x2', String(placement.lineX))
    line.setAttribute('y2', String(placement.lineY))
  })

  return null
}
