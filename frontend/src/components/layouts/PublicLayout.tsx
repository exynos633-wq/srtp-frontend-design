import { Suspense } from 'react'
import { Outlet, useLocation } from 'react-router'
import { MockBadge } from '../../mocks/MockBadge'
import { classNames } from '../../lib/classNames'
import { SkipLink } from '../ui/SkipLink'
import { PublicNav } from './PublicNav'
import styles from './PublicLayout.module.css'

/** 公开端布局：跳过入口 → 导航 → 含 #main-content 的主区。 */
export default function PublicLayout() {
  const { pathname } = useLocation()
  const isHome = pathname === '/'

  return (
    <div className={styles.shell}>
      <SkipLink />
      <PublicNav overlay={isHome} />
      <main
        id="main-content"
        className={classNames(styles.main, isHome && styles.mainHome)}
        tabIndex={-1}
      >
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
      <footer className={classNames(styles.footer, isHome && styles.footerHidden)}>
        <MockBadge />
        演示阶段 · 作品数据、认证与 AI 助手尚未接入；模型查看为客户端真实渲染
      </footer>
    </div>
  )
}
