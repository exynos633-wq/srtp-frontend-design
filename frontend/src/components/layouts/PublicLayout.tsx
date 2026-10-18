import { NavLink, Outlet } from 'react-router'
import { Suspense } from 'react'
import { appConfig } from '../../app/env'
import styles from './PublicLayout.module.css'

const navClass = ({ isActive }: { isActive: boolean }): string =>
  isActive ? `${styles.navLink} ${styles.navLinkActive}` : styles.navLink

/** 公开展示区布局：导航 + 路由内容。地球场景与设计变量在 P02／P07 落地。 */
export default function PublicLayout() {
  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <NavLink to="/" className={styles.brand}>
          {appConfig.appName}
        </NavLink>
        <nav className={styles.nav} aria-label="公开展示区导航">
          <NavLink to="/" end className={navClass}>
            地图探索
          </NavLink>
          <NavLink to="/works" className={navClass}>
            全部作品
          </NavLink>
          <NavLink to="/admin/works" className={navClass}>
            后台管理
          </NavLink>
        </nav>
      </header>
      <main className={styles.main}>
        <Suspense fallback={<p className={styles.loading}>页面模块加载中…</p>}>
          <Outlet />
        </Suspense>
      </main>
      <footer className={styles.footer}>
        P01 路由骨架 · 页面内容为开发占位，未接入后端、模型渲染或 AI 助手
      </footer>
    </div>
  )
}
