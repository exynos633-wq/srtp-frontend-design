import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

// jsdom 不实现滚动；用无操作替身避免页面恢复逻辑输出未实现错误。
Object.defineProperty(window, 'scrollTo', { value: vi.fn(), writable: true })

// jsdom 不实现 WebGL；明确返回 null，让首页走可验证的三维不可用回退。
Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
  value: () => null,
  writable: true,
})

// 未启用 vitest globals，因此显式清理每次渲染的 DOM。
afterEach(() => {
  cleanup()
})
