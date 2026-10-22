import { useEffect, useState } from 'react'
import { Link, NavLink } from 'react-router'
import { appConfig } from '../../app/env'
import { classNames } from '../../lib/classNames'
import styles from './PublicNav.module.css'

const navItems = [
  { to: '/', label: '地图探索', end: true },
  { to: '/works', label: '全部作品', end: false },
  { to: '/admin', label: '后台管理', end: false },
] as const

/**
 * 公开端导航。
 * - <768：品牌行 56 + 导航行 44，两行实色。
 * - 桌面：展陈玻璃导航，目录与详情滚动后收拢。
 * - 手机保留品牌和三个入口的两行布局。
 */
interface PublicNavProps {
  overlay?: boolean
}

export function PublicNav({ overlay = false }: PublicNavProps) {
  const [compact, setCompact] = useState(false)
  useEffect(() => {
    const update = () => setCompact(window.scrollY > 64)
    update()
    window.addEventListener('scroll', update, { passive: true })
    return () => window.removeEventListener('scroll', update)
  }, [])
  return (
    <header
      className={classNames(styles.header, overlay && styles.overlay)}
      data-public-nav="true"
      data-compact={compact ? 'true' : undefined}
    >
      <div className={styles.bar}>
        <Link className={styles.brand} to="/">
          <span className={styles.brandMark} aria-hidden="true">◇</span>
          <span>{appConfig.appName}<span className={styles.brandCaption}>ARCHITECTURAL COLLECTION</span></span>
        </Link>
        <nav className={styles.nav} aria-label="公开展示区导航">
          <ul className={styles.list}>
            {navItems.map((item) => (
              <li key={item.to} className={styles.item}>
                <NavLink
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) => classNames(styles.link, isActive && styles.active)}
                >
                  {item.label}
                  <span className={styles.underline} aria-hidden="true" />
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </header>
  )
}
