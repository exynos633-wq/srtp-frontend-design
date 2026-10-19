import { setupServer } from 'msw/node'
import { handlers } from './handlers'

/** 测试用 Mock 服务端（Vitest／Node 环境）。 */
export const server = setupServer(...handlers)
