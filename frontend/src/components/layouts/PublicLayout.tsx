import { Suspense, useRef } from 'react'
import { Outlet, useLocation } from 'react-router'
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { MockBadge } from '../../mocks/MockBadge'
import { classNames } from '../../lib/classNames'
import { EASE, SEC } from '../../lib/motion'
import { usePrefersReducedMotion } from '../../lib/usePrefersReducedMotion'
import { CursorLight } from '../fx/CursorLight'
import { GrainOverlay } from '../fx/GrainOverlay'
import { PageCurtain } from '../fx/PageCurtain'
import { ScanLoader } from '../fx/ScanLoader'
import { SkipLink } from '../ui/SkipLink'
import { PublicNav } from './PublicNav'
import styles from './PublicLayout.module.css'

/** 公开端布局：跳过入口 → 导航 → 含 #main-content 的主区。 */
export default function PublicLayout() {
  const { pathname } = useLocation()
  const isHome = pathname === '/'
  const mainRef = useRef<HTMLElement>(null)
  const reducedMotion = usePrefersReducedMotion()
  const firstRenderRef = useRef(true)

  // 路由进场（动效设计 v2.1 §4.4）：首屏交给各页自己的开场，之后每次路由切换
  // 让主区轻微上移淡入；减少动态只保留 160ms 透明度。离场不阻塞导航。
  useGSAP(
    () => {
      if (firstRenderRef.current) {
        firstRenderRef.current = false
        return
      }
      const main = mainRef.current
      if (!main) return
      if (reducedMotion) {
        gsap.fromTo(
          main,
          { opacity: 0.7 },
          { opacity: 1, duration: SEC.fast, ease: 'power2.out', clearProps: 'opacity' },
        )
        return
      }
      // 只动 opacity：main 上的 transform 会成为 fixed 子元素的包含块，
      // 与详情页放大查看的 fixed 对话框冲突；位移交给 PageCurtain 的光幕。
      gsap.fromTo(
        main,
        { opacity: 0.7 },
        { opacity: 1, duration: SEC.slow, ease: EASE.out, clearProps: 'opacity' },
      )
    },
    { dependencies: [pathname] },
  )

  return (
    <div className={styles.shell}>
      <GrainOverlay />
      <CursorLight />
      <PageCurtain />
      <SkipLink />
      <PublicNav overlay={isHome} />
      <main
        id="main-content"
        ref={mainRef}
        className={classNames(styles.main, isHome && styles.mainHome)}
        tabIndex={-1}
      >
        <Suspense
          fallback={
            <div className={styles.suspense}>
              <ScanLoader label="页面加载中…" />
            </div>
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
