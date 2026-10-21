import { useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { Button } from '../ui/Button'
import { modelFormatLabel } from '../../lib/workLabels'
import type { UseMockUploadResult } from '../../lib/useMockUpload'
import type { UploadAssetKind } from '../../types/upload'
import type { ModelFormat } from '../../types/work'
import styles from './UploadField.module.css'

interface UploadFieldProps {
  kind: UploadAssetKind
  /** 用于服务端字段错误焦点。 */
  id: string
  headingId: string
  required?: boolean
  savedAssetId: string | null
  savedModelFormat?: ModelFormat | null
  savedCoverUrl?: string | null
  upload: UseMockUploadResult
  disabled: boolean
  disabledReason?: string
  error?: string
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function SavedCover({ url }: { url: string }) {
  const [failed, setFailed] = useState(false)
  if (failed) return <p className={styles.coverFallback}>已保存封面加载失败</p>
  return (
    <div className={styles.coverBox}>
      <img
        className={styles.coverImage}
        src={url}
        alt="已保存封面"
        onError={() => setFailed(true)}
      />
    </div>
  )
}

export function UploadField({
  kind,
  id,
  headingId,
  required = false,
  savedAssetId,
  savedModelFormat,
  savedCoverUrl,
  upload,
  disabled,
  disabledReason,
  error,
}: UploadFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const selection = upload.selection
  const isModel = kind === 'model'
  const actionLabel = isModel ? '模型' : '封面'
  const selectionStatus = selection?.status

  function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (file) upload.selectFile(file)
    // 允许再次选择同一个文件时仍触发 change。
    event.target.value = ''
  }

  return (
    <div
      className={styles.field}
      id={id}
      tabIndex={-1}
      aria-labelledby={headingId}
    >
      <div className={styles.head}>
        <h2 className={styles.title} id={headingId}>
          {isModel ? '模型资源' : '封面'}
        </h2>
        {required ? <span className={styles.requiredTag}>发布时必填</span> : null}
      </div>

      <div className={styles.savedBlock}>
        <p className={styles.savedLabel}>已保存绑定</p>
        {isModel ? (
          <p className={styles.savedValue}>
            {savedAssetId
              ? `现有模型资源（${modelFormatLabel(savedModelFormat ?? null)}）`
              : '尚无已保存模型资源'}
          </p>
        ) : savedCoverUrl ? (
          <SavedCover key={savedCoverUrl} url={savedCoverUrl} />
        ) : (
          <p className={styles.savedValue}>尚无已保存封面</p>
        )}
      </div>

      {upload.wasCanceled ? (
        <p className={styles.canceled} role="status">
          已取消新选择；已保存绑定未改变。
        </p>
      ) : null}

      {selection ? (
        <div className={styles.selection}>
          <div className={styles.selectionHead}>
            <span className={styles.unsavedTag}>未保存</span>
            <span className={styles.fileName}>{selection.file.name}</span>
            <span className={styles.fileMeta}>{formatBytes(selection.file.size)}</span>
          </div>

          {selectionStatus === 'receiving' ? (
            <div className={styles.statusBlock}>
              <p className={styles.statusText}>模拟传输中（仅开发演示）</p>
              <div
                className={styles.progress}
                role="progressbar"
                aria-label={`${actionLabel}模拟传输进度`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={selection.simulatedProgress}
              >
                <span
                  className={styles.progressBar}
                  style={{ width: `${selection.simulatedProgress}%` }}
                />
              </div>
              <p className={styles.statusHint}>
                {selection.simulatedProgress}% · 模拟进度，不代表真实字节、速度或上传结果
              </p>
            </div>
          ) : null}

          {selectionStatus === 'validating' ? (
            <div className={styles.statusBlock}>
              <p className={styles.statusText}>模拟服务端验证中</p>
              <p className={styles.statusHint}>
                尚不能保存绑定；模拟验证通过后才可写入草稿。
              </p>
            </div>
          ) : null}

          {selectionStatus === 'ready' ? (
            <div className={styles.statusBlock}>
              <p className={styles.statusOk}>模拟验证通过（ready）</p>
              <p className={styles.statusHint}>
                保存后才会写入此草稿的绑定；不会自动发布。
              </p>
              {isModel ? (
                <p className={styles.statusHint}>
                  模拟格式：{modelFormatLabel(selection.modelFormat ?? null)}
                  （仅演示，不代表真实文件格式或可渲染性已验证）。
                </p>
              ) : null}
            </div>
          ) : null}

          {selectionStatus === 'failed' ? (
            <div className={styles.statusBlock}>
              <p className={styles.statusError} role="alert">
                {selection.error || '模拟上传失败，请重试。'}
              </p>
              <p className={styles.statusHint}>
                新选择尚未保存；已保存绑定不会被清除。
              </p>
            </div>
          ) : null}

          {!isModel && upload.objectUrl ? (
            <div className={styles.localPreview}>
              <p className={styles.localPreviewLabel}>新选择本地预览（未上传、未保存）</p>
              <div className={styles.coverBox}>
                <img
                  className={styles.coverImage}
                  src={upload.objectUrl}
                  alt="新选择的本地封面预览，尚未保存"
                />
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {disabled ? (
        disabledReason ? <p className={styles.disabledNote}>{disabledReason}</p> : null
      ) : (
        <div className={styles.actions}>
          <input
            ref={inputRef}
            id={`${kind}-file-input`}
            className={styles.fileInput}
            type="file"
            tabIndex={-1}
            accept={isModel ? '.glb,.ply' : 'image/*'}
            aria-label={isModel ? '选择模型文件' : '选择封面文件'}
            onChange={chooseFile}
          />
          <Button onClick={() => inputRef.current?.click()}>
            {selection ? `重新选择${actionLabel}` : `选择${actionLabel}`}
          </Button>
          {selection?.status === 'failed' ? (
            <Button onClick={upload.retry}>重试{actionLabel}</Button>
          ) : null}
          {selection ? (
            <Button onClick={upload.cancel}>
              {selection.status === 'ready' ? `清除新${actionLabel}` : `取消新${actionLabel}`}
            </Button>
          ) : null}
        </div>
      )}

      {!disabled ? (
        <p className={styles.hint}>
          仅开发模拟示例：模型按 .glb / .ply、封面按图片类型演示；正式类型与大小上限等待确认。
        </p>
      ) : null}

      {error ? (
        <p className={styles.fieldError} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
