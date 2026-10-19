import type { InputHTMLAttributes } from 'react'
import { describedBy } from '../../lib/fieldA11y'
import { FieldFrame } from './FieldFrame'
import styles from './Field.module.css'

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  id: string
  label: string
  hint?: string
  error?: string
  /** 字段本身是否由外层控制间距，例如双列表单。 */
  fieldClassName?: string
}

export function TextField({
  id,
  label,
  hint,
  error,
  required,
  fieldClassName,
  className,
  ...input
}: TextFieldProps) {
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
      <input
        id={id}
        className={[styles.control, className].filter(Boolean).join(' ')}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={description}
        {...input}
      />
    </FieldFrame>
  )
}
