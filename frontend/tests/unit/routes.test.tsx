import { QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { RouterProvider, createMemoryRouter } from 'react-router'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import RouteError from '../../src/app/RouteError'
import { queryKeys } from '../../src/api/queryKeys'
import { createQueryClient } from '../../src/app/queryClient'
import { routes } from '../../src/app/routes'
import { server } from '../../src/mocks/node'
import { resetMockState, setMockScenario } from '../../src/mocks/scenario'

const renderAt = (path: string, client = createQueryClient()) => {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return router
}

beforeAll(() => server.listen({ onUnhandledFrame: 'bypass' }))
afterEach(() => {
  server.resetHandlers()
  resetMockState()
})
afterAll(() => server.close())

describe('首期路由表', () => {
  it('首页渲染空间入口标题', async () => {
    renderAt('/')
    expect(await screen.findByRole('heading', { name: '从城市进入建筑模型' })).toBeVisible()
  })

  it('/works 读取已发布作品并渲染卡片', async () => {
    renderAt('/works')
    expect(await screen.findByRole('heading', { name: '全部作品' })).toBeVisible()
    expect(await screen.findByRole('heading', { name: '院落模型' })).toBeVisible()
    const cards = screen
      .getAllByRole('link')
      .filter((link) => link.getAttribute('href')?.startsWith('/works/'))
    expect(cards).toHaveLength(10)
  })

  it('/works/:id 携带作品编号进入详情页', async () => {
    renderAt('/works/work_demo_001')
    const title = await screen.findByRole('heading', { name: '院落模型' })
    await waitFor(() => expect(title).toBeVisible(), { timeout: 3000 })
    const introHeading = screen.getByRole('heading', { name: '建筑介绍' })
    await waitFor(() => expect(introHeading).toBeVisible(), { timeout: 3000 })
  })

  it('缓存详情后台重取返回 404 后移除旧作品信息与观看器', async () => {
    const client = createQueryClient()
    renderAt('/works/work_demo_001', client)
    await screen.findByRole('heading', { name: '院落模型' })
    fireEvent.click(screen.getByRole('button', { name: '开始预览' }))
    expect(screen.getByText('正在准备预览')).toBeVisible()

    setMockScenario('empty')
    await act(async () => {
      await client.invalidateQueries({ queryKey: queryKeys.works.detail('work_demo_001') })
    })

    const notFound = await screen.findByRole('heading', { name: '作品不存在' })
    expect(notFound).toHaveFocus()
    expect(screen.queryByRole('heading', { name: '院落模型' })).toBeNull()
    expect(screen.queryByRole('button', { name: '开始预览' })).toBeNull()
    expect(screen.queryByRole('region', { name: '模型观看区' })).toBeNull()
    expect(screen.queryByText('正在准备预览')).toBeNull()
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
    expect(await screen.findByRole('heading', { name: '页面不存在' })).toBeVisible()
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
