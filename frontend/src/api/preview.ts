import { appConfig } from '../app/env'
import type { ModelFormat } from '../types/work'
import type { ModelSource, ModelViewConfig } from '../viewer/types'
import { apiRequest, isApiError, joinUrl, normalizeError } from './http'

export interface PreviewConfig {
  workId: string
  mode: 'client' | 'remote'
  source: ModelSource | null
  view: ModelViewConfig
  version?: string
}

export interface RemotePreview {
  workId: string
  admin: boolean
  version: string
  format: ModelFormat
}

export interface PreviewSession {
  sessionId: string
  status: 'creating' | 'ready'
  expiresAt: string
  connection: {
    kind: 'webrtc'
    protocolVersion: 1
    offerUrl: string
    iceServers: RTCIceServer[]
  }
}

export const sessionPath = (id: string) => `/preview-sessions/${encodeURIComponent(id)}`

export function createPreviewSession(remote: RemotePreview, view: ModelViewConfig, requestId: string) {
  return apiRequest<PreviewSession>(remote.admin ? '/admin/preview-sessions' : '/preview-sessions', {
    method: 'POST',
    body: { workId: remote.workId, version: remote.version, requestId, view,
      viewport: { width: 1280, height: 720, fps: 30, bitrate: 2_000_000 } },
  })
}

export function endPreviewSession(id: string): Promise<unknown> {
  return fetch(joinUrl(appConfig.apiBaseUrl, sessionPath(id)), {
    method: 'DELETE', credentials: 'include', keepalive: true,
  }).catch(() => undefined)
}

export function shouldFallback(error: unknown): boolean {
  if (!isApiError(error)) return !(error instanceof DOMException && error.name === 'AbortError')
  return error.status === 0 || error.code === 'PREVIEW_BUSY' || error.code === 'RENDERER_OFFLINE'
}

/** SDP 地址由后端提供，但只允许向同源 HTTPS（本地开发允许 HTTP）发送 Cookie。 */
export async function exchangeOffer(url: string, offer: RTCSessionDescriptionInit, signal: AbortSignal) {
  const target = new URL(url, window.location.href)
  if (target.origin !== window.location.origin || target.username || target.password ||
    !['http:', 'https:'].includes(target.protocol) ||
    (target.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname))) {
    throw new Error('远程信令地址必须为同源 HTTPS。')
  }
  const response = await fetch(target.href, {
    method: 'POST', credentials: 'include', signal,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(offer),
  })
  const data = await response.json().catch(() => null)
  if (!response.ok) throw normalizeError(response.status, data)
  if (data?.type !== 'answer' || typeof data.sdp !== 'string') throw new Error('远程 SDP answer 无效。')
  return data as RTCSessionDescriptionInit
}
