import { QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { RouterProvider, createMemoryRouter } from 'react-router'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { login } from '../../src/api/auth'
import RouteError from '../../src/app/RouteError'
import { queryKeys } from '../../src/api/queryKeys'
import { createQueryClient } from '../../src/app/queryClient'
import { routes } from '../../src/app/routes'
import { server } from '../../src/mocks/node'
import { resetMockState, setMockScenario } from '../../src/mocks/scenario'

vi.mock('../../src/components/viewer/ModelViewport', () => import('./support/ModelViewportStub'))

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
    expect(await screen.findByRole('heading', { name: /从一座城，.*走进.*一座建筑/  })).toBeVisible()
    // jsdom 没有 WebGL：必须保留说明和完整目录入口，而不是伪装成可交互地球。
    expect(screen.getByText('三维场景不可用')).toBeVisible()
    expect(screen.getByRole('link', { name: '前往全部作品' })).toHaveAttribute('href', '/works')
  })

  it('首页无城市点时说明目录仍有作品并保留入口', async () => {
    setMockScenario('globe-empty')
    renderAt('/')
    expect(await screen.findByText('当前没有可用的城市点位')).toBeVisible()
    expect(screen.getByText(/这不表示没有作品/)).toBeVisible()
    expect(
      within(screen.getByRole('status')).getByRole('link', { name: '前往全部作品' }),
    ).toHaveAttribute('href', '/works')
  })

  it('首页城市点读取失败后可手动重试恢复', async () => {
    setMockScenario('list-failure')
    renderAt('/')
    expect(await screen.findByText('城市点位读取失败')).toBeVisible()
    expect(screen.getByText(/这里不会自动重试/)).toBeVisible()

    setMockScenario('normal')
    fireEvent.click(screen.getByRole('button', { name: '手动重试' }))
    await waitFor(() => expect(screen.queryByText('城市点位读取失败')).toBeNull())
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

    setMockScenario('empty')
    await act(async () => {
      await client.invalidateQueries({ queryKey: queryKeys.works.detail('work_demo_001') })
    })

    const notFound = await screen.findByRole('heading', { name: '作品不存在' })
    expect(notFound).toHaveFocus()
    expect(screen.queryByRole('heading', { name: '院落模型' })).toBeNull()
    expect(screen.queryByRole('button', { name: '开始预览' })).toBeNull()
    expect(screen.queryByRole('region', { name: '模型观看区' })).toBeNull()
    expect(screen.queryByTestId('model-viewport-stub')).toBeNull()
  })

  it('/admin/works/:id/edit 携带作品编号进入编辑页', async () => {
    await login({ username: 'admin', password: 'admin' })
    renderAt('/admin/works/work_draft_001/edit')
    expect(await screen.findByRole('heading', { name: '编辑作品' })).toBeVisible()
    expect(screen.getByText(/WORK work_draft_001/)).toBeVisible()
    expect(await screen.findByLabelText('作品名称')).toHaveValue('未命名草稿')
  })

  it('/admin 重定向到 /admin/works', async () => {
    await login({ username: 'admin', password: 'admin' })
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
