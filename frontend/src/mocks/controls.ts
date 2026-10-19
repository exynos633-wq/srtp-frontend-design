import {
  MOCK_SCENARIOS,
  getMockScenario,
  resetMockState,
  setMockScenario,
  type MockScenario,
  type MockScenarioInfo,
} from './scenario'

export interface MockControls {
  list(): MockScenarioInfo[]
  getScenario(): MockScenario
  setScenario(id: MockScenario): void
  reset(): void
}

declare global {
  interface Window {
    /** 仅开发 Mock 存在；控制台可用它切换场景。 */
    __mockControls?: MockControls
  }
}

/** 暴露给浏览器控制台的演示开关；不参与任何业务逻辑。 */
export function installMockControls(): void {
  window.__mockControls = {
    list: () => MOCK_SCENARIOS,
    getScenario: () => getMockScenario(),
    setScenario: (id) => setMockScenario(id),
    reset: () => resetMockState(),
  }
}
