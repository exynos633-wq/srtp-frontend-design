import { isMocksActive } from '../app/mocksStatus'
import { apiRequest } from './http'
import type {
  UploadSimulationAsset,
  UploadSimulationInput,
} from '../types/upload'

/**
 * P12 开发演示用的上传模拟客户端。
 *
 * 这里没有正式上传协议：只把文件名、大小、MIME 等 metadata 发给 localhost 的
 * MSW handler，不读取或传输文件内容。生产构建中模拟入口必须关闭，且不会在
 * 真实请求失败后回退到 Mock。
 */

export class UploadSimulationUnavailableError extends Error {
  constructor() {
    super('当前环境未启用开发上传模拟。')
    this.name = 'UploadSimulationUnavailableError'
  }
}

/** 页面与客户端统一：必须同时是开发构建且 MSW 已实际启用。 */
export function isUploadSimulationEnabled(dev: boolean, mocksActive: boolean): boolean {
  return dev && mocksActive
}

interface SimulationOptions {
  signal?: AbortSignal
}

function assertSimulationAllowed(): void {
  if (!isUploadSimulationEnabled(import.meta.env.DEV, isMocksActive())) {
    throw new UploadSimulationUnavailableError()
  }
}

export function startMockUpload(
  input: UploadSimulationInput,
  options: SimulationOptions = {},
): Promise<UploadSimulationAsset> {
  try {
    assertSimulationAllowed()
  } catch (error) {
    return Promise.reject(error)
  }
  return apiRequest<UploadSimulationAsset>('/dev/mock/uploads', {
    method: 'POST',
    body: input,
    signal: options.signal,
  })
}

export function getMockUpload(
  assetId: string,
  options: SimulationOptions = {},
): Promise<UploadSimulationAsset> {
  try {
    assertSimulationAllowed()
  } catch (error) {
    return Promise.reject(error)
  }
  return apiRequest<UploadSimulationAsset>(
    `/dev/mock/uploads/${encodeURIComponent(assetId)}`,
    { signal: options.signal },
  )
}
