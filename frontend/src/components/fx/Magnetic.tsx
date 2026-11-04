import { useEffect, useRef, type ReactNode } from 'react'
import gsap from 'gsap'
import { pointerFxEnabled } from '../../lib/lightField'
import { classNames } from '../../lib/classNames'
import styles from './Magnetic.module.css'

export interface MagneticProps {
  children: ReactNode
  /** 位移比例；本站上限 0.28。 */
  strength?: number
  /** 最大位移（px）；本站上限 5。 */
  max?: number
  className?: string
}

/**
 * 指针磁吸（动效设计 v2.1 §2.1 magnetic-button 的本站改编）。
 * 只在精细指针与非减少动态下生效，位移 ≤ max，离开后回正。
 */
export function Magnetic({ children, strength = 0.28, max = 5, className }: MagneticProps) {
  const wrapRef = useRef<HTMLSpanElement>(null)
  const innerRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const wrap = wrapRef.current
    const inner = innerRef.current
    if (!wrap || !inner || !pointerFxEnabled()) return

    const xTo = gsap.quickTo(inner, 'x', { duration: 0.38, ease: 'power3.out' })
    const yTo = gsap.quickTo(inner, 'y', { duration: 0.38, ease: 'power3.out' })

    const clamp = (value: number) => Math.max(-max, Math.min(max, value))
    const handleMove = (event: PointerEvent) => {
      const rect = wrap.getBoundingClientRect()
      const dx = event.clientX - (rect.left + rect.width / 2)
      const dy = event.clientY - (rect.top + rect.height / 2)
      xTo(clamp(dx * strength))
      yTo(clamp(dy * strength))
    }
    const handleLeave = () => {
      xTo(0)
      yTo(0)
    }

    wrap.addEventListener('pointermove', handleMove)
    wrap.addEventListener('pointerleave', handleLeave)
    return () => {
      wrap.removeEventListener('pointermove', handleMove)
      wrap.removeEventListener('pointerleave', handleLeave)
      gsap.killTweensOf(inner)
      gsap.set(inner, { clearProps: 'transform' })
    }
  }, [max, strength])

  return (
    <span ref={wrapRef} className={classNames(styles.wrap, className)}>
      <span ref={innerRef} className={styles.inner}>
        {children}
      </span>
    </span>
  )
}
