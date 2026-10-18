import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// 未启用 vitest globals，因此显式清理每次渲染的 DOM。
afterEach(() => {
  cleanup()
})
