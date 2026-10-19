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
import {
  rememberCoverSource,
  rememberDirectoryReturn,
  takeDirectoryReturn,
} from '../lib/worksNavigation'
import styles from './WorksPage.module.css'

const SKELETON_COUNT = 6

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

  // 仅在可见行进入视口时揭示；不排队等待全部封面，后续内容立即可滚动阅读。
  useGSAP(
    () => {
      const grid = pageRef.current?.querySelector<HTMLElement>('ul')
      if (!grid || works.length === 0 || prefersReducedMotion()) return

      const cards = Array.from(grid.querySelectorAll<HTMLElement>('[data-work-card]'))
      if (cards.length === 0) return

      if (typeof IntersectionObserver === 'undefined') return

      gsap.set(cards, { opacity: 0, y: 18 })

      const rows = new Map<number, HTMLElement[]>()
      for (const card of cards) {
        const top = Math.round(card.offsetTop)
        const row = rows.get(top)
        if (row) row.push(card)
        else rows.set(top, [card])
      }

      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue
            const top = Number((entry.target as HTMLElement).dataset.revealRow)
            const row = rows.get(top)
            if (!row) continue
            observer.unobserve(entry.target)
            gsap.to(row, {
              opacity: 1,
              y: 0,
              duration: 0.52,
              ease: 'power2.out',
              stagger: 0.06,
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
        gsap.killTweensOf(cards)
        gsap.set(cards, { clearProps: 'opacity,transform' })
      }
      motionQuery.addEventListener('change', showAll)

      return () => {
        observer.disconnect()
        motionQuery.removeEventListener('change', showAll)
        gsap.killTweensOf(cards)
        gsap.set(cards, { clearProps: 'opacity,transform' })
      }
    },
    { scope: pageRef, dependencies: [works.length] },
  )

  const errorMessage =
    error instanceof Error ? error.message : '读取作品列表失败，请稍后手动重试。'

  return (
    <div className={styles.page} ref={pageRef}>
      <PageHeader
        eyebrow="公开目录"
        title="全部作品"
        description="按发布时间排序，一次展示全部已发布作品。城市选填，未设置城市不影响查看。"
      />

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
        <ul className={styles.grid} aria-label="已发布作品">
          {works.map((work) => (
            <WorkCard
              key={work.id}
              workId={work.id}
              href={`/works/${work.id}`}
              title={work.name}
              cityName={work.city?.name ?? null}
              coverUrl={work.coverUrl}
              onOpen={handleOpen}
            />
          ))}
        </ul>
      ) : null}
    </div>
  )
}
