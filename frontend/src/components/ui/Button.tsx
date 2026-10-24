import type { ButtonHTMLAttributes } from 'react'
import { classNames } from '../../lib/classNames'
import { usePointerLight } from '../../lib/usePointerLight'
import styles from './Button.module.css'

export type ButtonVariant = 'primary' | 'secondary'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** 主按钮用于当前任务的唯一主要操作；其余一律次按钮。 */
  variant?: ButtonVariant
  magnetic?: boolean
}

export function Button({
  variant = 'secondary',
  type = 'button',
  className,
  magnetic = false,
  onPointerMove,
  onPointerLeave,
  children,
  ...rest
}: ButtonProps) {
  const { ref: pointerRef, onPointerMove: movePointer, onPointerLeave: resetPointer } = usePointerLight<HTMLButtonElement>()
  return (
    <button
      ref={pointerRef}
      type={type}
      className={classNames(styles.button, styles[variant], magnetic && styles.magnetic, className)}
      onPointerMove={(event) => {
        if (magnetic && !rest.disabled) movePointer(event)
        onPointerMove?.(event)
      }}
      onPointerLeave={(event) => {
        resetPointer()
        onPointerLeave?.(event)
      }}
      {...rest}
    >
      {magnetic ? <span className={styles.magneticContent}>{children}</span> : children}
    </button>
  )
}
