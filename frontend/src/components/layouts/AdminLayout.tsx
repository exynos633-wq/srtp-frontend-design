import { Suspense, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import AdminGate from '../auth/AdminGate'
import { logout } from '../../api/auth'
import { clearAdminCache } from '../../api/adminSession'
import { queryKeys } from '../../api/queryKeys'
import { ApiError } from '../../api/http'
import { Button } from '../ui/Button'
import { StatusMessage } from '../ui/StatusMessage'
import { appConfig } from '../../app/env'
import { classNames } from '../../lib/classNames'
import { confirmActiveLeave, allowActiveLeaveNavigation, resetActiveLeaveConsent } from '../../lib/leaveGuard'
import { MockBadge } from '../../mocks/MockBadge'
import { SkipLink } from '../ui/SkipLink'
import styles from './AdminLayout.module.css'
import { PublicNav } from './PublicNav'

const navClass = ({ isActive }: { isActive: boolean }): string =>
  classNames(styles.link, isActive && styles.active)

export default function AdminLayout() {
  const { pathname } = useLocation()
  const client = useQueryClient()
  const navigate = useNavigate()
  const busy = useRef(false)
  const [leaving, setLeaving] = useState(false)
  const [error, setError] = useState('')
  async function signOut() {
    if (busy.current) return
    // 必须在 logout、清缓存和卸载表单之前确认；拒绝时零退出请求。
    if (!confirmActiveLeave()) return
    busy.current = true
    setLeaving(true)
    setError('')
    try {
      await logout()
      clearAdminCache(client)
      client.removeQueries({ queryKey: queryKeys.auth.all })
      // 退出成功只放行这一次到登录页的跳转；等待期间的其他导航仍受表单 guard 约束。
      allowActiveLeaveNavigation('/admin/login')
      await navigate('/admin/login', { replace: true })
    } catch (failure) {
      resetActiveLeaveConsent()
      if (failure instanceof ApiError && (failure.status === 401 || failure.status === 403)) {
        clearAdminCache(client)
        client.setQueryData(queryKeys.auth.failure(), failure)
        client.setQueryData(queryKeys.auth.me(), null)
      } else {
        setError('退出未完成，无法确认服务端会话已结束，请手动重试。')
      }
    }
    finally { busy.current = false; setLeaving(false) }
  }
  const isLoginPage = pathname === '/admin/login'

  return (
    <div className={styles.shell}>
      <SkipLink />
      {isLoginPage ? <PublicNav /> : <header className={styles.header}>
        <div className={styles.bar}>
          <Link className={styles.brand} to="/">
            {appConfig.appName}
            <span className={styles.brandTag}>管理后台</span>
          </Link>
          <MockBadge />
        </div>
      </header>}
      <main id="main-content" className={styles.main} tabIndex={-1}>
        <Suspense
          fallback={
            <p className={styles.fallback} role="status">
              页面加载中…
            </p>
          }
        >
          {isLoginPage ? <Outlet /> : <AdminGate key={pathname}>
            <nav className={styles.nav} aria-label="管理后台导航">
              <NavLink to="/admin/works" className={navClass}>作品管理</NavLink>
              <NavLink to="/" end className={navClass}>返回公开展示</NavLink>
              <Button disabled={leaving} onClick={() => void signOut()}>{leaving ? '正在退出…' : '退出登录'}</Button>
            </nav>
            {error && <StatusMessage tone="error">{error}</StatusMessage>}
            <div
              data-admin-outlet
              inert={leaving ? true : undefined}
              aria-busy={leaving || undefined}
            >
              <Outlet />
            </div>
          </AdminGate>}
        </Suspense>
      </main>
    </div>
  )
}
