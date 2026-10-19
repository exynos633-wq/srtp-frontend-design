/**
 * 上传结果（02 草案第 4 节已定义的结果形状）。
 *
 * 注意：**传输端点尚未定稿**。直接上传、签名直传还是分片上传、大小上限、重试／续传、
 * 取消与完整性检查都要等后端确认，本仓库不把任何传输协议当成既定接口。
 * 目前只固化“上传结果”该长什么样，供 P12 的表单与状态使用。
 */

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
