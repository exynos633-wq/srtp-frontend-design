import { isMocksActive } from '../app/mocksStatus'
import type { ModelSource } from './types'

/**
 * 作品模型来源适配点。生产环境不读取 PublicWork/AdminWork 新字段，也不存在
 * 假 preview-config 后端：宿主若提供来源，应通过 PreviewViewer 的 modelSource
 * prop 或替换本函数注入。未提供时返回 null，查看器显示“尚未配置模型资源”。
 *
 * DEV 下才动态加载 MSW 内存数据库，按当前 workId、modelAssetId/version 解析
 * 开发白名单 URL；生产构建会移除该动态 import 与 mockDB。
 */
export async function resolveWorkModelSource(workId: string): Promise<ModelSource | null> {
  if (!import.meta.env.DEV || !isMocksActive()) return null
  const { resolveDevModelSource } = await import('../dev/resolveDevModelSource')
  return resolveDevModelSource(workId)
}
