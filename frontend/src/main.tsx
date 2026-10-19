import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from 'react-router'
import { queryClient } from './app/queryClient'
import { router } from './app/router'
import { startMocksIfEnabled } from './mocks/enable'
import './styles/global.css'

function requireRoot(): HTMLElement {
  const element = document.getElementById('root')
  if (element === null) {
    throw new Error('找不到根节点 #root，index.html 可能被改动过。')
  }
  return element
}

/**
 * 先决定 Mock 是否挂载，再渲染应用：首批请求要能命中 Mock，
 * 未启用时（默认与生产）完全走真实 fetch。
 */
async function bootstrap(): Promise<void> {
  await startMocksIfEnabled()
  createRoot(requireRoot()).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </StrictMode>,
  )
}

void bootstrap()
