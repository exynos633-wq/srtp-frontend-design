import type { ReactNode, Ref } from 'react'
import { classNames } from '../../lib/classNames'
import styles from './PageHeader.module.css'

export interface PageHeaderProps {
  title: string
  /** 英文元信息或阶段说明，使用等宽字体。 */
  eyebrow?: string
  description?: string
  children?: ReactNode
  className?: string
  /** 页面需要把焦点交给主标题时使用；默认标题不可聚焦。 */
  headingRef?: Ref<HTMLHeadingElement>
  headingTabIndex?: number
}

export function PageHeader({
  title,
  eyebrow,
  description,
  children,
  className,
  headingRef,
  headingTabIndex,
}: PageHeaderProps) {
  return (
    <header className={classNames(styles.header, className)}>
      {eyebrow ? <p className={styles.eyebrow}>{eyebrow}</p> : null}
      <h1 className={styles.title} ref={headingRef} tabIndex={headingTabIndex}>
        {title}
      </h1>
      {description ? <p className={styles.description}>{description}</p> : null}
      {children}
    </header>
  )
}
