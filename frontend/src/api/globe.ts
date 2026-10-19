import type { ItemList } from '../types/api'
import type { CityRef, GlobeCity } from '../types/city'
import type { PublicWork } from '../types/work'
import { apiRequest } from './http'

export interface CityWorksResponse {
  city: CityRef
  items: PublicWork[]
}

/** 地球城市点位：仅有已发布模型且中心坐标有效的城市。 */
export function listGlobeCities(signal?: AbortSignal): Promise<ItemList<GlobeCity>> {
  return apiRequest<ItemList<GlobeCity>>('/globe/cities', { signal })
}

/** 某一城市当前全部已发布模型；城市不存在返回 404 `CITY_NOT_FOUND`。 */
export function listCityWorks(cityId: string, signal?: AbortSignal): Promise<CityWorksResponse> {
  return apiRequest<CityWorksResponse>(`/globe/cities/${encodeURIComponent(cityId)}/works`, { signal })
}
