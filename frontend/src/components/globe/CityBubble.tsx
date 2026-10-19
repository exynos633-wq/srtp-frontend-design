import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { Link } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { Button } from '../ui/Button'
import { isApiError } from '../../api/http'
import { listCityWorks } from '../../api/globe'
import { queryKeys } from '../../api/queryKeys'
import { rememberCoverSource } from '../../lib/worksNavigation'
import type { GlobeCity } from '../../types/city'
import type { PublicWork } from '../../types/work'
import styles from './CityBubble.module.css'

export type CityBubbleMode = 'hover' | 'pinned'

export interface CityBubbleProps {
  city: GlobeCity
  mode: CityBubbleMode
  reducedMotion: boolean
  maxHeight: number
  solid: boolean
  closing: boolean
  sectionRef: RefObject<HTMLElement | null>
  onMeasure: (size: { width: number; height: number }) => void
  onClose: () => void
  onPin: () => void
  onMissing: () => void
  onPointerEnter: () => void
  onPointerLeave: () => void
  onFocusLeave: (next: Node | null) => void
}

function BubbleWorkItem({ work }: { work: PublicWork }) {
  const imageRef = useRef<HTMLImageElement>(null)
  const [failed, setFailed] = useState(false)

  const handleClick = () => {
    const image = imageRef.current
    if (!image) return
    rememberCoverSource({
      workId: work.id,
      coverUrl: work.coverUrl,
      rect: image.getBoundingClientRect(),
    })
  }

  return (
    <li className={styles.workItem} data-bubble-work>
      <Link className={styles.workLink} to={`/works/${work.id}`} onClick={handleClick}>
        <span className={styles.thumb}>
          {failed || !work.coverUrl ? (
            <span className={styles.thumbFallback}>封面暂不可用</span>
          ) : (
            <img
              ref={imageRef}
              className={styles.thumbImage}
              src={work.coverUrl}
              alt=""
              loading="lazy"
              decoding="async"
              draggable={false}
              onError={() => setFailed(true)}
            />
          )}
        </span>
        <span className={styles.workText}>
          <strong className={styles.workName}>{work.name}</strong>
          <span className={styles.workHint}>查看作品</span>
        </span>
        <span className={styles.chevron} aria-hidden="true">
          ›
        </span>
      </Link>
    </li>
  )
}

export function CityBubble({
  city,
  mode,
  reducedMotion,
  maxHeight,
  solid,
  closing,
  sectionRef,
  onMeasure,
  onClose,
  onPin,
  onMissing,
  onPointerEnter,
  onPointerLeave,
  onFocusLeave,
}: CityBubbleProps) {
  const headingId = useId()
  const worksQuery = useQuery({
    queryKey: queryKeys.globe.cityWorks(city.id),
    queryFn: ({ signal }) => listCityWorks(city.id, signal),
  })

  const works = worksQuery.data?.items ?? []
  const missing = isApiError(worksQuery.error) && worksQuery.error.status === 404

  useEffect(() => {
    if (missing) onMissing()
  }, [missing, onMissing])

  useLayoutEffect(() => {
    const section = sectionRef.current
    if (!section) return
    const measure = () => {
      const rect = section.getBoundingClientRect()
      if (rect.width > 0) onMeasure({ width: rect.width, height: rect.height })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(section)
    return () => observer.disconnect()
  }, [onMeasure, sectionRef])

  useGSAP(
    () => {
      const section = sectionRef.current
      if (!section) return
      if (reducedMotion) {
        gsap.set(section, { opacity: 1, y: 0 })
        return
      }
      gsap.fromTo(
        section,
        { opacity: 0, y: 8 },
        { opacity: 1, y: 0, duration: 0.34, ease: 'power2.out' },
      )
    },
    { scope: sectionRef, dependencies: [city.id, reducedMotion] },
  )

  useGSAP(
    () => {
      if (reducedMotion || works.length === 0) return
      const items = sectionRef.current?.querySelectorAll('[data-bubble-work]')
      if (!items || items.length === 0) return
      gsap.fromTo(
        items,
        { opacity: 0, y: 6 },
        {
          opacity: 1,
          y: 0,
          duration: 0.28,
          ease: 'power2.out',
          delay: 0.08,
          stagger: 0.04,
          clearProps: 'opacity,transform',
        },
      )
    },
    { scope: sectionRef, dependencies: [city.id, works.length, reducedMotion] },
  )

  const province = city.province.name !== city.name ? city.province.name : null
  const errorMessage = isApiError(worksQuery.error)
    ? worksQuery.error.message
    : '读取城市作品失败，请稍后手动重试。'

  return (
    <section
      ref={sectionRef}
      className={styles.bubble}
      data-city-bubble
      data-city-id={city.id}
      data-mode={mode}
      data-solid={solid}
      data-closing={closing}
      style={{ maxHeight }}
      aria-labelledby={headingId}
      onPointerDown={(event) => event.stopPropagation()}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onFocusCapture={onPin}
      onBlur={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
        onFocusLeave(event.relatedTarget as Node | null)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          onClose()
        }
      }}
    >
      <header className={styles.header}>
        <div className={styles.heading}>
          <h2 className={styles.title} id={headingId}>
            {city.name}
          </h2>
          {province && <p className={styles.province}>{province}</p>}
        </div>
        <button
          type="button"
          className={styles.close}
          aria-label={`关闭${city.name}作品列表`}
          onClick={onClose}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </header>

      {worksQuery.isPending ? (
        <div className={styles.status} role="status">
          <span className={styles.statusTitle}>正在读取城市作品…</span>
          <span className={styles.skeletonRow} />
          <span className={styles.skeletonRow} />
        </div>
      ) : worksQuery.isError ? (
        <div className={styles.status} role="alert">
          <strong className={styles.statusTitle}>城市作品读取失败</strong>
          <p className={styles.statusText}>{errorMessage}</p>
          <div className={styles.actions}>
            <Button
              variant="secondary"
              onClick={() => void worksQuery.refetch()}
              disabled={worksQuery.isFetching}
            >
              手动重试
            </Button>
            <Link className={styles.textLink} to="/works">
              全部作品
            </Link>
          </div>
        </div>
      ) : works.length === 0 ? (
        <div className={styles.status}>
          <strong className={styles.statusTitle}>该城市暂无可浏览的作品</strong>
          <p className={styles.statusText}>目录中仍可能有其他城市的作品。</p>
          <Link className={styles.textLink} to="/works">
            前往全部作品
          </Link>
        </div>
      ) : (
        <ul className={styles.workList} aria-label={`${city.name}的已发布作品`}>
          {works.map((work) => (
            <BubbleWorkItem work={work} key={work.id} />
          ))}
        </ul>
      )}
    </section>
  )
}
