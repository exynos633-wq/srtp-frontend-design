import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { Link, useParams } from 'react-router'
import { getPublicWork } from '../api/works'
import { queryKeys } from '../api/queryKeys'
import { isApiError } from '../api/http'
import { Button } from '../components/ui/Button'
import { StatusMessage } from '../components/ui/StatusMessage'
import { PreviewViewer } from '../components/works/PreviewViewer'
import { resolveWorkModelSource } from '../viewer/workModelSource'
import { classNames } from '../lib/classNames'
import { prefersReducedMotion } from '../lib/prefersReducedMotion'
import type { PublicWork } from '../types/work'
import styles from './WorkDetailPage.module.css'

export default function WorkDetailPage() {
  const { id } = useParams<{ id: string }>()
  // 作品切换时重置“已开始观看”的本地保留状态。
  return <WorkDetailContent key={id ?? 'missing'} id={id} />
}

function WorkDetailContent({ id }: { id?: string }) {
  const pageRef = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const stateTitleRef = useRef<HTMLHeadingElement>(null)
  const [enteredWorkId, setEnteredWorkId] = useState<string | null>(null)
  const [startedWorkId, setStartedWorkId] = useState<string | null>(null)
  const [retainedWork, setRetainedWork] = useState<PublicWork | null>(null)

  const { data: work, isPending, isError, isFetching, error, refetch } = useQuery({
    queryKey: queryKeys.works.detail(id ?? ''),
    queryFn: ({ signal }) => getPublicWork(id ?? '', signal),
    enabled: Boolean(id),
    // 新进入详情时按当前公开状态重新确认，不把旧目录缓存当作仍公开。
    staleTime: 0,
  })

  const started = startedWorkId === id && retainedWork?.id === id
  const displayedWork = work ?? (started ? retainedWork : null)
  const entered = displayedWork != null && enteredWorkId === displayedWork.id
  const handleEntered = useCallback(() => {
    if (displayedWork) setEnteredWorkId(displayedWork.id)
  }, [displayedWork])
  const handlePreviewStarted = useCallback(() => {
    if (!displayedWork) return
    setStartedWorkId(displayedWork.id)
    setRetainedWork(displayedWork)
  }, [displayedWork])
  const ensurePreviewAvailable = useCallback(async () => {
    if (!id) return false
    try {
      await getPublicWork(id)
      return true
    } catch (failure) {
      if (isApiError(failure) && failure.status === 404) {
        // 用同一公开读取边界刷新页面；已开始的观看由 retainedWork 保留。
        void refetch()
        return false
      }
      throw failure
    }
  }, [id, refetch])
  const workId = displayedWork?.id

  // 详情总是从顶部开始；返回目录的滚动位置由目录页单独恢复。
  useLayoutEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
  }, [id])

  useLayoutEffect(() => {
    if (!workId) return
    if (!prefersReducedMotion()) {
      const layers = pageRef.current?.querySelectorAll<HTMLElement>('[data-detail-layer]')
      if (layers) gsap.set(layers, { opacity: 0, y: 16 })
    }
    // 直接进入与目录进入都把焦点落在主标题；页面可用性不依赖转场是否完成。
    titleRef.current?.focus({ preventScroll: true })
  }, [workId])

  useGSAP(
    () => {
      if (!displayedWork || !entered) return
      const layers = pageRef.current?.querySelectorAll<HTMLElement>('[data-detail-layer]')
      if (!layers || layers.length === 0) return
      if (prefersReducedMotion()) {
        gsap.set(layers, { clearProps: 'opacity,transform' })
        return
      }
      gsap.to(layers, {
        opacity: 1,
        y: 0,
        duration: 0.5,
        ease: 'power2.out',
        stagger: 0.07,
        overwrite: true,
        clearProps: 'opacity,transform',
      })
    },
    { scope: pageRef, dependencies: [entered, displayedWork?.id] },
  )

  const notFound = !id || (!started && isApiError(error) && error.status === 404)
  const showReadError = !notFound && !started && isError && displayedWork === null
  const errorMessage =
    error instanceof Error ? error.message : '读取作品详情失败，请稍后手动重试。'

  useLayoutEffect(() => {
    if (!notFound && !showReadError) return
    stateTitleRef.current?.focus({ preventScroll: true })
  }, [notFound, showReadError])

  return (
    <div className={styles.page} ref={pageRef}>
      <Link className={styles.back} to="/works">
        <span className={styles.backArrow} aria-hidden="true">
          ←
        </span>
        返回全部作品
      </Link>

      {isPending && !notFound && !displayedWork ? (
        <div className={styles.stateBlock} aria-busy="true">
          <StatusMessage tone="info">正在读取作品信息与封面…</StatusMessage>
        </div>
      ) : null}

      {notFound ? (
        <div className={styles.stateBlock}>
          <h1 className={styles.stateTitle} ref={stateTitleRef} tabIndex={-1}>
            作品不存在
          </h1>
          <StatusMessage tone="error">
            该作品可能未公开、已下架，或编号有误。请返回目录查看当前已发布作品。
          </StatusMessage>
        </div>
      ) : null}

      {showReadError ? (
        <div className={styles.stateBlock}>
          <h1 className={styles.stateTitle} ref={stateTitleRef} tabIndex={-1}>
            作品读取失败
          </h1>
          <StatusMessage tone="error">{errorMessage}</StatusMessage>
          <div className={styles.stateAction}>
            <Button onClick={() => void refetch()} disabled={isFetching}>
              {isFetching ? '正在重试…' : '手动重试'}
            </Button>
          </div>
        </div>
      ) : null}

      {started && isApiError(error) && error.status === 404 ? (
        <StatusMessage tone="warning">
          该作品已不再公开。当前已开始的真实观看会保留；结束后不能重新开始。
        </StatusMessage>
      ) : null}

      {!notFound && displayedWork ? (
        <div className={styles.layout}>
          <header className={styles.infoHeader} data-detail-layer>
            <p className={styles.eyebrow}>THE ARCHITECTURAL COLLECTION / 空间档案</p>
            <h1 className={styles.title} ref={titleRef} tabIndex={-1}>
              {displayedWork.name}
            </h1>
            <p className={styles.city}><span className={styles.cityDot} aria-hidden="true" />{displayedWork.city?.name ?? '未设置城市'}</p>
          </header>
          <div className={styles.viewerColumn} data-exhibition-viewer>
            <PreviewViewer
              key={displayedWork.id}
              work={displayedWork}
              onEntered={handleEntered}
              onPreviewStarted={handlePreviewStarted}
              ensureAvailable={ensurePreviewAvailable}
              resolveModelSource={resolveWorkModelSource}
            />
          </div>

          <aside className={styles.info} aria-label="作品信息">
            <section className={styles.section} data-detail-layer>
              <h2 className={styles.sectionTitle}>建筑介绍</h2>
              <p className={styles.paragraph}>{displayedWork.description}</p>
            </section>

            {displayedWork.modelingNote && displayedWork.modelingNote.trim() !== '' ? (
              <section className={styles.section} data-detail-layer>
                <h2 className={styles.sectionTitle}>建模说明（选填）</h2>
                <p className={styles.paragraph}>{displayedWork.modelingNote}</p>
              </section>
            ) : null}

            <section className={classNames(styles.section, styles.commentSection)} data-detail-layer>
              <h2 className={styles.sectionTitle}>评论 · 预留</h2>
              <p className={styles.placeholderText}>
                公开评论将在后续版本提供；当前不接受提交，也不展示模拟评论。
              </p>
              <p className={styles.likePlaceholder}>作品点赞 · 预留</p>
            </section>
          </aside>
        </div>
      ) : null}
    </div>
  )
}
