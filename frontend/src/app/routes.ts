import type { RouteObject } from 'react-router'
import { lazy } from 'react'
import AdminLayout from '../components/layouts/AdminLayout'
import PublicLayout from '../components/layouts/PublicLayout'
import AdminIndexRedirect from './AdminIndexRedirect'
import RouteError from './RouteError'

// 公开端与后台页面按模块懒加载：首屏只加载当前分支的代码。
const HomePage = lazy(() => import('../pages/HomePage'))
const WorksPage = lazy(() => import('../pages/WorksPage'))
const WorkDetailPage = lazy(() => import('../pages/WorkDetailPage'))
const NotFoundPage = lazy(() => import('../pages/NotFoundPage'))
const LoginPage = lazy(() => import('../pages/admin/LoginPage'))
const AdminWorksPage = lazy(() => import('../pages/admin/AdminWorksPage'))
const WorkNewPage = lazy(() => import('../pages/admin/WorkNewPage'))
const WorkEditPage = lazy(() => import('../pages/admin/WorkEditPage'))
const WorkPreviewPage = lazy(() => import('../pages/admin/WorkPreviewPage'))

/**
 * 首期路由表（工程设计/01）。
 *
 * 路由可被直接访问不代表有权限：真实的管理员权限由服务端校验，前端隐藏入口
 * 不构成安全边界。当前不做任何业务表单，也不做假认证。
 */
export const routes: RouteObject[] = [
  {
    path: '/',
    Component: PublicLayout,
    ErrorBoundary: RouteError,
    children: [
      { index: true, Component: HomePage },
      { path: 'works', Component: WorksPage },
      { path: 'works/:id', Component: WorkDetailPage },
      { path: '*', Component: NotFoundPage },
    ],
  },
  {
    path: '/admin',
    Component: AdminLayout,
    ErrorBoundary: RouteError,
    children: [
      { index: true, Component: AdminIndexRedirect },
      { path: 'login', Component: LoginPage },
      { path: 'works', Component: AdminWorksPage },
      { path: 'works/new', Component: WorkNewPage },
      { path: 'works/:id/edit', Component: WorkEditPage },
      { path: 'works/:id/preview', Component: WorkPreviewPage },
      { path: '*', Component: NotFoundPage },
    ],
  },
  { path: '*', Component: NotFoundPage },
]
