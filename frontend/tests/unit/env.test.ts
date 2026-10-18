import { describe, expect, it } from 'vitest'
import { appConfig } from '../../src/app/env'

describe('公开运行配置', () => {
  it('默认不启用 Mock：生产请求失败不得回退模拟成功', () => {
    expect(appConfig.enableMocks).toBe(false)
  })

  it('默认 API 基址与站名可用，且不包含密钥类配置', () => {
    expect(appConfig.apiBaseUrl).toBe('/api')
    expect(appConfig.appName).toBe('建筑模型展厅')
  })
})
