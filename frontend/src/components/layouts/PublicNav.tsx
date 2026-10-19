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
 * - ≥768：单行 72，导航居中。
 * - 首页叠在场景上时可用玻璃（#080D12EB + 12px 模糊）；当前首页尚无场景，统一实色。
 */
export function PublicNav() {
  return (
    <header className={styles.header}>
      <div className={styles.bar}>
        <Link className={styles.brand} to="/">
          {appConfig.appName}
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
