import type { ItemList } from '../types/api'
import type { PublicWork } from '../types/work'
import { apiRequest } from './http'

/** 公开目录：仅已发布作品，顺序由服务端保证（发布时间降序、id 稳定排序）。 */
export function listPublicWorks(signal?: AbortSignal): Promise<ItemList<PublicWork>> {
  return apiRequest<ItemList<PublicWork>>('/works', { signal })
}

/** 公开详情：草稿或已下架一律 404，不区分原因。 */
export function getPublicWork(id: string, signal?: AbortSignal): Promise<PublicWork> {
  return apiRequest<PublicWork>(`/works/${encodeURIComponent(id)}`, { signal })
}
