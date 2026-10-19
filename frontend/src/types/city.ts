import type { GeoPoint } from './api'

/** 省级选项（标准字典）。 */
export interface Province {
  id: string
  name: string
}

/** 城市选项（标准字典）。省份筛选不是作品归属，作品只认同一个 cityId。 */
export interface CityOption {
  id: string
  name: string
  provinceId: string
}

/** 作品所属城市（公开数据，名称由字典派生，只读）。 */
export interface CityRef {
  id: string
  name: string
  province: Province
}

/**
 * 地球上的城市点位。只包含“有已发布模型且中心坐标有效”的城市；
 * 中心缺失的城市不会出现在这里，作品仍留在目录中。
 */
export interface GlobeCity {
  id: string
  name: string
  province: Province
  center: GeoPoint
  /** 仅统计已发布模型 */
  workCount: number
}
