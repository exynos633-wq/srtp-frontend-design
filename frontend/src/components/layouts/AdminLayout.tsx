import { NavLink, Outlet, useLocation } from 'react-router'
import { Suspense } from 'react'
import { appConfig } from '../../app/env'
import styles from './AdminLayout.module.css'

const navClass = ({ isActive }: { isActive: boolean }): string =>
  isActive ? `${styles.navLink} ${styles.navLinkActive}` : styles.navLink

/**
 * 管理后台布局。
 *
 * 这里没有任何认证逻辑：未登录也能打开管理占位页，真实登录、会话与权限校验
 * 由服务端在 P09／P16 接入。登录页隐藏管理导航，避免出现“已登录”的误导。
 */
export default function AdminLayout() {
  const { pathname } = useLocation()
  const isLoginPage = pathname === '/admin/login'

  return (
    <div className={styles.shell}>
      {isLoginPage ? null : (
        <header className={styles.header}>
          <p className={styles.brand}>{appConfig.appName} · 管理后台</p>
          <nav className={styles.nav} aria-label="管理后台导航">
            <NavLink to="/admin/works" className={navClass}>
              作品管理
            </NavLink>
            <NavLink to="/" className={navClass}>
              返回公开展示
            </NavLink>
          </nav>
        </header>
      )}
      <main className={styles.main}>
        <Suspense fallback={<p className={styles.loading}>页面模块加载中…</p>}>
          <Outlet />
        </Suspense>
      </main>
    </div>
  )
}
