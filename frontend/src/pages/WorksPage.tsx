import { useLayoutEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { listPublicWorks } from '../api/works'
import { queryKeys } from '../api/queryKeys'
import { Button } from '../components/ui/Button'
import { PageHeader } from '../components/ui/PageHeader'
import { StatusMessage } from '../components/ui/StatusMessage'
import { ScanLoader } from '../components/fx/ScanLoader'
import { WorkCard, type WorkCardOpenSource } from '../components/works/WorkCard'
import { prefersReducedMotion } from '../lib/prefersReducedMotion'
import { EASE, SEC } from '../lib/motion'
import {
  rememberCoverSource,
  rememberDirectoryReturn,
  takeDirectoryReturn,
} from '../lib/worksNavigation'
import styles from './WorksPage.module.css'

const SKELETON_COUNT = 6

/** 目录页头入场只在本会话首次进入播放一次（动效设计 v2.0 §2「叙事只发生一次」）。 */
let directoryEntrancePlayed = false
/** 首屏签名扫描线同样只播一次（动效设计 v2.1 §4.2）；与数据到达时点解耦。 */
let directoryScanPlayed = false

/**
 * §6 目录的设计时长统一落回 motion.ts 的 SEC，避免散落字面量；
 * 时间轴位置（0.08 / 0.18 …）与 stagger 只是编排参数，随注释指认。
 * v2.1 §4.2 的签名时长同样由 SEC 组合：灯管 600ms、光团 900ms、扫描线/计数 800ms。
 */
const TIMING = {
  eyebrow: SEC.slow, // 280ms
  title: SEC.enter + SEC.press, // 520ms
  description: SEC.fast * 2, // 320ms
  count: SEC.press + SEC.fast, // 300ms
  index: SEC.base + SEC.press, // 360ms
  reveal: SEC.scene * 0.7, // 420ms
  lampLine: SEC.scene, // 600ms
  lampGlow: SEC.cinema * 0.75, // 900ms
  scan: SEC.cinema * (2 / 3), // 800ms
  ticker: SEC.cinema * (2 / 3), // 800ms
} as const

function DirectorySkeleton() {
  return (
    <div className={styles.skeletonGrid} aria-hidden="true">
      {Array.from({ length: SKELETON_COUNT }, (_, index) => (
        <div className={styles.skeletonCard} key={index}>
          <span className={styles.skeletonMedia} />
          <span className={styles.skeletonBody}>
            <span className={styles.skeletonLine} />
            <span className={styles.skeletonLineShort} />
          </span>
        </div>
      ))}
    </div>
  )
}

export default function WorksPage() {
  const pageRef = useRef<HTMLDivElement>(null)
  const restoredRef = useRef(false)
  /** 页头入场是否仍在播放，用于把计数/索引行/首排对齐 §6 的绝对时点。 */
  const entranceRef = useRef<{ startedAt: number; playing: boolean } | null>(null)
  /** 计数 ticker 只改这个 DOM 文本节点的 nodeValue，不逐帧 setState（v2.1 §4.2）。 */
  const countNumberRef = useRef<HTMLElement>(null)

  const { data, isPending, isError, isFetching, error, refetch } = useQuery({
    queryKey: queryKeys.works.list(),
    queryFn: ({ signal }) => listPublicWorks(signal),
  })

  const works = data?.items ?? []

  const handleOpen = (source: WorkCardOpenSource) => {
    rememberDirectoryReturn({ scrollY: window.scrollY, workId: source.workId })
    if (source.coverUrl && source.rect) {
      rememberCoverSource({
        workId: source.workId,
        coverUrl: source.coverUrl,
        rect: {
          left: source.rect.left,
          top: source.rect.top,
          width: source.rect.width,
          height: source.rect.height,
        },
      })
    }
  }

  // 返回目录时恢复滚动位置与入口焦点；直接进入 /works 时不做任何事。
  useLayoutEffect(() => {
    if (restoredRef.current || isPending || isError) return
    restoredRef.current = true
    const saved = takeDirectoryReturn()
    if (!saved) return
    window.scrollTo({ top: saved.scrollY, left: 0, behavior: 'auto' })
    const entry = document.getElementById(`work-card-link-${saved.workId}`)
    entry?.focus({ preventScroll: true })
  }, [isPending, isError, works.length])

  // 页头入场（§6）：eyebrow → 标题逐行 → 描述；数据到达后再接计数/索引行/首排。
  // 只在本会话首次进入播放；后台页面复用 PageHeader，但不会触发这里的时间轴。
  useGSAP(
    () => {
      const root = pageRef.current
      if (!root || directoryEntrancePlayed || prefersReducedMotion()) return

      const eyebrow = root.querySelector<HTMLElement>('[data-page-eyebrow]')
      const title = root.querySelector<HTMLElement>('[data-page-title-inner]')
      const description = root.querySelector<HTMLElement>('[data-page-description]')
      if (!eyebrow || !title || !description) return

      entranceRef.current = { startedAt: performance.now(), playing: true }
      const timeline = gsap.timeline({
        onComplete: () => {
          directoryEntrancePlayed = true
          if (entranceRef.current) entranceRef.current.playing = false
        },
      })
      timeline.fromTo(
        eyebrow,
        { opacity: 0, y: 6 },
        { opacity: 1, y: 0, duration: TIMING.eyebrow, ease: EASE.out, clearProps: 'opacity,transform' },
        0,
      )
      timeline.fromTo(
        title,
        { yPercent: 110 },
        { yPercent: 0, duration: TIMING.title, ease: EASE.enter, clearProps: 'transform' },
        0.08,
      )
      timeline.fromTo(
        description,
        { opacity: 0, y: 8 },
        { opacity: 1, y: 0, duration: TIMING.description, ease: EASE.out, clearProps: 'opacity,transform' },
        0.18,
      )

      // v2.1 §4.2 lamp 灯管：1px 亮线从中间展开（600ms）+ 一层 blur 光团呼吸（900ms）。
      // 两者都是绝对定位的装饰层，不参与布局；blur 是静态的，只动 transform / opacity。
      const lampLine = root.querySelector<HTMLElement>('[data-lamp-line]')
      const lampGlow = root.querySelector<HTMLElement>('[data-lamp-glow]')
      if (lampLine) {
        timeline.fromTo(
          lampLine,
          { scaleX: 0 },
          { scaleX: 1, duration: TIMING.lampLine, ease: EASE.out, clearProps: 'transform' },
          0,
        )
      }
      if (lampGlow) {
        timeline.fromTo(
          lampGlow,
          { opacity: 0 },
          { opacity: 0.6, duration: TIMING.lampGlow * 0.5, ease: EASE.out },
          0,
        )
        timeline.to(
          lampGlow,
          { opacity: 0.35, duration: TIMING.lampGlow * 0.5, ease: EASE.out },
          TIMING.lampGlow * 0.5,
        )
      }

      // 入场途中切到「减少动态」：直接落到最终状态，不再播完位移。
      // 测试环境可能没有 matchMedia，此时不订阅（不影响一次性入场）。
      const motionQuery =
        typeof window.matchMedia === 'function'
          ? window.matchMedia('(prefers-reduced-motion: reduce)')
          : null
      const settle = () => {
        if (!motionQuery?.matches) return
        timeline.kill()
        directoryEntrancePlayed = true
        if (entranceRef.current) entranceRef.current.playing = false
        gsap.set(
          [eyebrow, title, description, lampLine, lampGlow].filter(
            (element): element is HTMLElement => element !== null,
          ),
          { clearProps: 'opacity,transform' },
        )
      }
      motionQuery?.addEventListener('change', settle)

      return () => {
        motionQuery?.removeEventListener('change', settle)
        timeline.kill()
        if (entranceRef.current) entranceRef.current.playing = false
      }
    },
    { scope: pageRef },
  )

  // 数据到达后接计数/索引行（仅在页头入场进行中按 §6 时点）；卡片只做行级滚动揭示。
  useGSAP(
    () => {
      if (works.length === 0 || prefersReducedMotion()) return

      const root = pageRef.current
      const grid = root?.querySelector<HTMLElement>('ul')
      if (!root || !grid) return

      const entrance = entranceRef.current
      const startedAt = entrance?.playing ? entrance.startedAt : null
      /** §6 的绝对时点换算成相对现在仍需等待的秒数；页头已结束就不再滞后。 */
      const offset = (seconds: number) => {
        if (startedAt === null) return 0
        return Math.max(0, seconds - (performance.now() - startedAt) / 1000)
      }

      const revealTargets: HTMLElement[] = []

      const count = root.querySelector<HTMLElement>('[data-directory-count]')
      if (count && startedAt !== null) {
        const parts = Array.from(count.querySelectorAll<HTMLElement>('strong, span'))
        revealTargets.push(...parts)
        gsap.fromTo(
          parts,
          { opacity: 0, y: 6 },
          {
            opacity: 1,
            y: 0,
            duration: TIMING.count,
            ease: EASE.out,
            stagger: 0.04, // 数字与标签错峰 40ms
            delay: offset(0.24),
            clearProps: 'opacity,transform',
          },
        )
      }

      const indexRow = root.querySelector<HTMLElement>('[data-directory-index]')
      const indexRule = root.querySelector<HTMLElement>('[data-directory-index-rule]')
      if (indexRow && startedAt !== null) {
        const labels = Array.from(indexRow.querySelectorAll<HTMLElement>(':scope > span'))
        revealTargets.push(indexRow, ...labels)
        gsap.fromTo(
          labels,
          { opacity: 0 },
          { opacity: 1, duration: SEC.fast, ease: EASE.out, stagger: 0.04, delay: offset(0.32), clearProps: 'opacity' },
        )
      }
      if (indexRule && startedAt !== null) {
        revealTargets.push(indexRule)
        gsap.fromTo(
          indexRule,
          { scaleX: 0 },
          {
            scaleX: 1,
            duration: TIMING.index,
            ease: EASE.out,
            delay: offset(0.32),
            transformOrigin: 'left center',
            clearProps: 'transform',
          },
        )
      }

      if (typeof IntersectionObserver === 'undefined') return

      // —— v2.1 §4.2 签名：计数 ticker 与首屏扫描线 ——
      // ticker 只写这个 DOM 文本节点（GSAP 的 rAF 驱动），不触发 React 重渲染；
      // 写 nodeValue 而不是替换 textContent：文本节点仍归 React 所有，卸载时不会因
      // 引用失效报 removeChild 错误；结束时强制回到真实值，不残留中间数字。
      const countNumber = countNumberRef.current
      const writeCountText = (value: number) => {
        if (!countNumber) return
        const textNode = countNumber.firstChild
        const text = String(value).padStart(2, '0')
        if (textNode && textNode.nodeType === Node.TEXT_NODE) textNode.nodeValue = text
        else countNumber.textContent = text
      }
      let countTween: gsap.core.Tween | null = null
      if (countNumber && startedAt !== null) {
        writeCountText(0)
        const counter = { value: 0 }
        countTween = gsap.to(counter, {
          value: works.length,
          duration: TIMING.ticker,
          delay: offset(0.24),
          ease: EASE.out,
          onUpdate: () => writeCountText(Math.round(counter.value)),
          onComplete: () => writeCountText(works.length),
        })
      }

      // 扫描线：1px accent 渐变高光沿索引线从左扫到右，容器 overflow 裁切避免横向溢出。
      // 每次会话只播一次；减少动态下不播（数据 effect 开头已提前返回）。
      const scanStage = root.querySelector<HTMLElement>('[data-scan-stage]')
      const scanLine = root.querySelector<HTMLElement>('[data-scan-line]')
      let scanTween: gsap.core.Tween | null = null
      if (scanStage && scanLine && !directoryScanPlayed) {
        const lineWidth = scanLine.offsetWidth || 180
        scanTween = gsap.fromTo(
          scanLine,
          { x: -lineWidth },
          {
            x: scanStage.offsetWidth,
            duration: TIMING.scan,
            delay: startedAt !== null ? offset(0.5) : 0,
            ease: EASE.out,
            onComplete: () => {
              // 播完才记为“已播”，StrictMode 的首次模拟卸载会重播而不是吞掉签名。
              directoryScanPlayed = true
              scanTween = null
              gsap.set(scanLine, { clearProps: 'transform' })
            },
          },
        )
      }

      const cards = Array.from(grid.querySelectorAll<HTMLElement>('[data-work-card]'))
      if (cards.length === 0) return
      revealTargets.push(...cards)

      gsap.set(cards, { opacity: 0, y: 12 })

      // 行分组沿用 offsetTop：首排含宽幅 featured 卡，高度不同但同排 top 一致。
      const rows = new Map<number, HTMLElement[]>()
      for (const card of cards) {
        const top = Math.round(card.offsetTop)
        const row = rows.get(top)
        if (row) row.push(card)
        else rows.set(top, [card])
      }

      let firstRow = true
      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue
            const top = Number((entry.target as HTMLElement).dataset.revealRow)
            const row = rows.get(top)
            if (!row) continue
            observer.unobserve(entry.target)
            const delay = firstRow && startedAt !== null ? offset(0.36) : 0
            firstRow = false
            gsap.to(row, {
              opacity: 1,
              y: 0,
              duration: TIMING.reveal,
              ease: EASE.out,
              stagger: 0.05,
              delay,
              overwrite: true,
              onComplete: () => gsap.set(row, { clearProps: 'opacity,transform' }),
            })
          }
        },
        { threshold: 0.12, rootMargin: '0px 0px -8% 0px' },
      )

      for (const [top, row] of rows) {
        const first = row[0]
        if (!first) continue
        first.dataset.revealRow = String(top)
        observer.observe(first)
      }

      const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
      const settleSignature = () => {
        countTween?.kill()
        countTween = null
        writeCountText(works.length)
        scanTween?.kill()
        scanTween = null
        if (scanLine) gsap.set(scanLine, { clearProps: 'transform' })
      }

      const showAll = () => {
        if (!motionQuery.matches) return
        observer.disconnect()
        gsap.killTweensOf(revealTargets)
        gsap.set(revealTargets, { clearProps: 'opacity,transform' })
        settleSignature()
      }
      motionQuery.addEventListener('change', showAll)

      return () => {
        observer.disconnect()
        motionQuery.removeEventListener('change', showAll)
        gsap.killTweensOf(revealTargets)
        gsap.set(revealTargets, { clearProps: 'opacity,transform' })
        settleSignature()
      }
    },
    { scope: pageRef, dependencies: [works.length] },
  )

  const errorMessage =
    error instanceof Error ? error.message : '读取作品列表失败，请稍后手动重试。'

  return (
    <div className={styles.page} ref={pageRef}>
      {/* v2.1 §4.2 lamp：绝对定位装饰层，不占布局高度；灯管只在首次进入时展开。 */}
      <div className={styles.headerStage}>
        <span className={styles.lampGlow} data-lamp-glow aria-hidden="true" />
        <span className={styles.lampLine} data-lamp-line aria-hidden="true" />
        <PageHeader
          className={styles.header}
          eyebrow="SPATIAL COLLECTION / 空间档案"
          title="全部作品"
          description="从建筑的细部，到山川的轮廓。以三维视角，收藏真实世界的不同切面。"
        >
          {works.length > 0 ? (
            <p className={styles.collectionCount} data-directory-count>
              <strong ref={countNumberRef}>{String(works.length).padStart(2, '0')}</strong>
              <span>件公开作品</span>
            </p>
          ) : null}
        </PageHeader>
      </div>

      {isPending ? (
        <div className={styles.state} aria-busy="true">
          {/* §4.4 扫描 loader：唯一 role="status"；骨架屏 aria-hidden 不重复播报。 */}
          <ScanLoader label="正在读取作品…" compact />
          <DirectorySkeleton />
        </div>
      ) : null}

      {isError && works.length === 0 ? (
        <div className={styles.state}>
          <StatusMessage tone="error">{errorMessage}</StatusMessage>
          <div className={styles.retry}>
            <Button onClick={() => void refetch()} disabled={isFetching}>
              {isFetching ? '正在重试…' : '手动重试'}
            </Button>
          </div>
        </div>
      ) : null}

      {!isPending && !isError && works.length === 0 ? (
        <div className={styles.state}>
          <StatusMessage tone="info">
            暂无已发布作品。新作品发布后会出现在这里，不需要刷新页面。
          </StatusMessage>
        </div>
      ) : null}

      {isError && works.length > 0 ? (
        <div className={styles.state}>
          <StatusMessage tone="error">{errorMessage}</StatusMessage>
          <div className={styles.retry}>
            <Button onClick={() => void refetch()} disabled={isFetching}>
              {isFetching ? '正在重试…' : '手动重试'}
            </Button>
          </div>
        </div>
      ) : null}

      {works.length > 0 ? (
        <div className={styles.directoryBody}>
          {/* 签名扫描线：绝对定位在索引行上，容器 1px + overflow 裁切，不拦截指针。 */}
          <div className={styles.scanStage} data-scan-stage aria-hidden="true">
            <span className={styles.scanLine} data-scan-line />
          </div>
          <div className={styles.directoryMeta} data-directory-index>
            <div className={styles.indexRule} data-directory-index-rule aria-hidden="true" />
            <span>作品索引 <span aria-hidden="true">/</span> 建筑 · 地形 · 空间</span>
            <span>按发布时间排序</span>
          </div>
          <ul className={styles.grid} aria-label="已发布作品">
            {works.map((work, index) => (
              <WorkCard
                key={work.id}
                workId={work.id}
                href={`/works/${work.id}`}
                title={work.name}
                cityName={work.city?.name ?? null}
                coverUrl={work.coverUrl}
                index={index + 1}
                description={index === 0 ? work.description : undefined}
                modelFormat={work.modelFormat}
                onOpen={handleOpen}
              />
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
