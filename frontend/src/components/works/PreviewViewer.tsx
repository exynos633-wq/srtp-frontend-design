import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { classNames } from '../../lib/classNames'
import { canUseCoverSource, runCoverTransition, runDirectCoverEntrance } from '../../lib/coverFlip'
import { prefersReducedMotion } from '../../lib/prefersReducedMotion'
import { EASE, SEC } from '../../lib/motion'
import { takeCoverSource, type CoverSource } from '../../lib/worksNavigation'
import type { ModelFormat } from '../../types/work'
import type { ModelSource, ModelViewConfig, ViewerPhase } from '../../viewer/types'
import { shouldFallback } from '../../api/preview'
import type { PreviewConfig, RemotePreview } from '../../api/preview'
import { Button } from '../ui/Button'
import styles from './PreviewViewer.module.css'

const ModelViewport = lazy(() =>
  import('../viewer/ModelViewport').then((module) => ({ default: module.ModelViewport })),
)

type PreviewStatus =
  | 'idle'
  | 'checking'
  | 'loading'
  | 'interactive'
  | 'viewer-error'
  | 'unavailable'
  | 'check-error'
  | 'ended'

const UNAVAILABLE_COPY = {
  title: '作品当前不可预览',
  description: '作品可能已下架或未公开。新的预览申请已被拒绝；已开始的观看实例不受影响。',
}

const EMPTY_VIEW_CONFIG: ModelViewConfig = {}

/**
 * §7 观看器的节奏，由 motion.ts 的令牌组合：
 * - 封面→观看器交接 320ms crossfade（SEC.fast × 2）；
 * - 放大/恢复 420ms（SEC.scene × 0.7，与卡片揭示同一个 420ms 校准值）。
 * 外壳 260ms / 工具栏 200ms 在 ModelViewport 内随其实例挂载播放。
 */
const TIMING = {
  handoff: SEC.fast * 2,
  zoom: SEC.scene * 0.7,
} as const

/** 观看外壳只需要身份、名称、封面与可选模型来源；公开详情和管理授权预览都可直接传入。 */
export interface PreviewWork {
  id: string
  name: string
  coverUrl: string
  modelingNote?: string | null
  modelFormat?: ModelFormat | null
}

export interface PreviewViewerProps {
  work: PreviewWork
  /** 信息层开始展开；与是否完成动画无关，页面可用性不依赖它。 */
  onEntered?: () => void
  /** 开始/重试前用现有公开读取边界确认作品当前仍公开。 */
  ensureAvailable?: () => Promise<boolean>
  /** 首次进入观看时通知页面保留已开始的实例。 */
  onPreviewStarted?: () => void
  /** 宿主显式提供模型来源；未提供时在开始后按 DEV/宿主适配器解析。 */
  modelSource?: ModelSource | null
  /** 显式开始且可用性检查通过后调用，生产宿主可在此接入自身资源接口。 */
  resolveModelSource?: (workId: string) => Promise<ModelSource | null>
  resolvePreviewConfig?: (workId: string) => Promise<PreviewConfig>
  adminPreview?: boolean
  viewConfig?: ModelViewConfig
  dprCap?: number
}

export function PreviewViewer({
  work,
  onEntered,
  ensureAvailable,
  onPreviewStarted,
  modelSource,
  resolveModelSource,
  resolvePreviewConfig,
  adminPreview = false,
  viewConfig,
  dprCap,
}: PreviewViewerProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const slotRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<HTMLElement>(null)
  const coverRef = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)

  const [coverResult, setCoverResult] = useState<{
    url: string
    status: 'loaded' | 'error'
  } | null>(null)
  const coverState = !work.coverUrl ? 'error' : coverResult?.url === work.coverUrl
    ? coverResult.status
    : 'loading'
  const [status, setStatus] = useState<PreviewStatus>('idle')
  const [checkError, setCheckError] = useState('')
  const [zoomOpen, setZoomOpen] = useState(false)
  const [resolvedSource, setResolvedSource] = useState<ModelSource | null>(modelSource ?? null)
  const [remote, setRemote] = useState<RemotePreview | null>(null)
  const [previewConfig, setPreviewConfig] = useState<ModelViewConfig | null>(null)
  const [fallbackNotice, setFallbackNotice] = useState('')
  const fallbackAttemptedRef = useRef(false)

  const sourceRef = useRef<CoverSource | null>(null)
  const sourceResolvedRef = useRef(false)
  const enteredRef = useRef(false)
  const onEnteredRef = useRef(onEntered)
  const ensureAvailableRef = useRef(ensureAvailable)
  const onPreviewStartedRef = useRef(onPreviewStarted)
  const resolveModelSourceRef = useRef(resolveModelSource)
  const configResolverRef = useRef(resolvePreviewConfig)
  const startedRef = useRef(false)
  const statusRef = useRef<PreviewStatus>('idle')
  const attemptRef = useRef(0)

  const zoomFromRef = useRef<DOMRect | null>(null)
  const closingRef = useRef(false)
  const openTweenRef = useRef<gsap.core.Tween | null>(null)
  const closeTweenRef = useRef<gsap.core.Tween | null>(null)
  const handoffTweenRef = useRef<gsap.core.Tween | null>(null)

  const resolvedConfig = useMemo<ModelViewConfig>(() => viewConfig ?? EMPTY_VIEW_CONFIG, [viewConfig])

  useLayoutEffect(() => {
    onEnteredRef.current = onEntered
  }, [onEntered])

  useLayoutEffect(() => {
    ensureAvailableRef.current = ensureAvailable
    onPreviewStartedRef.current = onPreviewStarted
    resolveModelSourceRef.current = resolveModelSource
    configResolverRef.current = resolvePreviewConfig
  }, [ensureAvailable, onPreviewStarted, resolveModelSource, resolvePreviewConfig])

  useEffect(() => {
    window.queueMicrotask(() => setResolvedSource(modelSource ?? null))
  }, [modelSource])

  useLayoutEffect(() => {
    statusRef.current = status
  }, [status])

  const notifyEntered = useCallback(() => {
    if (enteredRef.current) return
    enteredRef.current = true
    onEnteredRef.current?.()
  }, [])

  const notifyStarted = useCallback(() => {
    if (startedRef.current) return
    startedRef.current = true
    onPreviewStartedRef.current?.()
  }, [])

  // 消费一次性来源。StrictMode 会重跑布局 effect，但来源只取一次。
  useLayoutEffect(() => {
    if (sourceResolvedRef.current) return
    sourceResolvedRef.current = true
    sourceRef.current = takeCoverSource(work.id, work.coverUrl)
  }, [work.id, work.coverUrl])

  useEffect(() => {
    const image = imageRef.current
    if (!image) return
    if (image.complete) {
      setCoverResult({ url: work.coverUrl, status: image.naturalWidth > 0 ? 'loaded' : 'error' })
    }
  }, [work.coverUrl])

  // 图片迟迟不返回时也要让右侧信息可读，不能让动画阻塞内容。
  useEffect(() => {
    const timer = window.setTimeout(notifyEntered, 1500)
    return () => window.clearTimeout(timer)
  }, [notifyEntered])

  useGSAP(
    () => {
      if (coverState === 'loading') return
      if (prefersReducedMotion()) {
        notifyEntered()
        return
      }

      let cleanup: (() => void) | null = null
      const frame = window.requestAnimationFrame(() => {
        const cover = coverRef.current
        if (!cover) {
          notifyEntered()
          return
        }
        const target = imageRef.current
        const source = sourceRef.current
        cleanup =
          coverState === 'loaded' &&
          target &&
          source &&
          canUseCoverSource(source, target.getBoundingClientRect())
            ? runCoverTransition({
                source,
                target,
                onEntered: notifyEntered,
                coverUrl: work.coverUrl,
              })
            : runDirectCoverEntrance(cover, notifyEntered)
      })

      const safety = window.setTimeout(notifyEntered, 1200)
      return () => {
        window.cancelAnimationFrame(frame)
        window.clearTimeout(safety)
        cleanup?.()
      }
    },
    { scope: rootRef, dependencies: [coverState, work.id] },
  )

  useEffect(
    () => () => {
      attemptRef.current += 1
      openTweenRef.current?.kill()
      closeTweenRef.current?.kill()
      handoffTweenRef.current?.kill()
    },
    [],
  )

  const beginPreview = () => {
    if (
      statusRef.current === 'checking' ||
      statusRef.current === 'loading' ||
      statusRef.current === 'interactive'
    ) {
      return
    }
    attemptRef.current += 1
    const attempt = attemptRef.current
    statusRef.current = 'checking'
    setCheckError('')
    setFallbackNotice('')
    fallbackAttemptedRef.current = false
    setRemote(null)
    setStatus('checking')

    const startViewer = async () => {
      if (attempt !== attemptRef.current) return
      let nextSource = modelSource ?? null
      const configResolver = configResolverRef.current
      if (configResolver && !modelSource) {
        try {
          const config = await configResolver(work.id)
          if (attempt !== attemptRef.current) return
          nextSource = config.source
          setPreviewConfig(config.view)
          setRemote(config.mode === 'remote' ? {
            workId: work.id, admin: adminPreview, version: config.version!, format: work.modelFormat ?? 'glb',
          } : null)
        } catch (failure) {
          if (attempt !== attemptRef.current) return
          setCheckError(failure instanceof Error ? failure.message : '无法读取预览配置。')
          setStatus('check-error')
          return
        }
      }
      const resolver = resolveModelSourceRef.current
      if (!configResolver && !nextSource && resolver) {
        try {
          nextSource = await resolver(work.id)
        } catch (failure) {
          if (attempt !== attemptRef.current) return
          setCheckError(failure instanceof Error ? failure.message : '无法解析该作品的模型来源。')
          setStatus('check-error')
          return
        }
      }
      if (attempt !== attemptRef.current) return
      setResolvedSource(nextSource)
      notifyStarted()
      setStatus('loading')
    }

    const check = ensureAvailableRef.current
    if (!check) {
      void startViewer()
      return
    }
    void check()
      .then((available) => {
        if (attempt !== attemptRef.current) return
        if (!available) {
          setStatus('unavailable')
          return
        }
        return startViewer()
      })
      .catch((failure: unknown) => {
        if (attempt !== attemptRef.current) return
        setCheckError(failure instanceof Error ? failure.message : '当前无法确认作品可用性。')
        setStatus('check-error')
      })
  }

  const handleRemoteFailure = useCallback((failure: unknown) => {
    if (fallbackAttemptedRef.current || statusRef.current === 'ended') return
    fallbackAttemptedRef.current = true
    if (!shouldFallback(failure)) {
      setCheckError(failure instanceof Error ? failure.message : '远程预览不可用。')
      setStatus('check-error')
      return
    }
    const attempt = ++attemptRef.current
    statusRef.current = 'checking'
    setStatus('checking') // 卸载远程实例后，再检查当前权限与资源。
    setRemote(null)
    setFallbackNotice('远程预览暂不可用，正在切换本机渲染；将下载模型文件。')
    void (async () => {
      try {
        if (ensureAvailableRef.current && !await ensureAvailableRef.current()) {
          if (attempt === attemptRef.current) setStatus('unavailable')
          return
        }
        const config = await configResolverRef.current?.(work.id)
        if (attempt !== attemptRef.current) return
        if (!config?.source) throw new Error('尚未配置可用的本机模型来源。')
        setResolvedSource(config.source)
        setPreviewConfig(config.view)
        setFallbackNotice('远程预览暂不可用，已切换本机渲染。')
        setStatus('loading')
      } catch (error) {
        if (attempt !== attemptRef.current) return
        setCheckError(error instanceof Error ? error.message : '切换本机渲染失败。')
        setStatus('check-error')
      }
    })()
  }, [work.id])

  const endPreview = () => {
    if (statusRef.current === 'ended' || statusRef.current === 'idle') return
    attemptRef.current += 1
    statusRef.current = 'ended'
    setStatus('ended')
    window.requestAnimationFrame(() => {
      const selector = zoomOpen ? '[data-action="close-zoom"]' : '[data-action="start"]'
      viewerRef.current?.querySelector<HTMLButtonElement>(selector)?.focus({ preventScroll: true })
    })
  }

  const handleViewerPhase = useCallback((phase: ViewerPhase) => {
    if (phase === 'idle') return
    if (phase === 'ready') setStatus('interactive')
    else if (phase === 'error') setStatus('viewer-error')
  }, [])

  const handleViewerReady = useCallback(() => {
    setStatus('interactive')
  }, [])

  const handleViewerError = useCallback(() => {
    setStatus('viewer-error')
  }, [])

  const focusAfterZoom = useCallback(() => {
    const selector =
      statusRef.current === 'interactive' ||
      statusRef.current === 'loading' ||
      statusRef.current === 'viewer-error'
        ? '[data-action="zoom"]'
        : '[data-action="start"]'
    viewerRef.current?.querySelector<HTMLButtonElement>(selector)?.focus({ preventScroll: true })
  }, [])

  const finishClose = useCallback(() => {
    closingRef.current = false
    const element = viewerRef.current
    if (element) gsap.set(element, { clearProps: 'position,left,top,width,height' })
    setZoomOpen(false)
    if (slotRef.current) slotRef.current.style.height = ''
    window.requestAnimationFrame(focusAfterZoom)
  }, [focusAfterZoom])

  const closeZoom = useCallback(() => {
    if (!zoomOpen || closingRef.current) return
    const element = viewerRef.current
    const from = zoomFromRef.current
    if (!element || !from) {
      finishClose()
      return
    }
    if (prefersReducedMotion()) {
      finishClose()
      return
    }

    closingRef.current = true
    openTweenRef.current?.kill()
    const current = element.getBoundingClientRect()
    closeTweenRef.current = gsap.fromTo(
      element,
      {
        position: 'fixed',
        left: current.left,
        top: current.top,
        width: current.width,
        height: current.height,
      },
      {
        left: from.left,
        top: from.top,
        width: from.width,
        height: from.height,
        duration: TIMING.zoom,
        ease: EASE.inOut,
        clearProps: 'position,left,top,width,height',
        onComplete: finishClose,
      },
    )
  }, [finishClose, zoomOpen])

  const openZoom = () => {
    if (statusRef.current !== 'interactive' || zoomOpen || closingRef.current) return
    const element = viewerRef.current
    const slot = slotRef.current
    if (!element || !slot) return
    zoomFromRef.current = element.getBoundingClientRect()
    slot.style.height = `${element.offsetHeight}px`
    setZoomOpen(true)
  }

  useGSAP(
    () => {
      if (!zoomOpen) return
      const element = viewerRef.current
      const from = zoomFromRef.current
      if (!element || !from || prefersReducedMotion()) return
      const to = element.getBoundingClientRect()
      const tween = gsap.fromTo(
        element,
        {
          position: 'fixed',
          left: from.left,
          top: from.top,
          width: from.width,
          height: from.height,
        },
        {
          left: to.left,
          top: to.top,
          width: to.width,
          height: to.height,
          duration: TIMING.zoom,
          ease: EASE.inOut,
          clearProps: 'position,left,top,width,height',
        },
      )
      openTweenRef.current = tween
      return () => {
        tween.kill()
        openTweenRef.current = null
      }
    },
    { scope: rootRef, dependencies: [zoomOpen] },
  )

  useEffect(() => {
    if (!zoomOpen) return
    const frame = window.requestAnimationFrame(() => {
      viewerRef.current
        ?.querySelector<HTMLButtonElement>('[data-action="close-zoom"]')
        ?.focus({ preventScroll: true })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [zoomOpen])

  useEffect(() => {
    if (!zoomOpen) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [zoomOpen])

  useEffect(() => {
    if (!zoomOpen) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeZoom()
        return
      }
      if (event.key !== 'Tab') return

      const root = viewerRef.current
      if (!root) return
      const focusable = Array.from(
        root.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.offsetParent !== null)
      if (focusable.length === 0) {
        event.preventDefault()
        root.focus()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (!first || !last) return
      const active = document.activeElement
      if (event.shiftKey) {
        if (active === first || !root.contains(active)) {
          event.preventDefault()
          last.focus()
        }
      } else if (active === last || !root.contains(active)) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [closeZoom, zoomOpen])

  // 旋转屏幕或改变窗口大小时直接回到常规查看，避免把旧尺寸的固定层留在页面上。
  useEffect(() => {
    if (!zoomOpen) return
    const handleResize = () => {
      if (closingRef.current) return
      openTweenRef.current?.kill()
      closeTweenRef.current?.kill()
      finishClose()
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [finishClose, zoomOpen])

  // 封面→观看器交接：只由真实首帧（status 进入 interactive）触发，不用定时器伪造 ready。
  useGSAP(
    () => {
      const image = imageRef.current
      if (!image) return
      handoffTweenRef.current?.kill()
      handoffTweenRef.current = null
      if (status !== 'interactive') {
        // 结束预览或重试时恢复封面，避免上一次交接的内联状态残留。
        gsap.set(image, { clearProps: 'opacity' })
        return
      }
      if (prefersReducedMotion()) {
        gsap.set(image, { opacity: 0 })
        return
      }
      handoffTweenRef.current = gsap.to(image, {
        opacity: 0,
        duration: TIMING.handoff,
        ease: EASE.out,
        overwrite: true,
      })
    },
    { scope: rootRef, dependencies: [status] },
  )

  const activeViewer = status === 'loading' || status === 'interactive' || status === 'viewer-error'
  const canEnd = activeViewer || status === 'checking' || status === 'unavailable' || status === 'check-error'
  const showPreStartPanel =
    status === 'idle' ||
    status === 'checking' ||
    status === 'unavailable' ||
    status === 'check-error' ||
    status === 'ended'

  let hintText = '开始预览后才下载并解析真实模型'
  if (status === 'checking') hintText = '正在确认作品当前公开状态'
  else if (status === 'loading') hintText = remote ? '正在连接远程渲染画面' : '正在加载真实模型'
  else if (status === 'interactive') hintText = remote ? '真实模型 · GPU 远程渲染' : '真实模型 · 本地客户端渲染'
  else if (status === 'viewer-error') hintText = '加载失败 · 未显示替代模型'
  else if (status === 'unavailable') hintText = '作品不可预览'
  else if (status === 'check-error') hintText = '可用性检查失败'
  else if (status === 'ended') hintText = '观看实例已释放'

  return (
    <div className={styles.viewerSlot} ref={rootRef}>
      <div className={styles.slotStretch} ref={slotRef}>
        {zoomOpen ? <div className={styles.backdrop} aria-hidden="true" /> : null}
        <section
          ref={viewerRef}
          className={classNames(styles.viewer, zoomOpen && styles.zoomed)}
          aria-label={zoomOpen ? `放大查看：${work.name}` : '模型观看区'}
          aria-modal={zoomOpen || undefined}
          role={zoomOpen ? 'dialog' : undefined}
          tabIndex={-1}
        >
          {zoomOpen ? (
            <div className={styles.zoomBar}>
              <p className={styles.zoomTitle}>放大查看 · {work.name}</p>
              <Button data-action="close-zoom" onClick={closeZoom}>
                恢复常规查看
              </Button>
            </div>
          ) : null}

          <div className={styles.cover} data-status={status} ref={coverRef}>
            {coverState !== 'error' ? (
              <img
                key={work.coverUrl}
                ref={imageRef}
                className={styles.coverImage}
                src={work.coverUrl}
                alt=""
                draggable={false}
                onLoad={() => setCoverResult({ url: work.coverUrl, status: 'loaded' })}
                onError={() => setCoverResult({ url: work.coverUrl, status: 'error' })}
              />
            ) : (
              <span className={styles.coverFallback}>
                <span className={styles.coverFallbackMark} aria-hidden="true" />
                封面暂不可用
              </span>
            )}

            {activeViewer ? (
              <Suspense
                fallback={
                  <div className={styles.viewerFallback} role="status">
                    正在加载查看器模块…
                  </div>
                }
              >
                <ModelViewport
                  key={remote ? 'remote' : 'client'}
                  source={resolvedSource}
                  remote={remote}
                  onRemoteFailure={handleRemoteFailure}
                  modelName={work.name}
                  modelingNote={work.modelingNote}
                  zoomed={zoomOpen}
                  modelFormat={work.modelFormat}
                  viewConfig={previewConfig ?? resolvedConfig}
                  dprCap={dprCap}
                  onPhase={handleViewerPhase}
                  onReady={handleViewerReady}
                  onError={handleViewerError}
                  onRetry={beginPreview}
                  onEnd={endPreview}
                  onZoom={status === 'interactive' ? (zoomOpen ? closeZoom : openZoom) : undefined}
                  showEnd
                />
              </Suspense>
            ) : null}

          </div>

            {showPreStartPanel ? (
              <div
                className={classNames(
                  styles.statusPanel,
                  (status === 'unavailable' || status === 'check-error') && styles.statusPanelError,
                )}
                role={status === 'unavailable' || status === 'check-error' ? 'alert' : 'status'}
              >
                {status === 'idle' ? (
                  <>
                    <p className={styles.statusTitle}>封面待预览</p>
                    <p className={styles.statusText}>
                      点击开始后才准备模型预览；远程渲染不可用时会自动切换本机渲染并下载模型。
                    </p>
                    <div className={styles.statusAction}>
                      <Button variant="primary" data-action="start" onClick={beginPreview}>
                        开始预览
                      </Button>
                    </div>
                  </>
                ) : null}

                {status === 'checking' ? (
                  <>
                    <p className={styles.statusTitle}>正在确认作品可用性</p>
                    <p className={styles.statusText}>{fallbackNotice || '确认当前权限后准备模型预览。'}</p>
                  </>
                ) : null}

                {status === 'ended' ? (
                  <>
                    <p className={styles.statusTitle}>预览已结束</p>
                    <p className={styles.statusText}>观看实例已释放，模型与渲染资源已清理。你可以重新开始一次预览。</p>
                    <div className={styles.statusAction}>
                      <Button variant="primary" data-action="start" onClick={beginPreview}>
                        开始预览
                      </Button>
                    </div>
                  </>
                ) : null}

                {status === 'unavailable' ? (
                  <>
                    <p className={styles.statusTitle}>{UNAVAILABLE_COPY.title}</p>
                    <p className={styles.statusText}>{UNAVAILABLE_COPY.description}</p>
                    <div className={styles.statusAction}>
                      <Button onClick={beginPreview}>重新检查</Button>
                    </div>
                  </>
                ) : null}

                {status === 'check-error' ? (
                  <>
                    <p className={styles.statusTitle}>无法确认作品可用性</p>
                    <p className={styles.statusText}>{checkError || '读取作品当前状态失败，未开始加载模型。'}</p>
                    <div className={styles.statusAction}>
                      <Button variant="primary" data-action="start" onClick={beginPreview}>
                        手动重试
                      </Button>
                    </div>
                  </>
                ) : null}
              </div>
            ) : null}

          <div className={styles.footer}>
            {fallbackNotice ? <p className={styles.fallbackNotice} role="status">{fallbackNotice}</p> : null}
            <p className={styles.hint}>{hintText}</p>
            <p className={styles.format}>
              {work.modelFormat === 'gaussian-ply' ? '3DGS 高斯 PLY' : work.modelFormat === 'mesh-ply' ? 'PLY 网格' : 'glTF 2.0 GLB'}
            </p>
            {canEnd && !activeViewer ? (
              <div className={styles.controls}>
                <Button onClick={endPreview}>结束预览</Button>
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  )
}
