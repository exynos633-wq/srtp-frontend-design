import { useEffect } from 'react'
import type { ModelInfo } from '../../../src/viewer/types'
import type { RemotePreview } from '../../../src/api/preview'

/**
 * DOM 单测替身：只验证观看外壳的挂载/卸载与边界，不伪造 WebGL 帧。
 * 真实 Three/Spark 渲染由 Playwright + 实际 Chrome 验证。
 */
export function ModelViewport(props: {
  source: unknown
  remote?: RemotePreview | null
  onRemoteFailure?: (error: unknown) => void
  modelName: string
  onPhase?: (phase: 'read' | 'initialize' | 'ready' | 'error') => void
  onError?: (error: unknown) => void
  onEnd?: () => void
  onZoom?: () => void
  showEnd?: boolean
}) {
  const { source, remote, modelName, onPhase, onError, onEnd, onZoom } = props
  useEffect(() => {
    if (source || remote) onPhase?.('ready')
    else {
      onPhase?.('error')
      onError?.({
        code: 'NO_SOURCE',
        title: '尚未配置模型资源',
        message: '测试替身：没有模型来源。',
        advice: '由宿主提供 URL 或本地 File。',
        retryable: false,
      })
    }
  }, [source, remote, onError, onPhase])

  return (
    <div data-testid="model-viewport-stub" data-remote={remote ? 'true' : 'false'}>
      {remote ? <button onClick={() => props.onRemoteFailure?.(new Error('测试断流'))}>协议桩：断流</button> : null}
      <p>{source ? `真实查看器测试替身 · ${modelName}` : '尚未配置模型资源（测试替身）'}</p>
      {onZoom ? (
        <button type="button" data-action="zoom" aria-label="放大查看" onClick={onZoom}>
          放大查看
        </button>
      ) : null}
      {onEnd ? (
        <button type="button" onClick={onEnd}>
          结束预览
        </button>
      ) : null}
    </div>
  )
}

// 仅用于让测试导入走同一类型检查；不是运行时断言。
export type StubInfo = ModelInfo
