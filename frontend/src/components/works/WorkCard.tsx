import { useRef, useState, type MouseEvent } from 'react'
import { Link } from 'react-router'
import { usePointerLight } from '../../lib/usePointerLight'
import styles from './WorkCard.module.css'

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
  /** 仅用于目录内的选中态示意，不替代业务状态文字。 */
  selected?: boolean
  /** 仅用于同页导航的来源记录；新标签页、键盘菜单等不传来源。 */
  onOpen?: (source: WorkCardOpenSource) => void
  ordinal?: number
}

export function WorkCard({
  workId,
  href,
  title,
  cityName,
  coverUrl,
  selected = false,
  onOpen,
  ordinal,
}: WorkCardProps) {
  const { ref: pointerRef, onPointerMove: movePointer, onPointerLeave: resetPointer } = usePointerLight<HTMLAnchorElement>()
  const mediaRef = useRef<HTMLSpanElement>(null)
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null)

  const hasCover = Boolean(coverUrl) && failedUrl !== coverUrl
  const coverLoaded = hasCover && loadedUrl === coverUrl

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
    // 读取来源前让内层即时归正，避免倾斜矩形与 Flip 代理起点不一致。
    event.currentTarget.dataset.opening = 'true'
    resetPointer()
    onOpen?.({
      workId,
      coverUrl: coverLoaded ? coverUrl ?? null : null,
      rect: mediaRef.current?.getBoundingClientRect() ?? null,
    })
  }

  return (
    <li className={styles.item} data-work-card data-work-id={workId}>
      <Link
        id={`work-card-link-${workId}`}
        className={styles.card}
        ref={pointerRef}
        to={href}
        onClick={handleClick}
        onPointerMove={movePointer}
        onPointerLeave={(event) => {
          resetPointer()
          delete event.currentTarget.dataset.opening
        }}
      >
        <span className={styles.surface}>
          <span
            className={styles.media}
            data-selected={selected ? 'true' : undefined}
            data-cover-ready={coverLoaded ? 'true' : undefined}
            ref={mediaRef}
          >
            {ordinal != null && <span className={styles.ordinal} aria-hidden="true">{String(ordinal).padStart(2, '0')} / COLLECTION</span>}
            {hasCover ? (
              <img
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
              <h3 className={styles.title}>{title}</h3>
              <span className={styles.city}>{cityName ?? '未设置城市'}</span>
            </span>
            <span className={styles.arrow} aria-hidden="true">↗</span>
          </span>
        </span>
      </Link>
    </li>
  )
}
