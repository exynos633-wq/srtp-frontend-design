import type { QueryClient } from '@tanstack/react-query'
import type { ApiError } from './http'
import { queryKeys } from './queryKeys'

/** 先取消读请求，再移除敏感缓存；公开作品缓存不受影响。 */
export function clearAdminCache(client: QueryClient) {
  for (const queryKey of [queryKeys.admin.all, queryKeys.dictionary.all]) {
    void client.cancelQueries({ queryKey })
    client.removeQueries({ queryKey })
  }
  client.getMutationCache().clear()
}

/** 管理请求 401/403 的统一边界：清私有缓存并通知 AuthGate。 */
export function handleAdminAuthFailure(client: QueryClient, error: ApiError): void {
  clearAdminCache(client)
  client.setQueryData(queryKeys.auth.failure(), error)
  client.setQueryData(queryKeys.auth.me(), null)
}

/** 仅接受已定义的管理页面，不接受 origin、查询参数或编码后的路径。 */
export function adminReturnPath(value: string | null): string {
  if (value && /^\/admin\/works(?:\/new|\/[A-Za-z0-9_-]+\/(?:edit|preview))?$/.test(value)) return value
  return '/admin/works'
}
