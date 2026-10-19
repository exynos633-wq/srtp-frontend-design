/**
 * 读取系统的“减少动态效果”偏好。
 * 仅在浏览器环境可用；测试或无 matchMedia 的环境按正常动态处理。
 */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}
