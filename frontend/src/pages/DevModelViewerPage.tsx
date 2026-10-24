import { useEffect, useMemo, useRef, useState } from 'react'
import { ModelViewport } from '../components/viewer/ModelViewport'
import { Button } from '../components/ui/Button'
import { downloadBlob, timestampForFilename } from '../viewer/viewerMath'
import type { ModelSource, ModelViewConfig, ViewerPhase } from '../viewer/types'
import styles from './DevModelViewerPage.module.css'

/**
 * 仅开发构建存在的独立测试页。文件只经 File API 读入本地内存：
 * 不调用上传接口、不写入 Query 缓存、不请求任何外部模型资源。
 */
export default function DevModelViewerPage() {
  const [file, setFile] = useState<File | null>(null)
  const [dprCap, setDprCap] = useState(1.5)
  const [phase, setPhase] = useState<ViewerPhase>('idle')
  const [ready, setReady] = useState(false)
  const [debugText, setDebugText] = useState('等待选择本地模型…')
  const inputRef = useRef<HTMLInputElement>(null)

  const source = useMemo<ModelSource | null>(
    () => (file ? { kind: 'file', file, version: `${file.name}:${file.size}:${file.lastModified}` } : null),
    [file],
  )
  const config = useMemo<ModelViewConfig>(() => ({}), [])

  useEffect(() => {
    const timer = window.setInterval(() => {
      const viewer = (window as unknown as { __srtpModelViewer?: { getDebugState: () => unknown } })
        .__srtpModelViewer
      if (!viewer) return
      const state = viewer.getDebugState() as {
        stats?: { fps?: number; p95Ms?: number } | null
        phase?: string
      }
      setDebugText(
        JSON.stringify(
          {
            phase: state.phase,
            fps: state.stats?.fps ?? null,
            p95Ms: state.stats?.p95Ms ?? null,
            state,
          },
          null,
          2,
        ),
      )
    }, 1000)
    return () => window.clearInterval(timer)
  }, [])

  function chooseFile(next: File | null) {
    if (!next) return
    setFile(next)
    setReady(false)
  }

  function exportMetrics() {
    const viewer = (window as unknown as { __srtpModelViewer?: { getDebugState: () => unknown } })
      .__srtpModelViewer
    const payload = {
      generatedAt: new Date().toISOString(),
      userAgent: navigator.userAgent,
      devicePixelRatio: window.devicePixelRatio,
      selectedFile: file ? { name: file.name, size: file.size, lastModified: file.lastModified } : null,
      dprCap,
      viewer: viewer?.getDebugState() ?? null,
    }
    downloadBlob(
      new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
      `model-viewer-metrics-${timestampForFilename()}.json`,
    )
  }

  return (
    <main className={styles.page} data-dev-model-viewer>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>DEV ONLY · /dev/model-viewer</p>
          <h1 className={styles.title}>客户端模型查看器测试台</h1>
          <p className={styles.description}>
            本地选择或替换 GLB / 网格 PLY / 3DGS PLY 后立即加载。File 只在本页内存中读取，不上传、不缓存、不请求外部资源；
            生产构建不包含本页与本地模型映射。
          </p>
        </div>
        <div className={styles.headerActions}>
          <Button onClick={() => inputRef.current?.click()}>选择本地模型</Button>
          <Button onClick={exportMetrics} disabled={!ready}>
            导出指标 JSON
          </Button>
        </div>
      </header>

      <div className={styles.controls}>
        <input
          ref={inputRef}
          className={styles.fileInput}
          type="file"
          accept=".glb,.ply,model/gltf-binary,application/octet-stream"
          aria-label="选择本地模型文件"
          onChange={(event) => chooseFile(event.target.files?.[0] ?? null)}
        />
        <label className={styles.field}>
          DPR 上限
          <select
            value={dprCap}
            onChange={(event) => {
              setDprCap(Number(event.target.value))
            }}
          >
            <option value={1.5}>1.5（首轮默认）</option>
            <option value={1}>1.0（低档）</option>
            <option value={2}>2.0（仅对照）</option>
          </select>
        </label>
        <span className={styles.badge} data-phase={phase}>
          {ready ? '就绪' : phase}
        </span>
        {file ? (
          <Button
            onClick={() => {
              setFile(null)
              setReady(false)
              setPhase('idle')
              if (inputRef.current) inputRef.current.value = ''
            }}
          >
            清空文件
          </Button>
        ) : null}
      </div>

      <div className={styles.layout}>
        <section className={styles.viewerShell} aria-label="本地模型测试画布">
          {source ? (
            <ModelViewport
              source={source}
              modelName={file?.name ?? '本地模型'}
              viewConfig={config}
              dprCap={dprCap}
              showEnd={false}
              onPhase={setPhase}
              onReady={() => setReady(true)}
              onError={() => setReady(false)}
            />
          ) : (
            <div className={styles.empty}>
              <p className={styles.emptyTitle}>尚未选择本地模型</p>
              <p className={styles.emptyText}>支持 .glb、网格 .ply 与标准 3DGS .ply；格式按文件头识别，不只信后缀。</p>
              <Button variant="primary" onClick={() => inputRef.current?.click()}>
                选择本地模型
              </Button>
            </div>
          )}
        </section>

        <aside className={styles.debug} aria-label="调试指标">
          <h2 className={styles.debugTitle}>调试指标</h2>
          <p className={styles.debugHint}>
            仅开发构建暴露 viewer 调试状态；导出的 JSON 可交给验收记录，不进入 Query 缓存或生产包。
          </p>
          <pre className={styles.debugPre}>{debugText}</pre>
        </aside>
      </div>
    </main>
  )
}
