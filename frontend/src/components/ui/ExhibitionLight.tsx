import styles from './ExhibitionLight.module.css'

/** 展陈聚光只绘制背景，不拦截地球、卡片和观看器输入。 */
export function ExhibitionLight() {
  return (
    <div className={styles.light} aria-hidden="true">
      <span className={styles.cool} />
      <span className={styles.warm} />
      <span className={styles.grid} />
    </div>
  )
}
