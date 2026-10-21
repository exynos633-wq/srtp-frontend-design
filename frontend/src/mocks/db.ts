import type { GeoPoint } from '../types/api'
import type { CityOption, CityRef, Province } from '../types/city'
import type { UploadAssetKind } from '../types/upload'
import type { AdminWork, ModelFormat, WorkStatus } from '../types/work'
import type { SessionUser } from '../api/auth'

/**
 * 开发 Mock 的内存数据源。真实后端不存在，这里的数据仅用于演示与测试：
 * - 三件样例（院落、长城、丘陵）对应仓库里的原始模型，其余为明确占位；
 * - 全部改动只存在内存里，刷新页面即恢复初始数据；
 * - Mock 不是安全方案：登录校验与资源状态都是假的。
 */

export interface MockCity extends CityOption {
  /** 缺失中心坐标的城市不会出现在地球上 */
  center: GeoPoint | null
}

export interface MockWork extends AdminWork {
  /** 仅 Mock 元数据：演示占位作品，不进入公开契约 */
  placeholder: boolean
}

/** 仅开发 Mock 的上传登记；status 由 handler 按 elapsed 推导。 */
export interface MockUploadRecord {
  assetId: string
  /** 仅种子/既有绑定资源直接 ready；新模拟上传必须经过 receiving/validating。 */
  seeded: boolean
  kind: UploadAssetKind
  originalName: string
  sizeBytes: number
  createdAt: number
  outcome: 'ready' | 'failed' | 'hold'
  failureReason: string | null
  modelFormat: ModelFormat | null
}

export interface MockDatabase {
  works: MockWork[]
  /** 模拟服务端资源登记；种子资源与模拟上传共用。 */
  uploads: MockUploadRecord[]
  provinces: Province[]
  cities: MockCity[]
  session: SessionUser | null
  sequence: number
  uploadSequence: number
}

const PROVINCES: Province[] = [
  { id: '110000', name: '北京市' },
  { id: '310000', name: '上海市' },
  { id: '330000', name: '浙江省' },
  { id: '440000', name: '广东省' },
]

const CITIES: MockCity[] = [
  { id: '110100', name: '北京市', provinceId: '110000', center: { longitude: 116.4074, latitude: 39.9042 } },
  { id: '310100', name: '上海市', provinceId: '310000', center: { longitude: 121.4737, latitude: 31.2304 } },
  { id: '330100', name: '杭州市', provinceId: '330000', center: { longitude: 120.1551, latitude: 30.2741 } },
  // 中心坐标缺失：作品仍可发布、仍在目录，但不会出现在地球上。
  { id: '440100', name: '广州市', provinceId: '440000', center: null },
  { id: '440300', name: '深圳市', provinceId: '440000', center: { longitude: 114.0579, latitude: 22.5431 } },
]

interface SeedInput {
  id: string
  name: string
  cityId: string | null
  modelFormat: ModelFormat
  description: string
  modelingNote?: string | null
  status?: WorkStatus
  placeholder?: boolean
  publishedAt?: string | null
  updatedAt: string
  modelAssetId?: string | null
  coverAssetId?: string | null
}

const PLACEHOLDER_COVER = '/mock/placeholder-cover.svg'

function toCityRef(cityId: string | null): CityRef | null {
  if (cityId === null) return null
  const city = CITIES.find((item) => item.id === cityId)
  if (!city) return null
  const province = PROVINCES.find((item) => item.id === city.provinceId)
  if (!province) return null
  return { id: city.id, name: city.name, province }
}

function createWork(input: SeedInput): MockWork {
  const status = input.status ?? 'published'
  const complete = status === 'published'
  return {
    id: input.id,
    name: input.name,
    cityId: input.cityId,
    city: toCityRef(input.cityId),
    coverUrl: complete ? PLACEHOLDER_COVER : null,
    modelFormat: complete ? input.modelFormat : null,
    description: input.description,
    modelingNote: input.modelingNote ?? null,
    status,
    modelAssetId: input.modelAssetId === undefined ? (complete ? null : null) : input.modelAssetId,
    coverAssetId: input.coverAssetId === undefined ? null : input.coverAssetId,
    updatedAt: input.updatedAt,
    publishedAt: status === 'published' ? (input.publishedAt ?? input.updatedAt) : null,
    placeholder: input.placeholder ?? false,
  }
}

function createSeedWorks(): MockWork[] {
  const publishedAt = (day: number) =>
    `2026-10-${String(day).padStart(2, '0')}T10:00:00+08:00`

  const works: MockWork[] = [
    createWork({
      id: 'work_demo_001',
      name: '院落模型',
      cityId: '110100',
      modelFormat: 'glb',
      description: '传统院落建筑模型，用于展示空间布局与建筑形态。',
      updatedAt: publishedAt(18),
      modelAssetId: 'asset_demo_001_model',
      coverAssetId: 'asset_demo_001_cover',
    }),
    createWork({
      id: 'work_demo_002',
      name: '长城模型',
      cityId: '110100',
      modelFormat: 'glb',
      description: '长城段落模型，用于检查较大体量模型的观看表现。',
      modelingNote: '占位：建模说明待补充。',
      updatedAt: publishedAt(17),
      modelAssetId: 'asset_demo_002_model',
      coverAssetId: 'asset_demo_002_cover',
    }),
    createWork({
      id: 'work_demo_003',
      name: '丘陵模型',
      cityId: null,
      modelFormat: 'gaussian-ply',
      description: '高斯泼溅丘陵模型；未设置城市，只出现在目录与详情。',
      modelingNote: '占位：高斯模型说明待补充。',
      updatedAt: publishedAt(16),
      modelAssetId: 'asset_demo_003_model',
      coverAssetId: 'asset_demo_003_cover',
    }),
  ]

  const placeholders: Array<{ id: string; name: string; cityId: string | null; format: ModelFormat }> = [
    { id: 'work_placeholder_004', name: '模型占位 04', cityId: '310100', format: 'glb' },
    { id: 'work_placeholder_005', name: '模型占位 05', cityId: '310100', format: 'glb' },
    { id: 'work_placeholder_006', name: '模型占位 06', cityId: '330100', format: 'glb' },
    { id: 'work_placeholder_007', name: '模型占位 07', cityId: '440100', format: 'glb' },
    { id: 'work_placeholder_008', name: '模型占位 08', cityId: null, format: 'gaussian-ply' },
    { id: 'work_placeholder_009', name: '模型占位 09', cityId: '440300', format: 'glb' },
    { id: 'work_placeholder_010', name: '模型占位 10', cityId: '110100', format: 'glb' },
  ]

  placeholders.forEach((item, index) => {
    const day = 15 - index
    works.push(
      createWork({
        id: item.id,
        name: item.name,
        cityId: item.cityId,
        modelFormat: item.format,
        description: `占位内容：\n第 ${index + 4} 件演示作品的建筑介绍待补充。`,
        updatedAt: publishedAt(day),
        modelAssetId: `asset_${item.id}_model`,
        coverAssetId: `asset_${item.id}_cover`,
        placeholder: true,
      }),
    )
  })

  return works
}

function createSeedFixtures(): MockWork[] {
  return [
    createWork({
      id: 'work_draft_001',
      name: '未命名草稿',
      cityId: null,
      modelFormat: 'glb',
      description: '',
      status: 'draft',
      updatedAt: '2026-10-19T09:00:00+08:00',
      placeholder: true,
    }),
    createWork({
      id: 'work_draft_002',
      name: '待补资源的草稿',
      cityId: '310100',
      modelFormat: 'glb',
      description: '用于演示发布校验失败：缺少封面与模型资源。',
      status: 'draft',
      updatedAt: '2026-10-19T09:10:00+08:00',
      placeholder: true,
    }),
    createWork({
      id: 'work_offline_001',
      name: '已下架占位',
      cityId: '110100',
      modelFormat: 'glb',
      description: '已下架作品，公开接口不可见，仅后台可读。',
      status: 'offline',
      updatedAt: '2026-10-08T10:00:00+08:00',
      modelAssetId: 'asset_offline_001_model',
      coverAssetId: 'asset_offline_001_cover',
      placeholder: true,
    }),
  ]
}

/** 已有作品引用的资源也是 Mock 登记的一部分；绑定校验不能接受未知编号。 */
function createSeedUploads(works: MockWork[]): MockUploadRecord[] {
  const uploads = new Map<string, MockUploadRecord>()

  for (const work of works) {
    if (work.modelAssetId) {
      const format = work.modelFormat ?? 'glb'
      uploads.set(work.modelAssetId, {
        assetId: work.modelAssetId,
        seeded: true,
        kind: 'model',
        originalName: `${work.id}.${format === 'gaussian-ply' ? 'ply' : 'glb'}`,
        sizeBytes: 0,
        createdAt: 0,
        outcome: 'ready',
        failureReason: null,
        modelFormat: format,
      })
    }
    if (work.coverAssetId) {
      uploads.set(work.coverAssetId, {
        assetId: work.coverAssetId,
        seeded: true,
        kind: 'cover',
        originalName: `${work.id}-cover.svg`,
        sizeBytes: 0,
        createdAt: 0,
        outcome: 'ready',
        failureReason: null,
        modelFormat: null,
      })
    }
  }

  return [...uploads.values()]
}

export function createSeedDatabase(): MockDatabase {
  const works = [...createSeedWorks(), ...createSeedFixtures()]
  return {
    works,
    uploads: createSeedUploads(works),
    provinces: PROVINCES.map((item) => ({ ...item })),
    cities: CITIES.map((item) => ({ ...item })),
    session: null,
    sequence: 0,
    uploadSequence: 0,
  }
}

let database = createSeedDatabase()

export function getDatabase(): MockDatabase {
  return database
}

/** 测试与演示的复位入口：清空会话、场景与所有内存改动。 */
export function resetDatabase(): void {
  database = createSeedDatabase()
}

/** 递增的假时间，保证同一测试内的更新顺序可复现。 */
export function nextTimestamp(): string {
  database.sequence += 1
  const base = Date.parse('2026-10-19T10:00:00+08:00')
  return new Date(base + database.sequence * 1000).toISOString()
}

export function nextWorkId(): string {
  database.sequence += 1
  return `work_mock_${String(database.sequence).padStart(3, '0')}`
}

export function nextUploadId(kind: UploadAssetKind): string {
  database.uploadSequence += 1
  return `asset_mock_upload_${kind}_${String(database.uploadSequence).padStart(3, '0')}`
}
