import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { classNames } from '../../lib/classNames'
import { canUseCoverSource, runCoverTransition, runDirectCoverEntrance } from '../../lib/coverFlip'
import { prefersReducedMotion } from '../../lib/prefersReducedMotion'
import { takeCoverSource, type CoverSource } from '../../lib/worksNavigation'
import { Button } from '../ui/Button'
import styles from './PreviewViewer.module.css'

type PreviewStatus =
  | 'idle'
  | 'preparing'
  | 'interactive'
  | 'busy'
  | 'offline'
  | 'disconnected'
  | 'failed'
  | 'ended'

type SimulatedOutcome = 'normal' | 'busy' | 'offline' | 'disconnected' | 'failed'

const OUTCOME_OPTIONS: Array<{ id: SimulatedOutcome; label: string }> = [
  { id: 'normal', label: '正常完成' },
  { id: 'busy', label: '资源繁忙' },
  { id: 'offline', label: '渲染离线' },
  { id: 'disconnected', label: '连接断开' },
  { id: 'failed', label: '准备失败' },
]

const TERMINAL_COPY: Record<
  Exclude<SimulatedOutcome, 'normal'>,
  { title: string; description: string }
> = {
  busy: {
    title: '渲染资源繁忙',
    description: '当前没有空闲的渲染资源。请稍后手动重试，系统不会自动排队或重试。',
  },
  offline: {
    title: '渲染服务离线',
    description: '暂时无法连接渲染服务。请稍后手动重试，页面不会自动重试。',
  },
  disconnected: {
    title: '观看连接已断开',
    description: '预览连接中断。请手动重试；当前不会保留旧画面或自动恢复。',
  },
  failed: {
    title: '预览准备失败',
    description: '准备过程中断，未进入可交互状态。请手动重试。',
  },
}

/** 观看外壳只需要身份、名称与封面；公开详情和管理授权预览都可直接传入。 */
export interface PreviewWork {
  id: string
  name: string
  coverUrl: string
}

export interface PreviewViewerProps {
  work: PreviewWork
  /** 信息层开始展开；与是否完成动画无关，页面可用性不依赖它。 */
  onEntered?: () => void
}

export function PreviewViewer({ work, onEntered }: PreviewViewerProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const slotRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<HTMLElement>(null)
  const coverRef = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)

  const [coverState, setCoverState] = useState<'loading' | 'loaded' | 'error'>(
    work.coverUrl ? 'loading' : 'error',
  )
  const [status, setStatus] = useState<PreviewStatus>('idle')
  const [simulation, setSimulation] = useState<SimulatedOutcome>('normal')
  const [resetNotice, setResetNotice] = useState(false)
  const [zoomOpen, setZoomOpen] = useState(false)

  const sourceRef = useRef<CoverSource | null>(null)
  const sourceResolvedRef = useRef(false)
  const enteredRef = useRef(false)
  const onEnteredRef = useRef(onEntered)
  const statusRef = useRef<PreviewStatus>('idle')
  const startTimerRef = useRef<number | null>(null)
  const resetTimerRef = useRef<number | null>(null)
  const attemptRef = useRef(0)

  const zoomFromRef = useRef<DOMRect | null>(null)
  const closingRef = useRef(false)
  const openTweenRef = useRef<gsap.core.Tween | null>(null)
  const closeTweenRef = useRef<gsap.core.Tween | null>(null)

  useLayoutEffect(() => {
    onEnteredRef.current = onEntered
  }, [onEntered])

  useLayoutEffect(() => {
    statusRef.current = status
  }, [status])

  const notifyEntered = useCallback(() => {
    if (enteredRef.current) return
    enteredRef.current = true
    onEnteredRef.current?.()
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
      setCoverState(image.naturalWidth > 0 ? 'loaded' : 'error')
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
      // 等父级布局 effect（滚动到顶部等）完成后再测量目标，避免用过期的封面矩形。
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

  const clearStartTimer = () => {
    if (startTimerRef.current !== null) {
      window.clearTimeout(startTimerRef.current)
      startTimerRef.current = null
    }
  }

  useEffect(
    () => () => {
      attemptRef.current += 1
      if (startTimerRef.current !== null) window.clearTimeout(startTimerRef.current)
      if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current)
      openTweenRef.current?.kill()
      closeTweenRef.current?.kill()
    },
    [],
  )

  const beginPreview = () => {
    if (statusRef.current === 'preparing' || statusRef.current === 'interactive') return
    clearStartTimer()
    attemptRef.current += 1
    const attempt = attemptRef.current
    setResetNotice(false)
    setStatus('preparing')
    startTimerRef.current = window.setTimeout(() => {
      startTimerRef.current = null
      if (attempt !== attemptRef.current) return
      const outcome = simulation
      setStatus(outcome === 'normal' ? 'interactive' : outcome)
    }, 1400)
  }

  const endPreview = () => {
    if (statusRef.current !== 'interactive' && statusRef.current !== 'preparing') return
    attemptRef.current += 1
    clearStartTimer()
    setResetNotice(false)
    setStatus('ended')
    window.requestAnimationFrame(() => {
      const selector = zoomOpen ? '[data-action="close-zoom"]' : '[data-action="start"]'
      viewerRef.current?.querySelector<HTMLButtonElement>(selector)?.focus({ preventScroll: true })
    })
  }

  const resetView = () => {
    if (statusRef.current !== 'interactive') return
    setResetNotice(true)
    if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current)
    resetTimerRef.current = window.setTimeout(() => {
      resetTimerRef.current = null
      setResetNotice(false)
    }, 1600)
  }

  const focusAfterZoom = useCallback(() => {
    const selector =
      statusRef.current === 'interactive' || statusRef.current === 'preparing'
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
        duration: 0.5,
        ease: 'power3.inOut',
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
          duration: 0.5,
          ease: 'power3.inOut',
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
          'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
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

  const isInteractive = status === 'interactive'
  const isPreparing = status === 'preparing'
  const canEnd = isInteractive || isPreparing
  const terminalStatus =
    status === 'busy' || status === 'offline' || status === 'disconnected' || status === 'failed'
      ? status
      : null
  const terminalCopy = terminalStatus ? TERMINAL_COPY[terminalStatus] : null

  const hintText = isInteractive
    ? '模拟观看中 · 真实渲染尚未接入'
    : isPreparing
      ? '正在准备，可结束本次预览'
      : terminalStatus
        ? '等待手动重试'
        : status === 'ended'
          ? '预览已结束'
          : '开始预览后可用'

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
                ref={imageRef}
                className={styles.coverImage}
                src={work.coverUrl}
                alt=""
                draggable={false}
                onLoad={() => setCoverState('loaded')}
                onError={() => setCoverState('error')}
              />
            ) : (
              <span className={styles.coverFallback}>
                <span className={styles.coverFallbackMark} aria-hidden="true" />
                封面暂不可用
              </span>
            )}

            {isInteractive ? (
              <div className={styles.scene}>
                <span className={styles.sceneTag}>模拟观看画面</span>
                <strong className={styles.sceneName}>{work.name}</strong>
                <span className={styles.sceneNote}>真实模型渲染尚未接入，不表示模型已加载</span>
              </div>
            ) : null}

            {resetNotice ? (
              <span className={styles.resetNote} role="status">
                视角已复位（模拟）
              </span>
            ) : null}
          </div>

          {isInteractive ? null : (
            <div
              className={classNames(styles.statusPanel, terminalStatus && styles.statusPanelError)}
              role={terminalStatus ? 'alert' : 'status'}
            >
              {status === 'idle' ? (
                <>
                  <p className={styles.statusTitle}>封面待预览</p>
                  <p className={styles.statusText}>
                    开始后才创建模拟观看画面；当前不下载完整模型，也不创建预览会话。
                  </p>
                  <div className={styles.statusAction}>
                    <Button variant="primary" data-action="start" onClick={beginPreview}>
                      开始预览
                    </Button>
                  </div>
                </>
              ) : null}

              {status === 'preparing' ? (
                <>
                  <p className={styles.statusTitle}>
                    <span className={styles.pulse} aria-hidden="true" />
                    正在准备预览
                  </p>
                  <p className={styles.statusText}>请稍候。模拟准备完成后才显示观看画面。</p>
                  <p className={styles.simNote}>模拟准备 · 不伪造首帧</p>
                  <div className={styles.statusAction}>
                    <Button
                      variant="primary"
                      className={styles.busyButton}
                      aria-disabled="true"
                      onClick={beginPreview}
                    >
                      正在准备…
                    </Button>
                  </div>
                </>
              ) : null}

              {status === 'ended' ? (
                <>
                  <p className={styles.statusTitle}>预览已结束</p>
                  <p className={styles.statusText}>观看实例已释放。你可以重新开始一次预览。</p>
                  <div className={styles.statusAction}>
                    <Button variant="primary" data-action="start" onClick={beginPreview}>
                      开始预览
                    </Button>
                  </div>
                </>
              ) : null}

              {terminalCopy ? (
                <>
                  <p className={styles.statusTitle}>{terminalCopy.title}</p>
                  <p className={styles.statusText}>{terminalCopy.description}</p>
                  <p className={styles.simNote}>模拟场景 · 未连接真实渲染服务</p>
                  <div className={styles.statusAction}>
                    <Button variant="primary" onClick={beginPreview}>
                      手动重试
                    </Button>
                  </div>
                </>
              ) : null}
            </div>
          )}

          <div className={styles.footer}>
            <p className={styles.hint}>{hintText}</p>
            <div className={styles.controls}>
              <Button onClick={resetView} disabled={!isInteractive}>
                复位
              </Button>
              <Button
                data-action="zoom"
                onClick={openZoom}
                disabled={!isInteractive || zoomOpen}
              >
                放大查看
              </Button>
              <Button onClick={endPreview} disabled={!canEnd}>
                结束预览
              </Button>
            </div>
          </div>

          {import.meta.env.DEV ? (
            <div className={styles.devPanel}>
              <label className={styles.devLabel} htmlFor="preview-simulation">
                开发演示 · 下次开始的模拟结果
              </label>
              <select
                id="preview-simulation"
                className={styles.devSelect}
                value={simulation}
                onChange={(event) => setSimulation(event.target.value as SimulatedOutcome)}
              >
                {OUTCOME_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
              <p className={styles.devNote}>
                仅开发构建可见；繁忙、离线、断线、失败均为模拟场景，不连接真实渲染服务。
              </p>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  )
}
