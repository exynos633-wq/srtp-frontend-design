import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { getMockUpload, startMockUpload } from '../api/mockUploads'
import { getUploadAsset, uploadAsset, validateUploadFile } from '../api/uploads'
import { handleAdminAuthFailure } from '../api/adminSession'
import { ApiError } from '../api/http'
import { queryKeys } from '../api/queryKeys'
import { isMocksActive } from '../app/mocksStatus'
import { isUploadSimulationEnabled } from '../api/mockUploads'
import type {
  UploadAsset,
  UploadAssetKind,
  UploadAssetStatus,
  UploadSimulationAsset,
} from '../types/upload'
import type { ModelFormat } from '../types/work'

/**
 * 单个模型或封面的上传状态。
 *
 * 开发环境且 MSW 已实际启用时走原有 metadata 模拟；其他情况走正式
 * POST /admin/assets multipart 接口。requestId 隔离取消/重选/切作品，
 * 服务端决定最终 ready/failed 与 modelFormat。
 */
export type UploadSelectionStatus = UploadAssetStatus
export type UploadMode = 'simulated' | 'live'

export interface UploadSelection {
  requestId: number
  file: File
  status: UploadSelectionStatus
  assetId: string | null
  /** 真实上传字节进度；模拟模式是明确标注的模拟值。 */
  progress: number
  /** 兼容旧字段名；值与 progress 同源。 */
  simulatedProgress: number
  error: string
  modelFormat: ModelFormat | null
}

export interface UseAssetUploadResult {
  mode: UploadMode
  selection: UploadSelection | null
  /** 仅封面：本地预览对象 URL；模型永远为 null。 */
  objectUrl: string | null
  wasCanceled: boolean
  hasUnsettled: boolean
  readyAssetId: string | undefined
  selectFile: (file: File) => void
  retry: () => void
  cancel: () => void
  clearAfterSave: () => void
}

/** 旧名字保留给已有测试与调用点，行为已覆盖正式上传。 */
export type MockUploadSelectionStatus = UploadSelectionStatus
export type MockUploadSelection = UploadSelection
export type UseMockUploadResult = UseAssetUploadResult

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      signal.removeEventListener('abort', handleAbort)
      resolve()
    }, ms)
    const handleAbort = () => {
      window.clearTimeout(timer)
      signal.removeEventListener('abort', handleAbort)
      reject(new DOMException('Aborted', 'AbortError'))
    }
    if (signal.aborted) {
      handleAbort()
      return
    }
    signal.addEventListener('abort', handleAbort, { once: true })
  })
}

function createCoverObjectUrl(file: File): string | null {
  if (typeof URL.createObjectURL !== 'function') return null
  return URL.createObjectURL(file)
}

function revokeCoverObjectUrl(url: string | null): void {
  if (url && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(url)
}

function progressFromAsset(
  current: UploadSelection,
  asset: UploadSimulationAsset | UploadAsset,
): number {
  if ('simulatedProgress' in asset && asset.simulatedProgress !== null) {
    return asset.simulatedProgress
  }
  return asset.status === 'ready' ? 100 : current.progress
}

function selectionFromAsset(
  current: UploadSelection,
  asset: UploadSimulationAsset | UploadAsset,
): UploadSelection {
  const progress = progressFromAsset(current, asset)
  return {
    ...current,
    status: asset.status,
    assetId: asset.assetId,
    progress,
    simulatedProgress: progress,
    error: asset.error ?? '',
    modelFormat: asset.modelFormat ?? null,
  }
}

export function useAssetUpload(kind: UploadAssetKind): UseAssetUploadResult {
  const simulated = isUploadSimulationEnabled(import.meta.env.DEV, isMocksActive())
  const client = useQueryClient()
  const [selection, setSelection] = useState<UploadSelection | null>(null)
  const [objectUrl, setObjectUrl] = useState<string | null>(null)
  const [wasCanceled, setWasCanceled] = useState(false)

  const mountedRef = useRef(true)
  const activeRequestRef = useRef(0)
  const requestSeqRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)
  const objectUrlRef = useRef<string | null>(null)

  const revokeObjectUrl = useCallback(() => {
    const url = objectUrlRef.current
    objectUrlRef.current = null
    setObjectUrl(null)
    revokeCoverObjectUrl(url)
  }, [])

  const runUpload = useCallback(
    async (requestId: number, file: File, signal: AbortSignal) => {
      const isActive = () =>
        mountedRef.current &&
        activeRequestRef.current === requestId &&
        client.getQueryData(queryKeys.auth.me()) != null
      const apply = (asset: UploadSimulationAsset | UploadAsset) => {
        if (!isActive()) return
        setSelection((current) =>
          current && current.requestId === requestId
            ? selectionFromAsset(current, asset)
            : current,
        )
      }
      const setProgress = (percent: number) => {
        if (!isActive()) return
        setSelection((current) =>
          current && current.requestId === requestId
            ? {
                ...current,
                progress: percent,
                simulatedProgress: percent,
              }
            : current,
        )
      }

      try {
        let asset: UploadAsset
        if (simulated) {
          asset = await startMockUpload(
            {
              kind,
              originalName: file.name,
              sizeBytes: file.size,
              mimeType: file.type,
            },
            { signal },
          )
          apply(asset)
        } else {
          asset = await uploadAsset(file, kind, { signal, onProgress: setProgress })
          apply(asset)
        }

        while (asset.status === 'receiving' || asset.status === 'validating') {
          await sleep(asset.status === 'receiving' ? 140 : 180, signal)
          if (!isActive()) return
          asset = simulated
            ? await getMockUpload(asset.assetId, { signal })
            : await getUploadAsset(asset.assetId, signal)
          apply(asset)
        }
      } catch (error) {
        if (signal.aborted) return
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
          activeRequestRef.current += 1
          abortRef.current?.abort()
          abortRef.current = null
          revokeObjectUrl()
          setSelection(null)
          setWasCanceled(false)
          handleAdminAuthFailure(client, error)
          return
        }
        if (!isActive()) return
        const message =
          error instanceof Error && error.message
            ? error.message
            : simulated
              ? '模拟上传失败，请重试。'
              : '上传失败，请重试。'
        setSelection((current) =>
          current && current.requestId === requestId
            ? { ...current, status: 'failed', error: message }
            : current,
        )
      }
    },
    [client, kind, revokeObjectUrl, simulated],
  )

  const beginUpload = useCallback(
    (file: File, keepObjectUrl: boolean) => {
      requestSeqRef.current += 1
      const requestId = requestSeqRef.current
      activeRequestRef.current = requestId
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      if (!keepObjectUrl) {
        revokeObjectUrl()
        if (kind === 'cover') {
          const url = createCoverObjectUrl(file)
          objectUrlRef.current = url
          setObjectUrl(url)
        }
      }

      setWasCanceled(false)
      const invalid = validateUploadFile(file, kind)
      if (invalid) {
        setSelection({
          requestId,
          file,
          status: 'failed',
          assetId: null,
          progress: 0,
          simulatedProgress: 0,
          error: invalid,
          modelFormat: null,
        })
        return
      }

      setSelection({
        requestId,
        file,
        status: 'receiving',
        assetId: null,
        progress: 0,
        simulatedProgress: 0,
        error: '',
        modelFormat: null,
      })
      void runUpload(requestId, file, controller.signal)
    },
    [kind, revokeObjectUrl, runUpload],
  )

  const selectFile = useCallback(
    (file: File) => {
      beginUpload(file, false)
    },
    [beginUpload],
  )

  const retry = useCallback(() => {
    if (!selection || selection.status !== 'failed') return
    beginUpload(selection.file, true)
  }, [beginUpload, selection])

  const clear = useCallback(
    (canceled: boolean) => {
      activeRequestRef.current += 1
      abortRef.current?.abort()
      abortRef.current = null
      revokeObjectUrl()
      setSelection(null)
      setWasCanceled(canceled)
    },
    [revokeObjectUrl],
  )

  const cancel = useCallback(() => clear(true), [clear])
  const clearAfterSave = useCallback(() => clear(false), [clear])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      activeRequestRef.current += 1
      abortRef.current?.abort()
      abortRef.current = null
      const url = objectUrlRef.current
      objectUrlRef.current = null
      revokeCoverObjectUrl(url)
    }
  }, [])

  const hasUnsettled = selection !== null && selection.status !== 'ready'
  const readyAssetId =
    selection?.status === 'ready' && selection.assetId ? selection.assetId : undefined

  return {
    mode: simulated ? 'simulated' : 'live',
    selection,
    objectUrl,
    wasCanceled,
    hasUnsettled,
    readyAssetId,
    selectFile,
    retry,
    cancel,
    clearAfterSave,
  }
}

/** 兼容旧调用名；实际按环境选择模拟或正式上传。 */
export function useMockUpload(kind: UploadAssetKind): UseAssetUploadResult {
  return useAssetUpload(kind)
}
