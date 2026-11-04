import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { Link } from 'react-router'
import { usePointerGlow } from '../../lib/lightField'
import { usePrefersReducedMotion } from '../../lib/usePrefersReducedMotion'
import type { ModelFormat } from '../../types/work'
import styles from './WorkCard.module.css'

/** v2.1 §4.2 首排封面视差幅度：随卡片穿过视口做 ±6px 的 translateY。 */
const PARALLAX_PX = 6

export interface WorkCardOpenSource {
  workId: string
  coverUrl: string | null
  rect: DOMRect | null
}

export interface WorkCardProps {
  workId: string
  /** 详情地址；整张卡片只有这一个链接目标。 */
  href: string
  title: string
  /** 未填城市显示“未设置城市”，不作为错误状态。 */
  cityName?: string | null
  coverUrl?: string | null
  index?: number
  description?: string
  modelFormat?: ModelFormat
  /** 仅用于目录内的选中态示意，不替代业务状态文字。 */
  selected?: boolean
  /** 仅用于同页导航的来源记录；新标签页、键盘菜单等不传来源。 */
  onOpen?: (source: WorkCardOpenSource) => void
}

export function WorkCard({
  workId,
  href,
  title,
  cityName,
  coverUrl,
  index,
  description,
  modelFormat,
  selected = false,
  onOpen,
}: WorkCardProps) {
  const mediaRef = useRef<HTMLSpanElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  // 指针位置写进整卡链接的 --mx/--my，供 ::before 1px 光边框与 ::after 首排光斑读取；
  // 钩子自带 hover / 减少动态门控（动效设计 v2.1 §5.3）。
  const cardRef = usePointerGlow<HTMLAnchorElement>()
  const reducedMotion = usePrefersReducedMotion()
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null)

  const hasCover = Boolean(coverUrl) && failedUrl !== coverUrl
  const coverLoaded = hasCover && loadedUrl === coverUrl
  // 首排大卡才有视差（index 1 即 data-featured）。
  const isFeatured = index === 1

  useEffect(() => {
    // v2.1 §4.2 首排封面视差：只写 CSS 变量 --parallax-y，由 .image 的 translate 合成；
    // hover 的 scale(1.02) 走独立的 scale 属性，两者互不覆盖，也不触发 CSS transform 过渡。
    // 手机与减少动态不建 ScrollTrigger；没有 window.matchMedia 的环境（jsdom）直接跳过，
    // 且 ScrollTrigger 只在真正需要时动态载入（它的注册过程依赖 matchMedia）。
    if (!isFeatured || !hasCover) return
    const image = imageRef.current
    if (!image || typeof window.matchMedia !== 'function') return
    if (reducedMotion || window.matchMedia('(max-width: 767px)').matches) return

    let cancelled = false
    let teardown: (() => void) | null = null
    void import('../../lib/scrollFx')
      .then(({ gsap }) => {
        if (cancelled) return
        const trigger = image.closest<HTMLElement>('[data-work-card]') ?? image
        const tween = gsap.fromTo(
          image,
          { '--parallax-y': `${-PARALLAX_PX}px` },
          {
            '--parallax-y': `${PARALLAX_PX}px`,
            ease: 'none',
            scrollTrigger: {
              trigger,
              start: 'top bottom',
              end: 'bottom top',
              scrub: 0.6,
            },
          },
        )
        teardown = () => {
          tween.scrollTrigger?.kill()
          tween.kill()
          image.style.removeProperty('--parallax-y')
        }
      })
      .catch(() => {
        // 视差只是增强项：模块加载失败时保持静态封面，不影响目录可用性。
      })

    return () => {
      cancelled = true
      teardown?.()
    }
  }, [isFeatured, hasCover, reducedMotion])

  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    // 只记录普通左键同页导航；组合键、中键和新标签页保持浏览器默认行为。
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return
    }
    onOpen?.({
      workId,
      coverUrl: coverLoaded ? coverUrl ?? null : null,
      rect: mediaRef.current?.getBoundingClientRect() ?? null,
    })
  }

  return (
    <li className={styles.item} data-work-card data-work-id={workId} data-featured={index === 1 ? 'true' : undefined}>
      <Link
        id={`work-card-link-${workId}`}
        ref={cardRef}
        className={styles.card}
        to={href}
        data-work-card-link
        onClick={handleClick}
      >
        <span
          className={styles.media}
          data-selected={selected ? 'true' : undefined}
          data-cover-ready={coverLoaded ? 'true' : undefined}
          ref={mediaRef}
        >
          {hasCover ? (
            <img
              ref={imageRef}
              className={styles.image}
              src={coverUrl ?? ''}
              alt=""
              loading="lazy"
              decoding="async"
              draggable={false}
              onLoad={() => setLoadedUrl(coverUrl ?? null)}
              onError={() => setFailedUrl(coverUrl ?? null)}
            />
          ) : (
            <span className={styles.fallback}>
              <span className={styles.fallbackMark} aria-hidden="true" />
              <span>{coverUrl ? '封面暂不可用' : '暂无封面'}</span>
            </span>
          )}
        </span>
        <span className={styles.body}>
          <span className={styles.caption}>
            {index !== undefined ? <span className={styles.number} aria-hidden="true">{String(index).padStart(2, '0')} <span>/</span></span> : null}
            <span className={styles.city}>{cityName ?? '未设置城市'}</span>
          </span>
          <h3 className={styles.title}>{title}</h3>
          {description ? <span className={styles.description}>{description}</span> : null}
          <span className={styles.foot}>
            <span className={styles.format}>{modelFormat === 'gaussian-ply' ? '高斯泼溅' : modelFormat === 'mesh-ply' ? '网格模型' : modelFormat === 'glb' ? '三维模型' : '空间作品'}</span>
            <span className={styles.entry}>查看作品 <span className={styles.arrow} aria-hidden="true">↗</span></span>
          </span>
        </span>
      </Link>
    </li>
  )
}
