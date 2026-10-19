import styles from './SkipLink.module.css'

/** 键盘用户进入页面后的第一个入口，跳到主要内容起点（规范 §7.1）。 */
export function SkipLink() {
  return (
    <a className={styles.skip} href="#main-content">
      跳到主要内容
    </a>
  )
}
