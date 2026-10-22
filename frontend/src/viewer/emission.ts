/** 统一色调使用无发光替代材质，此时只改原材质上的发光强度不会改变画面。 */
export function canControlEmission(
  hasEmissive: boolean | null | undefined,
  uniformTone: boolean,
): boolean {
  return Boolean(hasEmissive) && !uniformTone
}
