import styles from './ScanLoader.module.css'
import { classNames } from '../../lib/classNames'

export interface ScanLoaderProps {
  label: string
  /** 紧凑版用于场景内/面板内的小面积加载。 */
  compact?: boolean
  className?: string
}

/**
 * 扫描式加载态（动效设计 v2.1 §4.4）：
 * 网格底 + 一条 1px 扫描线往复，替代脉冲点；减少动态下停走、只留静态网格与标签。
 */
export function ScanLoader({ label, compact = false, className }: ScanLoaderProps) {
  return (
    <div
      className={classNames(styles.loader, compact && styles.compact, className)}
      role="status"
      aria-live="polite"
      data-scan-loader="true"
    >
      <span className={styles.grid} aria-hidden="true" />
      <span className={styles.scan} aria-hidden="true" />
      <span className={styles.label}>{label}</span>
    </div>
  )
}
