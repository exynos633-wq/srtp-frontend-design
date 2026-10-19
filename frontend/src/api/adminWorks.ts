import type { ItemList } from '../types/api'
import type { AdminWork, WorkWriteInput } from '../types/work'
import { apiRequest } from './http'

/**
 * 后台作品接口。全部路径由服务端校验管理员会话；
 * 前端按钮禁用只是体验，不构成权限。
 */
export function listAdminWorks(signal?: AbortSignal): Promise<ItemList<AdminWork>> {
  return apiRequest<ItemList<AdminWork>>('/admin/works', { signal })
}

export function getAdminWork(id: string, signal?: AbortSignal): Promise<AdminWork> {
  return apiRequest<AdminWork>(`/admin/works/${encodeURIComponent(id)}`, { signal })
}

/** 新建草稿；保存草稿不会自动发布。 */
export function createAdminWork(input: WorkWriteInput): Promise<AdminWork> {
  return apiRequest<AdminWork>('/admin/works', { method: 'POST', body: input })
}

/**
 * 局部更新。`cityId` 省略 = 不修改，`null` = 清空；不要用 `undefined` 传字段。
 * 已发布作品保存后仍是已发布，但服务端会重新执行发布条件校验。
 */
export function updateAdminWork(id: string, input: WorkWriteInput): Promise<AdminWork> {
  return apiRequest<AdminWork>(`/admin/works/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: input,
  })
}

/** 发布：服务端做最终校验，缺字段返回 422 与 fields。 */
export function publishAdminWork(id: string): Promise<AdminWork> {
  return apiRequest<AdminWork>(`/admin/works/${encodeURIComponent(id)}/publish`, {
    method: 'POST',
    body: {},
  })
}

/** 下架：已发布作品变为 offline，公开端立即不可见。 */
export function unpublishAdminWork(id: string): Promise<AdminWork> {
  return apiRequest<AdminWork>(`/admin/works/${encodeURIComponent(id)}/unpublish`, {
    method: 'POST',
    body: {},
  })
}
