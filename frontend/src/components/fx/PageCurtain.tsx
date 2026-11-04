import { useRef } from 'react'
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { useLocation } from 'react-router'
import { EASE, SEC } from '../../lib/motion'
import { prefersReducedMotion } from '../../lib/prefersReducedMotion'
import styles from './PageCurtain.module.css'

/**
 * 路由转场光幕（动效设计 v2.1 §4.4）：内容切换时一条 1px 亮线在顶部展开为柔光后淡出。
 * 只做进场（离场不阻塞导航）；首屏不播；减少动态只保留 160ms 透明度。
 */
export function PageCurtain() {
  const { pathname } = useLocation()
  const rootRef = useRef<HTMLDivElement>(null)
  const lineRef = useRef<HTMLSpanElement>(null)
  const glowRef = useRef<HTMLSpanElement>(null)
  const firstRef = useRef(true)

  useGSAP(
    () => {
      if (firstRef.current) {
        firstRef.current = false
        return
      }
      const root = rootRef.current
      const line = lineRef.current
      const glow = glowRef.current
      if (!root || !line || !glow) return

      if (prefersReducedMotion()) {
        gsap.fromTo(
          root,
          { opacity: 0.12 },
          { opacity: 0, duration: SEC.fast, ease: 'power2.out', clearProps: 'opacity' },
        )
        return
      }

      gsap.set(root, { opacity: 1 })
      gsap.set(line, { scaleX: 0, opacity: 1 })
      gsap.set(glow, { opacity: 0 })

      const timeline = gsap.timeline({
        onComplete: () => gsap.set(root, { clearProps: 'opacity' }),
      })
      timeline.to(line, { scaleX: 1, duration: SEC.fast, ease: EASE.out }, 0)
      timeline.to(glow, { opacity: 1, duration: SEC.fast * 0.5, ease: EASE.out }, 0.02)
      timeline.to(glow, { opacity: 0, duration: SEC.enter, ease: EASE.out }, 0.12)
      timeline.to(line, { opacity: 0, duration: SEC.enter, ease: EASE.out }, 0.16)
      timeline.to(root, { opacity: 0, duration: SEC.fast, ease: EASE.out }, 0.34)

      return () => {
        timeline.kill()
      }
    },
    { dependencies: [pathname] },
  )

  return (
    <div ref={rootRef} className={styles.curtain} aria-hidden="true" data-page-curtain="true">
      <span ref={lineRef} className={styles.line} />
      <span ref={glowRef} className={styles.glow} />
    </div>
  )
}
