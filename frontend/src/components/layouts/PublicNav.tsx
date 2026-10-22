import { useEffect, useRef } from 'react'
import { Link, NavLink, useLocation } from 'react-router'
import { appConfig } from '../../app/env'
import { classNames } from '../../lib/classNames'
import styles from './PublicNav.module.css'

const navItems = [
  { to: '/', label: '地图探索', end: true },
  { to: '/works', label: '全部作品', end: false },
  { to: '/admin', label: '后台管理', end: false },
] as const

/** 朱砂短线落在目标项文字下方并居中；宽度短于标签，避免变成整条导航装饰线。 */
function placeIndicator(
  list: HTMLUListElement,
  indicator: HTMLSpanElement,
  target: HTMLElement,
) {
  const listRect = list.getBoundingClientRect()
  const rect = target.getBoundingClientRect()
  const width = Math.min(56, Math.max(16, rect.width - 24))
  indicator.style.width = `${width}px`
  indicator.style.transform = `translateX(${rect.left - listRect.left + (rect.width - width) / 2}px)`
  indicator.dataset.visible = 'true'
}

/**
 * 公开端导航。
 * - <768：品牌行 56 + 导航行 44，两行实色。
 * - 桌面：墨色发丝线导航；当前项与指针悬停共用一条朱砂下划线。
 * - 顶部细进度线随页面滚动；减少动态时仍保留信息，不播放下划线动画。
 */
interface PublicNavProps {
  overlay?: boolean
}

export function PublicNav({ overlay = false }: PublicNavProps) {
  const location = useLocation()
  const listRef = useRef<HTMLUListElement>(null)
  const indicatorRef = useRef<HTMLSpanElement>(null)
  const progressRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const progress = progressRef.current
    if (!progress) return
    let frame = 0
    const update = () => {
      frame = 0
      const max = document.documentElement.scrollHeight - window.innerHeight
      const ratio = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0
      progress.style.transform = `scaleX(${ratio})`
      progress.dataset.visible = ratio > 0.01 ? 'true' : 'false'
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    update()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
    }
  }, [])

  useEffect(() => {
    const list = listRef.current
    const indicator = indicatorRef.current
    if (!list || !indicator) return
    const place = () => {
      const active = list.querySelector<HTMLElement>('[aria-current="page"]')
      if (!active) {
        indicator.dataset.visible = 'false'
        return
      }
      placeIndicator(list, indicator, active)
    }
    place()
    // 断点切换（手机网格 ↔ 桌面横排）后重新对齐短线。
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [location.pathname])

  const moveIndicator = (target: HTMLElement | null) => {
    const list = listRef.current
    const indicator = indicatorRef.current
    if (!list || !indicator) return
    if (!target) {
      const active = list.querySelector<HTMLElement>('[aria-current="page"]')
      if (active) placeIndicator(list, indicator, active)
      else indicator.dataset.visible = 'false'
      return
    }
    placeIndicator(list, indicator, target)
  }

  return (
    <header
      className={classNames(styles.header, overlay && styles.overlay)}
      data-public-nav="true"
    >
      <div className={styles.bar}>
        <Link className={styles.brand} to="/">
          <span className={styles.brandMark} aria-hidden="true">◇</span>
          <span>{appConfig.appName}<span className={styles.brandCaption}>ARCHITECTURAL COLLECTION</span></span>
        </Link>
        <nav className={styles.nav} aria-label="公开展示区导航">
          <ul
            className={styles.list}
            ref={listRef}
            onPointerLeave={() => moveIndicator(null)}
          >
            {navItems.map((item) => (
              <li key={item.to} className={styles.item}>
                <NavLink
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) => classNames(styles.link, isActive && styles.active)}
                  onPointerEnter={(event) => moveIndicator(event.currentTarget)}
                  onFocus={(event) => moveIndicator(event.currentTarget)}
                >
                  {item.label}
                </NavLink>
              </li>
            ))}
            <span ref={indicatorRef} className={styles.indicator} aria-hidden="true" data-nav-indicator="true" data-visible="false" />
          </ul>
        </nav>
      </div>
      <span ref={progressRef} className={styles.progress} aria-hidden="true" data-nav-progress="true" data-visible="false" />
    </header>
  )
}
