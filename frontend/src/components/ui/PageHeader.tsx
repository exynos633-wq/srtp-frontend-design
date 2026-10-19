import type { ReactNode } from 'react'
import { classNames } from '../../lib/classNames'
import styles from './PageHeader.module.css'

export interface PageHeaderProps {
  title: string
  /** 英文元信息或阶段说明，使用等宽字体。 */
  eyebrow?: string
  description?: string
  children?: ReactNode
  className?: string
}

export function PageHeader({ title, eyebrow, description, children, className }: PageHeaderProps) {
  return (
    <header className={classNames(styles.header, className)}>
      {eyebrow ? <p className={styles.eyebrow}>{eyebrow}</p> : null}
      <h1 className={styles.title}>{title}</h1>
      {description ? <p className={styles.description}>{description}</p> : null}
      {children}
    </header>
  )
}
