import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query'
import { ApiError } from '../api/http'
import { clearAdminCache } from '../api/adminSession'
import { queryKeys } from '../api/queryKeys'

/**
 * 全局 Query 客户端配置：
 * - 关闭自动重试：接口失败时由页面提供“手动重试”，不后台重发；
 * - 不做窗口聚焦刷新，避免演示时反复打请求；
 * - 写操作（mutation）不自动重发，避免重复发布／重复建会话。
 */
export function createQueryClient() {
  const onError = (error: unknown, key?: readonly unknown[]) => {
    // 登录页也会检查 me：认证检查失败时不能遗留先前页面的草稿缓存。
    if (key?.[0] === 'auth' && key[1] === 'me') {
      clearAdminCache(client)
      return
    }
    if ((key?.[0] === 'admin' || key?.[0] === 'dictionary') && error instanceof ApiError && (error.status === 401 || error.status === 403)) {
      clearAdminCache(client)
      client.setQueryData(queryKeys.auth.failure(), error)
      client.setQueryData(queryKeys.auth.me(), null)
    }
  }
  const client = new QueryClient({
    queryCache: new QueryCache({ onError: (error, query) => onError(error, query.queryKey) }),
    mutationCache: new MutationCache({ onError: (error, _variables, _context, mutation) => onError(error, mutation.options.mutationKey) }),
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
  return client
}

/** 页面判断“要不要显示重试按钮”时用：只有可重试错误才提示重试。 */
export function isRetryableError(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false
  if (error.status === 401 || error.status === 403 || error.status === 404) return false
  return error.status === 0 || error.status >= 500
}

export const queryClient = createQueryClient()
