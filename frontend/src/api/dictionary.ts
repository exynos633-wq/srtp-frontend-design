import type { ItemList } from '../types/api'
import type { CityOption, Province } from '../types/city'
import { apiRequest } from './http'

/**
 * 标准省市字典（管理员会话）。字典失败时保留已选 cityId，不静默清空。
 * 省级筛选不是作品归属，只用于缩小城市选项。
 */
export function listProvinces(signal?: AbortSignal): Promise<ItemList<Province>> {
  return apiRequest<ItemList<Province>>('/admin/provinces', { signal })
}

export function listCities(provinceId: string, signal?: AbortSignal): Promise<ItemList<CityOption>> {
  return apiRequest<ItemList<CityOption>>(
    `/admin/cities?provinceId=${encodeURIComponent(provinceId)}`,
    { signal },
  )
}
