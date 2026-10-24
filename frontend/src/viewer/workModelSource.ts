import { apiRequest } from '../api/http'
import { isMocksActive } from '../app/mocksStatus'
import type { ModelFormat } from '../types/work'
import type { ModelSource } from './types'

/**
 * 作品模型来源适配点。
 *
 * 正式接口（feature/backend-client-rendering）：
 *   GET /api/works/:id/preview-config        公开端，仅已发布
 *   GET /api/admin/works/:id/preview-config  管理端，草稿/下架也可预览
 * 响应 mode='client' 时返回 source.url/version；服务端确保只有 ready 的资源
 * 才会给出 URL。404 NO_MODEL / 网络失败都显示“尚未配置模型资源”，不伪造成功。
 *
 * DEV 且 MSW 实际启用时仍走本地白名单映射，保持既有开发体验；生产构建不会
 * 包含该动态 import。
 */

interface PreviewConfigResponse {
  workId: string
  mode: 'client' | 'remote'
  source?: {
    kind: 'url'
    url: string
    version: string
    name?: string
    format?: ModelFormat
  } | null
}

async function fetchPreviewSource(path: string): Promise<ModelSource | null> {
  try {
    const config = await apiRequest<PreviewConfigResponse>(path)
    const source = config?.source
    if (!config || config.mode !== 'client' || !source?.url) return null
    return {
      kind: 'url',
      url: source.url,
      version: source.version,
      ...(source.name ? { name: source.name } : {}),
    }
  } catch {
    // 404 NO_MODEL、网络失败与非法响应都按“未配置”处理，绝不伪造可播放状态。
    return null
  }
}

/** 公开详情页：仅已发布作品可读；草稿/下架由后端返回 404。 */
export async function resolveWorkModelSource(workId: string): Promise<ModelSource | null> {
  if (import.meta.env.DEV && isMocksActive()) {
    const { resolveDevModelSource } = await import('../dev/resolveDevModelSource')
    return resolveDevModelSource(workId)
  }
  return fetchPreviewSource(`/works/${encodeURIComponent(workId)}/preview-config`)
}

/** 管理端预览：草稿与已下架作品也能取到来源。 */
export async function resolveAdminWorkModelSource(
  workId: string,
): Promise<ModelSource | null> {
  if (import.meta.env.DEV && isMocksActive()) {
    const { resolveDevModelSource } = await import('../dev/resolveDevModelSource')
    return resolveDevModelSource(workId)
  }
  return fetchPreviewSource(`/admin/works/${encodeURIComponent(workId)}/preview-config`)
}
