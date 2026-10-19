import { Navigate } from 'react-router'

/**
 * `/admin` 没有独立页面，统一进入作品管理。
 *
 * 这里只做路径整理，不含登录判断；登录后的默认落地页由 P09 决定。
 */
export default function AdminIndexRedirect() {
  return <Navigate to="/admin/works" replace />
}
