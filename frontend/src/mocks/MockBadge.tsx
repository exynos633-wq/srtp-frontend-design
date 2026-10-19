import { isMocksActive } from '../app/mocksStatus'
import styles from './MockBadge.module.css'

/**
 * 只在 Mock 真正挂载时出现的标识。生产构建不会渲染它。
 */
export function MockBadge() {
  if (!isMocksActive()) return null
  return (
    <p className={styles.badge} role="status">
      开发 Mock · 非真实接口
    </p>
  )
}
