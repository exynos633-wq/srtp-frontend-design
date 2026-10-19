import { Suspense } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router'
import { appConfig } from '../../app/env'
import { classNames } from '../../lib/classNames'
import { MockBadge } from '../../mocks/MockBadge'
import { SkipLink } from '../ui/SkipLink'
import styles from './AdminLayout.module.css'

const navClass = ({ isActive }: { isActive: boolean }): string =>
  classNames(styles.link, isActive && styles.active)

/**
 * 管理后台布局：实色顶栏 + 单列主区。
 *
 * 这里没有任何认证逻辑：未登录也能打开管理页，真实登录、会话与权限校验由服务端
 * 在 P09／P16 接入。登录页只保留品牌行，避免出现“已登录”的误导。
 */
export default function AdminLayout() {
  const { pathname } = useLocation()
  const isLoginPage = pathname === '/admin/login'

  return (
    <div className={styles.shell}>
      <SkipLink />
      <header className={styles.header}>
        <div className={styles.bar}>
          <Link className={styles.brand} to="/">
            {appConfig.appName}
            <span className={styles.brandTag}>管理后台</span>
          </Link>
          {isLoginPage ? null : (
            <nav className={styles.nav} aria-label="管理后台导航">
              <NavLink to="/admin/works" className={navClass}>
                作品管理
              </NavLink>
              <NavLink to="/" end className={navClass}>
                返回公开展示
              </NavLink>
            </nav>
          )}
          <MockBadge />
        </div>
      </header>
      <main id="main-content" className={styles.main} tabIndex={-1}>
        <Suspense
          fallback={
            <p className={styles.fallback} role="status">
              页面加载中…
            </p>
          }
        >
          <Outlet />
        </Suspense>
      </main>
    </div>
  )
}
