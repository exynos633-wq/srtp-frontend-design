import { resetDatabase } from './db'

/**
 * 可控的 Mock 场景，用于演示与测试。
 * 场景只影响 Mock 传输层，不改变任何页面逻辑，也不是安全开关。
 */
export type MockScenario =
  | 'normal'
  | 'empty'
  | 'globe-empty'
  | 'city-empty'
  | 'city-list-failure'
  | 'list-failure'
  | 'admin-list-empty'
  | 'admin-list-failure'
  | 'cover-failure'
  | 'auth-expired'
  | 'auth-forbidden'
  | 'login-error'
  | 'validation-failure'
  | 'model-in-use'
  | 'upload-cover-failure'
  | 'upload-model-failure'
  | 'upload-validating'

export interface MockScenarioInfo {
  id: MockScenario
  label: string
  description: string
}

export const MOCK_SCENARIOS: MockScenarioInfo[] = [
  { id: 'normal', label: '正常', description: '10 件已发布演示作品，另含草稿与下架测试夹具。' },
  { id: 'empty', label: '空', description: '公开列表与地球城市为空；管理数据仍在。' },
  {
    id: 'globe-empty',
    label: '地球无点位',
    description: '地球城市点位为空，但公开目录仍有已发布作品。',
  },
  {
    id: 'city-empty',
    label: '城市无作品',
    description: '城市点位正常，打开气泡显示该城暂无已发布作品。',
  },
  {
    id: 'city-list-failure',
    label: '城市作品失败',
    description: '城市聚合正常，打开气泡读取作品列表返回 500，可就地重试。',
  },
  { id: 'list-failure', label: '读取失败', description: '公开读取接口返回 500，页面应显示失败而不是空列表。' },
  {
    id: 'admin-list-empty',
    label: '管理列表空',
    description: '仅管理作品列表为空；公开列表、详情与登录不受影响。',
  },
  {
    id: 'admin-list-failure',
    label: '管理列表失败',
    description: '仅管理作品列表返回 500；公开列表与登录不受影响，可手动重试。',
  },
  { id: 'cover-failure', label: '封面失败', description: '列表与详情正常返回，封面地址失效，页面显示不冒充模型的替代。' },
  { id: 'auth-forbidden', label: '管理无权限', description: '认证与管理读取返回 403，保留路径并诚实反馈。' },
  { id: 'login-error', label: '登录错误', description: '登录返回 401，不改变表单输入。' },
  { id: 'auth-expired', label: '登录失效', description: '管理接口返回 401，页面应提示重新登录。' },
  { id: 'validation-failure', label: '发布校验失败', description: '发布接口返回 422 与字段错误。' },
  { id: 'model-in-use', label: '资源占用中', description: '替换模型资源返回 409，需先下架并等会话结束。' },
  {
    id: 'upload-cover-failure',
    label: '模拟封面上传失败',
    description: '仅开发上传模拟：模型可完成，封面在模拟验证阶段失败，可重试。',
  },
  {
    id: 'upload-model-failure',
    label: '模拟模型上传失败',
    description: '仅开发上传模拟：封面可完成，模型在模拟验证阶段失败，可重试。',
  },
  {
    id: 'upload-validating',
    label: '模拟验证停滞',
    description: '仅开发上传模拟：资源停在验证中，用于检查未 ready 不能绑定。',
  },
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
