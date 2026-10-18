import type { ReactNode } from 'react'
import styles from './DevPlaceholder.module.css'

interface DevPlaceholderProps {
  /** 当前路由模式，用于让占位页自己说明位置。 */
  readonly route: string
  readonly title: string
  readonly note?: ReactNode
  readonly children?: ReactNode
}

/** 开发占位块：P01 阶段所有页面共用的明确“未实现”标识。 */
export default function DevPlaceholder({ route, title, note, children }: DevPlaceholderProps) {
  return (
    <section className={styles.placeholder} aria-labelledby="placeholder-title">
      <p className={styles.badge}>开发占位 · 未实现业务功能</p>
      <h1 id="placeholder-title" className={styles.title}>
        {title}
      </h1>
      <p className={styles.route}>
        路由 <code>{route}</code>
      </p>
      {note === undefined ? null : <p className={styles.note}>{note}</p>}
      {children}
    </section>
  )
}
