import styles from './AmbientLights.module.css'

/**
 * 首页环境光层（动效设计 v2.1 §4.1）。
 * 纯 CSS 合成：构图光 + 两侧洗墙光带 + 顶部光锥；不拦截指针，减少动态下静态。
 * 放在场景之上、文案之下（`z-index: 1`），用 `screen` 叠在深色地球边缘。
 */
export function AmbientLights() {
  return (
    <div className={styles.lights} aria-hidden="true" data-ambient-lights="true">
      <div className={styles.glow} />
      <div className={`${styles.wash} ${styles.washLeft}`} />
      <div className={`${styles.wash} ${styles.washRight}`} />
      <div className={styles.cone} />
    </div>
  )
}
