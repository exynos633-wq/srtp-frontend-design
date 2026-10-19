import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * 默认值测试不能依赖运行机器的配置（PR #1 审查 P2）。
 * `appConfig` 在模块求值时就读取 `import.meta.env`，所以每个用例先 stub 再重新导入，
 * 这样开发者本机 `.env.local` 或 CI 注入的合法 VITE_ 变量不会让断言失效。
 */
const loadConfig = async () => {
  vi.resetModules()
  const module = await import('../../src/app/env')
  return module.appConfig
}

const stubEnv = (values: {
  appName?: string
  apiBaseUrl?: string
  enableMocks?: string
}) => {
  vi.stubEnv('VITE_APP_NAME', values.appName ?? '')
  vi.stubEnv('VITE_API_BASE_URL', values.apiBaseUrl ?? '')
  vi.stubEnv('VITE_ENABLE_MOCKS', values.enableMocks ?? '')
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('公开运行配置', () => {
  it('未提供变量时使用默认值，且默认不启用 Mock', async () => {
    stubEnv({})

    const appConfig = await loadConfig()

    expect(appConfig.appName).toBe('建筑模型展厅')
    expect(appConfig.apiBaseUrl).toBe('/api')
    expect(appConfig.enableMocks).toBe(false)
  })

  it('空白变量按未配置处理，不回退成空字符串', async () => {
    stubEnv({ appName: '   ', apiBaseUrl: '  ', enableMocks: ' ' })

    const appConfig = await loadConfig()

    expect(appConfig.appName).toBe('建筑模型展厅')
    expect(appConfig.apiBaseUrl).toBe('/api')
    expect(appConfig.enableMocks).toBe(false)
  })

  it('显式配置覆盖默认值，Mock 只在字符串 true 时开启', async () => {
    stubEnv({ appName: '演示展厅', apiBaseUrl: '/custom-api', enableMocks: 'true' })

    const appConfig = await loadConfig()

    expect(appConfig.appName).toBe('演示展厅')
    expect(appConfig.apiBaseUrl).toBe('/custom-api')
    expect(appConfig.enableMocks).toBe(true)
  })

  it('Mock 开关不接受 true 以外的写法', async () => {
    stubEnv({ enableMocks: '1' })

    const appConfig = await loadConfig()

    expect(appConfig.enableMocks).toBe(false)
  })
})
