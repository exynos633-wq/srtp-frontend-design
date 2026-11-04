import { useLayoutEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { listPublicWorks } from '../api/works'
import { queryKeys } from '../api/queryKeys'
import { Button } from '../components/ui/Button'
import { PageHeader } from '../components/ui/PageHeader'
import { StatusMessage } from '../components/ui/StatusMessage'
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

/**
 * §6 目录的设计时长统一落回 motion.ts 的 SEC，避免散落字面量；
 * 时间轴位置（0.08 / 0.18 …）与 stagger 只是编排参数，随注释指认。
 */
const TIMING = {
  eyebrow: SEC.slow, // 280ms
  title: SEC.enter + SEC.press, // 520ms
  description: SEC.fast * 2, // 320ms
  count: SEC.press + SEC.fast, // 300ms
  index: SEC.base + SEC.press, // 360ms
  reveal: SEC.scene * 0.7, // 420ms
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
        gsap.set([eyebrow, title, description], { clearProps: 'opacity,transform' })
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
      const showAll = () => {
        if (!motionQuery.matches) return
        observer.disconnect()
        gsap.killTweensOf(revealTargets)
        gsap.set(revealTargets, { clearProps: 'opacity,transform' })
      }
      motionQuery.addEventListener('change', showAll)

      return () => {
        observer.disconnect()
        motionQuery.removeEventListener('change', showAll)
        gsap.killTweensOf(revealTargets)
        gsap.set(revealTargets, { clearProps: 'opacity,transform' })
      }
    },
    { scope: pageRef, dependencies: [works.length] },
  )

  const errorMessage =
    error instanceof Error ? error.message : '读取作品列表失败，请稍后手动重试。'

  return (
    <div className={styles.page} ref={pageRef}>
      <PageHeader
        className={styles.header}
        eyebrow="SPATIAL COLLECTION / 空间档案"
        title="全部作品"
        description="从建筑的细部，到山川的轮廓。以三维视角，收藏真实世界的不同切面。"
      >
        {works.length > 0 ? (
          <p className={styles.collectionCount} data-directory-count>
            <strong>{String(works.length).padStart(2, '0')}</strong>
            <span>件公开作品</span>
          </p>
        ) : null}
      </PageHeader>

      {isPending ? (
        <div className={styles.state} aria-busy="true">
          <StatusMessage tone="info">正在读取作品…</StatusMessage>
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
        <>
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
        </>
      ) : null}
    </div>
  )
}
