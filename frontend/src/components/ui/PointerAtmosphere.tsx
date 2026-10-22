import { useEffect, useRef, useState } from 'react'
import { usePrefersReducedMotion } from '../../lib/usePrefersReducedMotion'
import styles from './PointerAtmosphere.module.css'

/**
 * v3 交互层：中性纸白展陈光 + 指针伴随环。
 * 不替换系统光标；只在精细指针、非减少动态时挂载，卸载时取消 rAF。
 */
export function PointerAtmosphere() {
  const reducedMotion = usePrefersReducedMotion()
  const [finePointer, setFinePointer] = useState(false)
  const layerRef = useRef<HTMLDivElement>(null)
  const glowRef = useRef<HTMLDivElement>(null)
  const ringRef = useRef<HTMLDivElement>(null)
  const labelRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const query = window.matchMedia('(hover: hover) and (pointer: fine)')
    const update = () => setFinePointer(query.matches)
    update()
    query.addEventListener?.('change', update)
    return () => query.removeEventListener?.('change', update)
  }, [])

  useEffect(() => {
    if (!finePointer || reducedMotion) return
    const layer = layerRef.current
    const glow = glowRef.current
    const ring = ringRef.current
    const label = labelRef.current
    if (!layer || !glow || !ring || !label) return

    let frame = 0
    let currentX = 0
    let currentY = 0
    let targetX = 0
    let targetY = 0
    let visible = false

    const render = () => {
      frame = 0
      currentX += (targetX - currentX) * 0.22
      currentY += (targetY - currentY) * 0.22
      glow.style.transform = `translate3d(${currentX - 280}px, ${currentY - 280}px, 0)`
      ring.style.transform = `translate3d(${currentX}px, ${currentY}px, 0) translate(-50%, -50%)`
      const moving = Math.abs(targetX - currentX) > 0.4 || Math.abs(targetY - currentY) > 0.4
      if (moving) frame = requestAnimationFrame(render)
    }

    const handleMove = (event: PointerEvent) => {
      targetX = event.clientX
      targetY = event.clientY
      if (!visible) {
        visible = true
        currentX = targetX
        currentY = targetY
        layer.dataset.visible = 'true'
      }
      document.documentElement.style.setProperty('--page-pointer-x', `${targetX}px`)
      document.documentElement.style.setProperty('--page-pointer-y', `${targetY}px`)
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-cursor-label]') : null
      const nextLabel = target?.dataset.cursorLabel ?? ''
      if (label.textContent !== nextLabel) label.textContent = nextLabel
      layer.dataset.cursor = nextLabel ? 'true' : 'false'
      if (!frame) frame = requestAnimationFrame(render)
    }

    const handleLeave = () => {
      visible = false
      layer.dataset.visible = 'false'
    }

    window.addEventListener('pointermove', handleMove, { passive: true })
    document.documentElement.addEventListener('pointerleave', handleLeave)
    return () => {
      window.removeEventListener('pointermove', handleMove)
      document.documentElement.removeEventListener('pointerleave', handleLeave)
      cancelAnimationFrame(frame)
      document.documentElement.style.removeProperty('--page-pointer-x')
      document.documentElement.style.removeProperty('--page-pointer-y')
    }
  }, [finePointer, reducedMotion])

  if (!finePointer || reducedMotion) return null

  return (
    <div ref={layerRef} className={styles.layer} aria-hidden="true" data-pointer-atmosphere="true">
      <div ref={glowRef} className={styles.glow} />
      <div ref={ringRef} className={styles.ring}>
        <span ref={labelRef} className={styles.label} />
      </div>
    </div>
  )
}
