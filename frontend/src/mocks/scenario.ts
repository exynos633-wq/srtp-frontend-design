import { resetDatabase } from './db'

/**
 * 可控的 Mock 场景，用于演示与测试。
 * 场景只影响 Mock 传输层，不改变任何页面逻辑，也不是安全开关。
 */
export type MockScenario =
  | 'normal'
  | 'empty'
  | 'list-failure'
  | 'cover-failure'
  | 'auth-expired'
  | 'validation-failure'
  | 'model-in-use'

export interface MockScenarioInfo {
  id: MockScenario
  label: string
  description: string
}

export const MOCK_SCENARIOS: MockScenarioInfo[] = [
  { id: 'normal', label: '正常', description: '10 件已发布演示作品，另含草稿与下架测试夹具。' },
  { id: 'empty', label: '空', description: '公开列表与地球城市为空；管理数据仍在。' },
  { id: 'list-failure', label: '读取失败', description: '公开读取接口返回 500，页面应显示失败而不是空列表。' },
  { id: 'cover-failure', label: '封面失败', description: '列表与详情正常返回，封面地址失效，页面显示不冒充模型的替代。' },
  { id: 'auth-expired', label: '登录失效', description: '管理接口返回 401，页面应提示重新登录。' },
  { id: 'validation-failure', label: '发布校验失败', description: '发布接口返回 422 与字段错误。' },
  { id: 'model-in-use', label: '资源占用中', description: '替换模型资源返回 409，需先下架并等会话结束。' },
]

let current: MockScenario = 'normal'

export function getMockScenario(): MockScenario {
  return current
}

export function setMockScenario(next: MockScenario): void {
  const known = MOCK_SCENARIOS.some((item) => item.id === next)
  if (!known) throw new Error(`未知 Mock 场景：${next}`)
  current = next
}

/** 测试之间的复位入口：清空会话、场景与内存改动。 */
export function resetMockState(): void {
  resetDatabase()
  current = 'normal'
}
