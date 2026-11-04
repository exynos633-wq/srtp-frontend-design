import { useEffect, useRef } from 'react'
import { pointerFxEnabled } from '../../lib/lightField'
import styles from './CursorLight.module.css'

/**
 * 光标即光源（动效设计 v2.1 §4.1）：桌面端一层 400px 冷光斑跟随指针，
 * lerp 平滑、alpha ≤ .06；触屏与减少动态不创建。不做自绘光标。
 */
export function CursorLight() {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!pointerFxEnabled()) return
    const element = ref.current
    if (!element) return

    let frame = 0
    const target = { x: -400, y: -400 }
    const current = { x: -400, y: -400 }
    let visible = false

    const tick = () => {
      current.x += (target.x - current.x) * 0.12
      current.y += (target.y - current.y) * 0.12
      element.style.transform = `translate3d(${current.x}px, ${current.y}px, 0)`
      if (visible) frame = window.requestAnimationFrame(tick)
    }
    const show = () => {
      if (visible) return
      visible = true
      element.style.opacity = '1'
      frame = window.requestAnimationFrame(tick)
    }
    const hide = () => {
      visible = false
      element.style.opacity = '0'
      if (frame) window.cancelAnimationFrame(frame)
      frame = 0
    }
    const handleMove = (event: PointerEvent) => {
      target.x = event.clientX
      target.y = event.clientY
      show()
    }
    const handleLeave = () => hide()

    window.addEventListener('pointermove', handleMove, { passive: true })
    document.addEventListener('pointerleave', handleLeave)
    return () => {
      hide()
      window.removeEventListener('pointermove', handleMove)
      document.removeEventListener('pointerleave', handleLeave)
    }
  }, [])

  return <div ref={ref} className={styles.light} aria-hidden="true" data-cursor-light="true" />
}
