import { useEffect, useRef, type RefObject } from 'react'
import { prefersReducedMotion } from './prefersReducedMotion'

/** 指针光效只在精细指针、非减少动态下启用（动效设计 v2.1 §5.3）。 */
export function pointerFxEnabled(): boolean {
  if (typeof window === 'undefined') return false
  if (prefersReducedMotion()) return false
  return window.matchMedia?.('(hover: hover) and (pointer: fine)').matches === true
}

/**
 * 把指针位置写进元素的 `--mx / --my`（相对元素左上角），rAF 节流。
 * 只写 CSS 变量，不触发 React 渲染；消费方用 mask-image 做“被照亮”的局部效果。
 */
export function usePointerGlow<T extends HTMLElement>(): RefObject<T | null> {
  const ref = useRef<T>(null)

  useEffect(() => {
    const element = ref.current
    if (!element || !pointerFxEnabled()) return

    let frame = 0
    let next: { x: number; y: number } | null = null

    const apply = () => {
      frame = 0
      if (!next) return
      const rect = element.getBoundingClientRect()
      element.style.setProperty('--mx', `${next.x - rect.left}px`)
      element.style.setProperty('--my', `${next.y - rect.top}px`)
    }
    const handleMove = (event: PointerEvent) => {
      next = { x: event.clientX, y: event.clientY }
      if (!frame) frame = window.requestAnimationFrame(apply)
    }
    const handleLeave = () => {
      if (frame) window.cancelAnimationFrame(frame)
      frame = 0
      next = null
    }

    element.addEventListener('pointermove', handleMove, { passive: true })
    element.addEventListener('pointerleave', handleLeave)
    return () => {
      if (frame) window.cancelAnimationFrame(frame)
      element.removeEventListener('pointermove', handleMove)
      element.removeEventListener('pointerleave', handleLeave)
    }
  }, [])

  return ref
}
