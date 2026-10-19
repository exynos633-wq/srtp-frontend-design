import { appConfig } from '../app/env'
import { markMocksActive } from '../app/mocksStatus'

/**
 * Mock 启用规则（可测试的纯函数）：
 * 必须同时满足“开发构建”和“显式开关为 true”。
 * 生产构建即使误留开关也不会启用；真实请求失败时不会回退到假数据。
 */
export function shouldEnableMocks(options: { dev: boolean; flag: boolean }): boolean {
  return options.dev && options.flag
}

/**
 * 在挂载 React 之前启动 Mock，保证首批请求就能命中；
 * 未启用时直接返回 false，页面走的仍是真实 fetch。
 */
export async function startMocksIfEnabled(): Promise<boolean> {
  // 先判断构建类型：生产构建里这句是常量，打包时整段 Mock 代码与动态引入都会被移除。
  if (!import.meta.env.DEV) return false
  if (!shouldEnableMocks({ dev: true, flag: appConfig.enableMocks })) return false

  // 动态引入：生产构建不把 MSW 与示例数据打进主包。
  const [{ worker }, { installMockControls }, { getMockScenario }] = await Promise.all([
    import('./browser'),
    import('./controls'),
    import('./scenario'),
  ])
  await worker.start({ onUnhandledFrame: 'bypass', quiet: true })
  markMocksActive()
  installMockControls()
  console.info(`[mock] 已启用开发 Mock（场景：${getMockScenario()}）。数据仅存于内存，刷新即重置。`)
  return true
}
