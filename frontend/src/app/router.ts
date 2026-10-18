import { createBrowserRouter } from 'react-router'
import { routes } from './routes'

/**
 * Data 模式路由（`createBrowserRouter`），不使用服务端框架模式。
 *
 * 直接打开或刷新深层路径由前端路由接管；生产环境仍需要部署服务器把页面路径
 * 回退到 `index.html`，该回退只在部署阶段配置与验证，开发服务器的回退不等于
 * 生产已配置。
 */
export const router = createBrowserRouter(routes)
