import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { RouterProvider, createMemoryRouter } from 'react-router'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { unpublishAdminWork } from '../../src/api/adminWorks'
import { login } from '../../src/api/auth'
import { queryKeys } from '../../src/api/queryKeys'
import { createQueryClient } from '../../src/app/queryClient'
import { routes } from '../../src/app/routes'
import { server } from '../../src/mocks/node'
import { resetMockState } from '../../src/mocks/scenario'

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
beforeEach(() => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  )
})
afterEach(() => {
  vi.unstubAllGlobals()
  server.resetHandlers()
  resetMockState()
})
afterAll(() => server.close())

function renderAt(path: string, existingClient?: QueryClient) {
  const client = existingClient ?? createQueryClient()
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return { client, router }
}

describe('P13 公开详情与模拟预览的当前状态检查', () => {
  it('缓存详情关联的作品下架后，新开始预览经公开读取检查被拒绝', async () => {
    await login({ username: 'admin', password: 'admin' })
    renderAt('/works/work_demo_001')
    expect(await screen.findByRole('heading', { name: '院落模型' })).toBeVisible()

    await unpublishAdminWork('work_demo_001')
    fireEvent.click(screen.getByRole('button', { name: '开始预览' }))

    expect(await screen.findByRole('heading', { name: '作品不存在' })).toBeVisible()
    expect(screen.queryByText('模拟观看画面')).toBeNull()
  })

  it('已开始的模拟观看在后台 404 后保留，结束后不能重新开始', async () => {
    await login({ username: 'admin', password: 'admin' })
    const { client } = renderAt('/works/work_demo_001')
    expect(await screen.findByRole('heading', { name: '院落模型' })).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: '开始预览' }))
    expect(
      await screen.findByText('模拟观看画面', {}, { timeout: 4000 }),
    ).toBeVisible()

    await unpublishAdminWork('work_demo_001')
    await act(async () => {
      await client.refetchQueries({
        queryKey: queryKeys.works.detail('work_demo_001'),
      })
    })

    expect(await screen.findByText(/该作品已不再公开/)).toBeVisible()
    expect(screen.getByText('模拟观看画面')).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: '结束预览' }))
    expect((await screen.findAllByText('预览已结束')).length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: '开始预览' }))
    expect(await screen.findByText('作品当前不可预览')).toBeVisible()
    expect(screen.queryByText('模拟观看画面')).toBeNull()
  })
})
