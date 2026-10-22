import { getDatabase } from '../mocks/db'
import type { ModelSource } from '../viewer/types'

/**
 * 仅 DEV：从当前内存 Mock 数据库读取作品的真实绑定与版本，再解析到开发服务器
 * 白名单路径。模拟替换资源后 modelAssetId 改变，这里会生成新 URL，旧种子文件
 * 不会被继续命中；未知资源由开发服务器返回 404。
 *
 * 本模块只能通过 `import.meta.env.DEV` 分支动态引入，生产构建不得包含 mockDB。
 */
const DEV_FILE_BY_ASSET: Record<string, string> = {
  asset_demo_001_model: 'ancient_chinese_courtyard_park.glb',
  asset_demo_002_model: 'great_wall_survey.glb',
  asset_demo_003_model: '丘陵.ply',
}

export function resolveDevModelSource(workId: string): ModelSource | null {
  const work = getDatabase().works.find((item) => item.id === workId)
  if (!work || !work.modelAssetId || !work.modelFormat) return null
  const extension = work.modelFormat === 'gaussian-ply' ? 'ply' : 'glb'
  const fileName = DEV_FILE_BY_ASSET[work.modelAssetId] ?? `${work.id}.${extension}`
  return {
    kind: 'url',
    url: `/__dev/models/${encodeURIComponent(work.modelAssetId)}/${encodeURIComponent(fileName)}?v=${encodeURIComponent(work.updatedAt)}`,
    version: `${work.modelAssetId}@${work.updatedAt}`,
    name: work.name ?? workId,
  }
}
