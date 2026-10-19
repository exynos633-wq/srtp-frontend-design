/** 拼接 CSS Module 类名，过滤空值。 */
export function classNames(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ')
}
