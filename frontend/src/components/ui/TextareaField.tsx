import type { TextareaHTMLAttributes } from 'react'
import { describedBy } from '../../lib/fieldA11y'
import { FieldFrame } from './FieldFrame'
import styles from './Field.module.css'

export interface TextareaFieldProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  id: string
  label: string
  hint?: string
  error?: string
  fieldClassName?: string
}

/** 多行文本：Enter 用于换行，不提交表单（规范 §7.4）。 */
export function TextareaField({
  id,
  label,
  hint,
  error,
  required,
  fieldClassName,
  className,
  ...textarea
}: TextareaFieldProps) {
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
      <textarea
        id={id}
        className={[styles.control, styles.textarea, className].filter(Boolean).join(' ')}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={description}
        {...textarea}
      />
    </FieldFrame>
  )
}
