import type { ReactNode } from 'react'
import { classNames } from '../../lib/classNames'
import styles from './StatusMessage.module.css'

export type StatusTone = 'info' | 'success' | 'warning' | 'error'

export interface StatusMessageProps {
  tone?: StatusTone
  children: ReactNode
  className?: string
}

/**
 * 页面级或区块级状态提示。
 * error 使用 alert 立即播报；其余使用 status 礼貌播报。
 */
export function StatusMessage({ tone = 'info', children, className }: StatusMessageProps) {
  return (
    <p
      className={classNames(styles.message, styles[tone], className)}
      role={tone === 'error' ? 'alert' : 'status'}
    >
      {children}
    </p>
  )
}
