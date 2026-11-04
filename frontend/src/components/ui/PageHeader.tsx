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

/**
 * 页头只提供排布与 data-* 钩子；入场动画由具体页面驱动。
 * 后台页面同样复用本组件，因此这里不包含任何自动播放的时间轴。
 */
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
      {eyebrow ? (
        <p className={styles.eyebrow} data-page-eyebrow>
          {eyebrow}
        </p>
      ) : null}
      <h1 className={styles.title} ref={headingRef} tabIndex={headingTabIndex} data-page-title>
        {/* 逐行揭示需要裁切容器：内层只做 yPercent，动画由目录页驱动（动效设计 v2.0 §6）。 */}
        <span className={styles.titleLine}>
          <span className={styles.titleInner} data-page-title-inner>
            {title}
          </span>
        </span>
      </h1>
      {description ? (
        <p className={styles.description} data-page-description>
          {description}
        </p>
      ) : null}
      {children}
    </header>
  )
}
