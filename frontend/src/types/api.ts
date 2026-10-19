/**
 * 通用响应类型。接口仍为草案（工程设计/02 v0.2），此处只固化前端需要的形状。
 */

/** 统一错误响应体：`{ error: { code, message, fields? } }` */
export interface ApiErrorBody {
  error: {
    code: string
    message: string
    /** 仅字段校验失败时提供，键为字段名 */
    fields?: Record<string, string>
  }
}

/** 列表响应：`{ items: [] }`，首期一次返回全部，不分页。 */
export interface ItemList<T> {
  items: T[]
}

/** 城市字典与地球共用的坐标，单位为度（WGS84 为待后端确认的提案）。 */
export interface GeoPoint {
  longitude: number
  latitude: number
}
