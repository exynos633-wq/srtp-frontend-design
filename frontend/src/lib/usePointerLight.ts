import { useEffect, useRef, type PointerEvent } from 'react'

/** 指针只更新 CSS 变量；入场动画留在外层，不与倾斜争写 transform。 */
export function usePointerLight<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const frame = useRef(0)

  const reset = () => {
    cancelAnimationFrame(frame.current)
    const node = ref.current
    if (!node) return
    for (const name of ['--tilt-x', '--tilt-y', '--magnet-x', '--magnet-y']) {
      node.style.removeProperty(name)
    }
  }

  useEffect(() => () => cancelAnimationFrame(frame.current), [])

  const onPointerMove = (event: PointerEvent<T>) => {
    if (event.pointerType !== 'mouse' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      reset()
      return
    }
    const node = ref.current
    if (!node) return
    const rect = node.getBoundingClientRect()
    const x = (event.clientX - rect.left) / rect.width
    const y = (event.clientY - rect.top) / rect.height
    cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(() => {
      node.style.setProperty('--pointer-x', `${x * 100}%`)
      node.style.setProperty('--pointer-y', `${y * 100}%`)
      node.style.setProperty('--tilt-x', `${(0.5 - y) * 9}deg`)
      node.style.setProperty('--tilt-y', `${(x - 0.5) * 9}deg`)
      node.style.setProperty('--magnet-x', `${(x - 0.5) * 10}px`)
      node.style.setProperty('--magnet-y', `${(y - 0.5) * 10}px`)
    })
  }

  return { ref, onPointerMove, onPointerLeave: reset }
}
