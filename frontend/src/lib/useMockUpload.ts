import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { getMockUpload, startMockUpload } from '../api/mockUploads'
import { handleAdminAuthFailure } from '../api/adminSession'
import { ApiError } from '../api/http'
import { queryKeys } from '../api/queryKeys'
import type {
  UploadAssetKind,
  UploadAssetStatus,
  UploadSimulationAsset,
} from '../types/upload'
import type { ModelFormat } from '../types/work'

/**
 * 单个模型或封面的开发模拟上传状态。
 *
 * 只使用 metadata 与 Mock 返回的 assetId；requestId 负责隔离取消/重选/切作品，
 * 服务端登记负责最终 ready 与 kind 判定。模型文件内容不会被读取。
 */
export type MockUploadSelectionStatus = UploadAssetStatus

export interface MockUploadSelection {
  requestId: number
  file: File
  status: MockUploadSelectionStatus
  assetId: string | null
  simulatedProgress: number
  error: string
  modelFormat: ModelFormat | null
}

export interface UseMockUploadResult {
  selection: MockUploadSelection | null
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

function selectionFromAsset(
  current: MockUploadSelection,
  asset: UploadSimulationAsset,
): MockUploadSelection {
  return {
    ...current,
    status: asset.status,
    assetId: asset.assetId,
    simulatedProgress: asset.simulatedProgress ?? 0,
    error: asset.error ?? '',
    modelFormat: asset.modelFormat,
  }
}

export function useMockUpload(kind: UploadAssetKind): UseMockUploadResult {
  const client = useQueryClient()
  const [selection, setSelection] = useState<MockUploadSelection | null>(null)
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
      const apply = (asset: UploadSimulationAsset) => {
        if (!isActive()) return
        setSelection((current) =>
          current && current.requestId === requestId
            ? selectionFromAsset(current, asset)
            : current,
        )
      }

      try {
        let asset = await startMockUpload(
          {
            kind,
            originalName: file.name,
            sizeBytes: file.size,
            mimeType: file.type,
          },
          { signal },
        )
        apply(asset)

        while (asset.status === 'receiving' || asset.status === 'validating') {
          await sleep(asset.status === 'receiving' ? 140 : 180, signal)
          if (!isActive()) return
          asset = await getMockUpload(asset.assetId, { signal })
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
          error instanceof ApiError ? error.message : '模拟上传失败，请重试。'
        setSelection((current) =>
          current && current.requestId === requestId
            ? { ...current, status: 'failed', error: message }
            : current,
        )
      }
    },
    [client, kind, revokeObjectUrl],
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
      setSelection({
        requestId,
        file,
        status: 'receiving',
        assetId: null,
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
