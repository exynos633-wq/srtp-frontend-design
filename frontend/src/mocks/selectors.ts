import type { GlobeCity } from '../types/city'
import type { AdminWork, PublicWork } from '../types/work'
import { getDatabase, type MockDatabase, type MockWork } from './db'

/**
 * 从同一份内存数据派生公开列表、城市聚合与后台数据。
 * 这里是 Mock 的“服务端”：排序、发布过滤与城市聚合都只在这一处发生，
 * 页面上不再做二次业务判断。
 */

function comparePublished(
  a: { publishedAt: string | null; id: string },
  b: { publishedAt: string | null; id: string },
): number {
  const left = a.publishedAt ?? ''
  const right = b.publishedAt ?? ''
  if (left !== right) return left < right ? 1 : -1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/** 契约要求的排序：发布时间降序，同一时间按 id 稳定升序。 */
export function sortByPublishedDesc<T extends { publishedAt: string | null; id: string }>(items: T[]): T[] {
  return [...items].sort(comparePublished)
}

/** 已发布且必填字段完整的作品才进入公开契约；缺字段视为不可公开。 */
export function toPublicWork(work: MockWork): PublicWork | null {
  if (work.status !== 'published') return null
  const { name, description, coverUrl, modelFormat } = work
  if (typeof name !== 'string' || name.trim() === '') return null
  if (typeof description !== 'string' || description.trim() === '') return null
  if (typeof coverUrl !== 'string' || coverUrl === '') return null
  if (modelFormat === null) return null
  return {
    id: work.id,
    name,
    city: work.city,
    coverUrl,
    modelFormat,
    description,
    modelingNote: work.modelingNote,
  }
}

export function listPublishedWorks(db: MockDatabase = getDatabase()): PublicWork[] {
  const published = db.works.filter((work) => work.status === 'published')
  return sortByPublishedDesc(published)
    .map(toPublicWork)
    .filter((work): work is PublicWork => work !== null)
}

export function findPublicWork(id: string, db: MockDatabase = getDatabase()): PublicWork | null {
  const work = db.works.find((item) => item.id === id)
  return work ? toPublicWork(work) : null
}

/**
 * 地球聚合：只统计“已发布且城市中心坐标有效”的城市。
 * 中心缺失的城市不伪造坐标，其作品仍留在目录与详情。
 */
export function listGlobeCities(db: MockDatabase = getDatabase()): GlobeCity[] {
  const published = db.works.filter((work) => toPublicWork(work) !== null)
  return db.cities
    .filter((city) => city.center !== null)
    .map((city) => {
      const works = published.filter((work) => work.cityId === city.id)
      const province = db.provinces.find((item) => item.id === city.provinceId)
      if (works.length === 0 || !province || !city.center) return null
      return {
        id: city.id,
        name: city.name,
        province,
        center: city.center,
        workCount: works.length,
      } satisfies GlobeCity
    })
    .filter((city): city is GlobeCity => city !== null)
    .sort((a, b) => (a.id < b.id ? -1 : 1))
}

/**
 * 城市气泡内容。城市不存在返回 null（对应 404），
 * 城市存在但没有已发布作品返回空列表。
 */
export function listCityWorks(cityId: string, db: MockDatabase = getDatabase()): PublicWork[] | null {
  const city = db.cities.find((item) => item.id === cityId)
  if (!city) return null
  return listPublishedWorks(db).filter((work) => work.city?.id === cityId)
}

/** 后台读取保留草稿与下架；Mock 专属的 placeholder 标记不外泄。 */
export function toAdminWork(work: MockWork): AdminWork {
  return {
    id: work.id,
    name: work.name,
    cityId: work.cityId,
    city: work.city,
    coverUrl: work.coverUrl,
    modelFormat: work.modelFormat,
    description: work.description,
    modelingNote: work.modelingNote,
    status: work.status,
    modelAssetId: work.modelAssetId,
    coverAssetId: work.coverAssetId,
    updatedAt: work.updatedAt,
    publishedAt: work.publishedAt,
  }
}

export function listAdminWorks(db: MockDatabase = getDatabase()): AdminWork[] {
  return [...db.works]
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
    .map(toAdminWork)
}

export function findAdminWork(id: string, db: MockDatabase = getDatabase()): AdminWork | null {
  const work = db.works.find((item) => item.id === id)
  return work ? toAdminWork(work) : null
}
