import type { CityRef } from './city'

/** 模型资源类型：GLB、高斯泼溅 PLY 与带面片的网格 PLY 分开命名。 */
export type ModelFormat = 'glb' | 'gaussian-ply' | 'mesh-ply'

export type WorkStatus = 'draft' | 'published' | 'offline'

/**
 * 公开作品。只包含已发布数据：名称、封面、建筑介绍、模型格式均已完整。
 * 不含作者／日期字段，也不含模型下载地址或内部存储路径。
 *
 * 排序由契约保证（发布时间降序、id 稳定排序），前端不再自行加日期展示。
 */
export interface PublicWork {
  id: string
  name: string
  /** 城市选填；未设置时为 null，作品仍进目录与详情。 */
  city: CityRef | null
  coverUrl: string
  modelFormat: ModelFormat
  description: string
  modelingNote: string | null
}

/**
 * 后台作品。草稿的未填业务字段允许为 null；
 * 发布后（status 为 published）这些字段必须完整，由服务端最终校验。
 */
export interface AdminWork {
  id: string
  name: string | null
  /** 写入用编号；读取同时给出 cityId 与 city，便于表单回填。 */
  cityId: string | null
  city: CityRef | null
  coverUrl: string | null
  modelFormat: ModelFormat | null
  description: string | null
  modelingNote: string | null
  status: WorkStatus
  modelAssetId: string | null
  coverAssetId: string | null
  /** ISO 8601，带时区 */
  updatedAt: string
  /** 首次发布时间；草稿为 null */
  publishedAt: string | null
}

/**
 * 写入字段。PATCH 语义：
 * - 省略某字段 = 不修改；
 * - `cityId: null` = 清空城市；非空但无效的城市编号由服务端返回 422。
 */
export interface WorkWriteInput {
  name?: string | null
  cityId?: string | null
  description?: string | null
  modelingNote?: string | null
  modelAssetId?: string | null
  coverAssetId?: string | null
}
