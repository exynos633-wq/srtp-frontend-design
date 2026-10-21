/**
 * 后台表单与布局之间的最小离开确认边界。
 *
 * 路由内部导航由表单的 useBlocker 处理；退出登录不同——AdminLayout 必须先
 * 确认，再发 logout、清缓存和卸载表单。这里只登记当前表单的确认函数与一个
 * 精确的一次性放行目标，不做通用表单框架。
 */
export interface LeaveGuard {
  /** 有未保存内容时询问用户；返回 true 才允许离开。 */
  confirmLeave: () => boolean
  /** 放行退出成功后的特定站内目标；不作用于其他导航。 */
  allowNavigationTo: (pathname: string) => void
  /** 退出失败时清除尚未使用的放行目标。 */
  resetConsent: () => void
}

let activeGuard: LeaveGuard | null = null

export function registerLeaveGuard(guard: LeaveGuard): () => void {
  activeGuard = guard
  return () => {
    if (activeGuard === guard) activeGuard = null
  }
}

/** 没有表单登记时允许退出，避免影响列表页与未使用表单的页面。 */
export function confirmActiveLeave(): boolean {
  return activeGuard ? activeGuard.confirmLeave() : true
}

/** 只登记一个目标；实际导航仍由表单的 blocker 精确匹配并一次性消费。 */
export function allowActiveLeaveNavigation(pathname: string): void {
  activeGuard?.allowNavigationTo(pathname)
}

export function resetActiveLeaveConsent(): void {
  activeGuard?.resetConsent()
}
