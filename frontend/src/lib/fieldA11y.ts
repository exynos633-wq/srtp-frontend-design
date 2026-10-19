/** 字段提示与错误的 aria-describedby 计算：错误优先于提示。 */
export function describedBy(id: string, hint?: string, error?: string): string | undefined {
  if (error) return `${id}-error`
  if (hint) return `${id}-hint`
  return undefined
}
