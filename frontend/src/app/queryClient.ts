import { QueryClient } from '@tanstack/react-query'
import { ApiError } from '../api/http'

/**
 * 全局 Query 客户端配置：
 * - 关闭自动重试：接口失败时由页面提供“手动重试”，不后台重发；
 * - 不做窗口聚焦刷新，避免演示时反复打请求；
 * - 写操作（mutation）不自动重发，避免重复发布／重复建会话。
 */
export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
        staleTime: 30_000,
      },
      mutations: {
        retry: false,
      },
    },
  })
}

/** 页面判断“要不要显示重试按钮”时用：只有可重试错误才提示重试。 */
export function isRetryableError(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false
  if (error.status === 401 || error.status === 403 || error.status === 404) return false
  return error.status === 0 || error.status >= 500
}

export const queryClient = createQueryClient()
