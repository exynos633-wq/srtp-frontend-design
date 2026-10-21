/**
 * TanStack Query 键。集中定义，避免各页面拼字符串导致失效范围不一致。
 *
 * 约定：不把模型对象、相机状态、视频流等运行时对象放进 Query 缓存；
 * 这里只缓存服务端返回的可序列化数据。
 */
export const queryKeys = {
  auth: {
    all: ['auth'] as const,
    me: () => [...queryKeys.auth.all, 'me'] as const,
    failure: () => [...queryKeys.auth.all, 'failure'] as const,
  },
  works: {
    all: ['works'] as const,
    list: () => [...queryKeys.works.all, 'list'] as const,
    detail: (id: string) => [...queryKeys.works.all, 'detail', id] as const,
  },
  globe: {
    all: ['globe'] as const,
    cities: () => [...queryKeys.globe.all, 'cities'] as const,
    cityWorks: (cityId: string) => [...queryKeys.globe.all, 'city', cityId, 'works'] as const,
  },
  dictionary: {
    all: ['dictionary'] as const,
    provinces: () => [...queryKeys.dictionary.all, 'provinces'] as const,
    cities: (provinceId: string) => [...queryKeys.dictionary.all, 'cities', provinceId] as const,
  },
  admin: {
    all: ['admin'] as const,
    works: () => [...queryKeys.admin.all, 'works'] as const,
    work: (id: string) => [...queryKeys.admin.all, 'work', id] as const,
  },
} as const

/**
 * 作品变更后需要失效的范围：公开列表、详情、地球城市与相关城市模型。
 * 具体城市列表用 `invalidateQueries({ queryKey: queryKeys.globe.all })` 一并覆盖。
 */
export function invalidateAfterWorkChange() {
  return [
    queryKeys.works.all,
    queryKeys.globe.all,
    queryKeys.admin.all,
  ] as const
}
