import type { ReactNode } from 'react'
import { classNames } from '../../lib/classNames'
import styles from './Field.module.css'

export interface FieldFrameProps {
  id: string
  label: string
  required?: boolean
  hint?: string
  error?: string
  className?: string
  children: ReactNode
}

/** 标签 → 控件 → 提示／错误的统一结构，三个字段组件共用。 */
export function FieldFrame({
  id,
  label,
  required = false,
  hint,
  error,
  className,
  children,
}: FieldFrameProps) {
  return (
    <div className={classNames(styles.field, className)}>
      <span className={styles.labelRow}>
        <label className={styles.label} htmlFor={id}>
          {label}
        </label>
        {required ? <span className={styles.required}>必填</span> : null}
      </span>
      {children}
      {error ? (
        <p className={styles.error} id={`${id}-error`} role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className={styles.hint} id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
    </div>
  )
}
