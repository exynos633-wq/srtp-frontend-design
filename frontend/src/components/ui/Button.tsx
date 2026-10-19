import type { ButtonHTMLAttributes } from 'react'
import { classNames } from '../../lib/classNames'
import styles from './Button.module.css'

export type ButtonVariant = 'primary' | 'secondary'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** 主按钮用于当前任务的唯一主要操作；其余一律次按钮。 */
  variant?: ButtonVariant
}

export function Button({ variant = 'secondary', type = 'button', className, ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={classNames(styles.button, styles[variant], className)}
      {...rest}
    />
  )
}
