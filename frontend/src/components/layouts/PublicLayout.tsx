import { Suspense } from 'react'
import { Outlet } from 'react-router'
import { SkipLink } from '../ui/SkipLink'
import { PublicNav } from './PublicNav'
import styles from './PublicLayout.module.css'

/** 公开端布局：跳过入口 → 导航 → 含 #main-content 的主区。 */
export default function PublicLayout() {
  return (
    <div className={styles.shell}>
      <SkipLink />
      <PublicNav />
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
      <footer className={styles.footer}>
        演示阶段 · 作品数据、认证、模型渲染与 AI 助手尚未接入
      </footer>
    </div>
  )
}
