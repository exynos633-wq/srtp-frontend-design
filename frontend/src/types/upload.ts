/**
 * 上传结果（02 草案第 4 节已定义的结果形状）。
 *
 * 注意：**传输端点尚未定稿**。直接上传、签名直传还是分片上传、大小上限、重试／续传、
 * 取消与完整性检查都要等后端确认，本仓库不把任何传输协议当成既定接口。
 * `UploadSimulationAsset` 仅描述开发 MSW 模拟返回，不是正式接口。
 */

import type { ModelFormat } from './work'

export type UploadAssetKind = 'model' | 'cover'

/**
 * receiving / validating 是阶段，不保证有真实字节进度；
 * 只有 ready 的资源可以用于发布；failed 需重新上传。
 */
export type UploadAssetStatus = 'receiving' | 'validating' | 'ready' | 'failed'

export interface UploadAsset {
  assetId: string
  kind: UploadAssetKind
  originalName: string
  sizeBytes: number
  status: UploadAssetStatus
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
  /** 模型资源的模拟格式；封面为 null。 */
  modelFormat: ModelFormat | null
  /** failed 时的模拟原因。 */
  error: string | null
}
