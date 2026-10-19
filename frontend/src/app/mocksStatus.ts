/**
 * Mock 是否真正挂载。生产构建里始终为 false；
 * 页面用它在角落显示“开发 Mock”标识，避免把演示数据当成真实接口。
 */
let active = false

export function markMocksActive(): void {
  active = true
}

export function isMocksActive(): boolean {
  return active
}
