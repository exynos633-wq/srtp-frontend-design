/**
 * 正式资源上传契约（与 feature/backend-client-rendering 一致）。
 *
 * POST /api/admin/assets?kind=model|cover 返回 UploadAsset；模型/封面文件以
 * multipart/form-data 传送。receiving / validating 是服务端阶段，只有 ready
 * 的资源可以绑定到作品；failed 会带可读 error。
 */

import type { ModelFormat } from './work'

export type UploadAssetKind = 'model' | 'cover'

export type UploadAssetStatus = 'receiving' | 'validating' | 'ready' | 'failed'

export interface UploadAsset {
  assetId: string
  kind: UploadAssetKind
  originalName: string
  sizeBytes: number
  status: UploadAssetStatus
  modelFormat: ModelFormat | null
  error: string | null
}

/** 仅开发 Mock 接收的元数据；不包含文件内容，也不代表正式上传请求。 */
export interface UploadSimulationInput {
  kind: UploadAssetKind
  originalName: string
  sizeBytes: number
  mimeType: string
}

/** 仅开发 Mock 的返回。`simulatedProgress` 明确是模拟值。 */
export interface UploadSimulationAsset extends UploadAsset {
  /** receiving 阶段的假进度；其他阶段为 null。 */
  simulatedProgress: number | null
}
