import type { SelectHTMLAttributes } from 'react'
import { describedBy } from '../../lib/fieldA11y'
import { FieldFrame } from './FieldFrame'
import styles from './Field.module.css'

export interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  id: string
  label: string
  hint?: string
  error?: string
  fieldClassName?: string
}

/** 使用原生 select：键盘、触摸与辅助技术行为由浏览器提供（规范 §5.3）。 */
export function SelectField({
  id,
  label,
  hint,
  error,
  required,
  fieldClassName,
  className,
  children,
  ...select
}: SelectFieldProps) {
  const description = describedBy(id, hint, error)
  return (
    <FieldFrame
      id={id}
      label={label}
      required={required}
      hint={hint}
      error={error}
      className={fieldClassName}
    >
      <select
        id={id}
        className={[styles.control, className].filter(Boolean).join(' ')}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={description}
        {...select}
      >
        {children}
      </select>
    </FieldFrame>
  )
}
