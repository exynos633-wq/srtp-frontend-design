import type { QueryClient } from '@tanstack/react-query'
import { queryKeys } from './queryKeys'

/** 先取消读请求，再移除敏感缓存；公开作品缓存不受影响。 */
export function clearAdminCache(client: QueryClient) {
  for (const queryKey of [queryKeys.admin.all, queryKeys.dictionary.all]) {
    void client.cancelQueries({ queryKey })
    client.removeQueries({ queryKey })
  }
  client.getMutationCache().clear()
}

/** 仅接受已定义的管理页面，不接受 origin、查询参数或编码后的路径。 */
export function adminReturnPath(value: string | null): string {
  if (value && /^\/admin\/works(?:\/new|\/[A-Za-z0-9_-]+\/(?:edit|preview))?$/.test(value)) return value
  return '/admin/works'
}
