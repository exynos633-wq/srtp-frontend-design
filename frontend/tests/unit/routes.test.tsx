import { render, screen } from '@testing-library/react'
import { RouterProvider, createMemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import RouteError from '../../src/app/RouteError'
import { routes } from '../../src/app/routes'

const renderAt = (path: string) => {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(<RouterProvider router={router} />)
  return router
}

describe('首期路由表', () => {
  it('首页渲染开发占位', async () => {
    renderAt('/')
    expect(await screen.findByRole('heading', { name: '首页 · 地图探索' })).toBeVisible()
  })

  it('/works 直接访问可进入目录页', async () => {
    renderAt('/works')
    expect(await screen.findByRole('heading', { name: '全部作品' })).toBeVisible()
  })

  it('/works/:id 携带作品编号进入详情页', async () => {
    renderAt('/works/demo-001')
    expect(await screen.findByRole('heading', { name: '作品详情' })).toBeVisible()
    expect(screen.getByText(/demo-001/)).toBeVisible()
  })

  it('/admin/works/:id/edit 携带作品编号进入编辑页', async () => {
    renderAt('/admin/works/demo-001/edit')
    expect(await screen.findByRole('heading', { name: '编辑作品' })).toBeVisible()
    expect(screen.getByText(/demo-001/)).toBeVisible()
  })

  it('/admin 重定向到 /admin/works', async () => {
    const router = renderAt('/admin')
    expect(await screen.findByRole('heading', { name: '作品管理' })).toBeVisible()
    expect(router.state.location.pathname).toBe('/admin/works')
  })

  it('登录页不显示管理导航，避免冒充已登录', async () => {
    renderAt('/admin/login')
    expect(await screen.findByRole('heading', { name: '管理员登录' })).toBeVisible()
    expect(screen.queryByRole('navigation', { name: '管理后台导航' })).toBeNull()
  })

  it('未知地址显示 404', async () => {
    renderAt('/no-such-page')
    expect(await screen.findByRole('heading', { name: '页面不存在（404）' })).toBeVisible()
  })
})

describe('路由错误展示', () => {
  it('数据加载失败时渲染错误页并显示状态码', async () => {
    const router = createMemoryRouter(
      [
        {
          path: '/boom',
          loader: () => {
            throw new Response('服务器错误', { status: 500 })
          },
          hydrateFallbackElement: <p>加载中…</p>,
          element: <p>不应渲染</p>,
          ErrorBoundary: RouteError,
        },
      ],
      { initialEntries: ['/boom'] },
    )

    render(<RouterProvider router={router} />)

    expect(await screen.findByRole('heading', { name: '页面加载出错' })).toBeVisible()
    expect(await screen.findByText(/500/)).toBeVisible()
  })
})
