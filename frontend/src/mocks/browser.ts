import { setupWorker } from 'msw/browser'
import { handlers } from './handlers'

/** 浏览器端 Mock worker；只在显式开启时由启动脚本动态引入。 */
export const worker = setupWorker(...handlers)
