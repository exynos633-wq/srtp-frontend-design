import { Link, isRouteErrorResponse, useRouteError } from 'react-router'
import styles from './RouteError.module.css'

/** 路由级错误展示：数据加载失败或页面渲染异常时由 errorElement 渲染。 */
export default function RouteError() {
  const error = useRouteError()
  const routeError = isRouteErrorResponse(error) ? error : null

  return (
    <main className={styles.error} role="alert">
      <p className={styles.badge}>路由错误</p>
      <h1 className={styles.title}>页面加载出错</h1>
      {routeError === null ? (
        <p className={styles.detail}>
          页面渲染时发生未预期的错误，错误详情已输出到浏览器控制台。
        </p>
      ) : (
        <p className={styles.detail}>
          返回状态 {routeError.status}
          {routeError.statusText === '' ? '' : `：${routeError.statusText}`}
        </p>
      )}
      <p className={styles.actions}>
        <Link to="/">返回首页</Link>
      </p>
    </main>
  )
}
