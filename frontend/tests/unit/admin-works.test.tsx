import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { RouterProvider, createMemoryRouter } from 'react-router'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { HttpResponse, http } from 'msw'
import { getAdminWork, listAdminWorks, updateAdminWork } from '../../src/api/adminWorks'
import { login } from '../../src/api/auth'
import { queryKeys } from '../../src/api/queryKeys'
import { createQueryClient } from '../../src/app/queryClient'
import { routes } from '../../src/app/routes'
import { server } from '../../src/mocks/node'
import { resetMockState, setMockScenario } from '../../src/mocks/scenario'

beforeAll(() => server.listen({ onUnhandledFrame: 'bypass' }))
afterEach(() => {
  server.resetHandlers()
  vi.restoreAllMocks()
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

function requestedUrls(calls: ReadonlyArray<readonly unknown[]>) {
  return calls.map(([input]) => {
    if (typeof input === 'string') return input
    if (input instanceof Request) return input.url
    if (input instanceof URL) return input.href
    return ''
  })
}

describe('P10 管理作品列表', () => {
  it('区分三种状态，显示封面替代、名称、城市、格式与每条作品入口', async () => {
    await login({ username: 'admin', password: 'admin' })
    // 用现有草稿验证空名称回退；不新增演示业务数据。
    await updateAdminWork('work_draft_001', { name: '' })
    renderAt('/admin/works')

    expect(await screen.findByRole('heading', { name: '作品管理' })).toBeVisible()
    const table = await screen.findByRole('table', { name: '管理作品列表' })

    const publishedRow = within(table).getByRole('row', { name: /院落模型/ })
    expect(within(publishedRow).getByText('已发布')).toBeVisible()
    expect(within(publishedRow).getByText('北京市')).toBeVisible()
    expect(within(publishedRow).getByText('GLB')).toBeVisible()
    expect(within(publishedRow).getByRole('link', { name: '编辑 院落模型' })).toHaveAttribute(
      'href',
      '/admin/works/work_demo_001/edit',
    )
    expect(within(publishedRow).getByRole('link', { name: '预览 院落模型' })).toHaveAttribute(
      'href',
      '/admin/works/work_demo_001/preview',
    )
    expect(within(publishedRow).getByRole('button', { name: '下架 院落模型' })).toBeDisabled()

    const draftEdit = within(table)
      .getAllByRole('link', { name: /^编辑 / })
      .find((link) => link.getAttribute('href') === '/admin/works/work_draft_001/edit')
    expect(draftEdit).toBeDefined()
    const draftRow = draftEdit!.closest('tr')!
    expect(within(draftRow).getByText('未命名')).toBeVisible()
    expect(within(draftRow).getByText('草稿')).toBeVisible()
    expect(within(draftRow).getByText('未设置城市')).toBeVisible()
    expect(within(draftRow).getByText('未设置')).toBeVisible()
    expect(within(draftRow).getByText('缺封面')).toBeVisible()
    expect(within(draftRow).getByRole('button', { name: '发布 未命名' })).toBeDisabled()

    const offlineEdit = within(table)
      .getAllByRole('link', { name: /^编辑 / })
      .find((link) => link.getAttribute('href') === '/admin/works/work_offline_001/edit')
    const offlineRow = offlineEdit!.closest('tr')!
    expect(within(offlineRow).getByText('已下架')).toBeVisible()
    expect(within(offlineRow).getByRole('button', { name: '发布 已下架占位' })).toBeDisabled()

    expect(within(table).getAllByText('已发布')).toHaveLength(10)
    expect(within(table).getAllByText('草稿')).toHaveLength(2)
    expect(within(table).getAllByText('已下架')).toHaveLength(1)
    expect(within(table).getAllByText('缺封面')).toHaveLength(3)
    expect(screen.getByText(/发布与下架入口暂不可用/)).toBeVisible()
    expect(screen.getByText(/新建与编辑表单已可保存草稿和更新资料/)).toBeVisible()
    expect(screen.queryByRole('searchbox')).toBeNull()
    expect(screen.queryByRole('button', { name: /删除/ })).toBeNull()

    let mutations = 0
    server.use(
      http.post(/\/api\/admin\/works\/[^/]+\/(?:publish|unpublish)$/, () => {
        mutations += 1
        return HttpResponse.json({})
      }),
    )
    fireEvent.click(within(publishedRow).getByRole('button', { name: '下架 院落模型' }))
    fireEvent.click(within(draftRow).getByRole('button', { name: '发布 未命名' }))
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(mutations).toBe(0)
  })

  it('管理列表为空时给出下一步，不伪装成读取失败', async () => {
    setMockScenario('admin-list-empty')
    await login({ username: 'admin', password: 'admin' })
    renderAt('/admin/works')

    expect(await screen.findByText(/管理列表暂无作品/)).toBeVisible()
    expect(screen.getByText(/可先新建草稿/)).toBeVisible()
    expect(screen.getByRole('link', { name: '新建作品' })).toHaveAttribute(
      'href',
      '/admin/works/new',
    )
    expect(screen.queryByRole('table', { name: '管理作品列表' })).toBeNull()
    expect(screen.queryByText('作品列表读取失败')).toBeNull()
  })

  it('管理列表失败可手动重试，恢复后重新读取共享数据', async () => {
    setMockScenario('admin-list-failure')
    await login({ username: 'admin', password: 'admin' })
    renderAt('/admin/works')

    const heading = await screen.findByRole('heading', { name: '作品列表读取失败' })
    await waitFor(() => expect(heading).toHaveFocus())
    expect(screen.getByText('读取管理作品列表失败。')).toBeVisible()

    setMockScenario('normal')
    fireEvent.click(screen.getByRole('button', { name: '手动重试' }))

    const table = await screen.findByRole('table', { name: '管理作品列表' })
    expect(within(table).getByRole('row', { name: /院落模型/ })).toBeVisible()
    expect(screen.queryByText('作品列表读取失败')).toBeNull()
  })

  it('管理列表本次读取确认前不展示缓存列表，确认后聚焦标题', async () => {
    await login({ username: 'admin', password: 'admin' })
    const cached = await listAdminWorks()

    let releaseRequest!: () => void
    const requestGate = new Promise<void>((resolve) => {
      releaseRequest = resolve
    })
    server.use(
      http.get(/\/api\/admin\/works$/, async () => {
        await requestGate
        return HttpResponse.json(cached)
      }),
    )

    const client = createQueryClient()
    client.setQueryData(queryKeys.admin.works(), cached)
    renderAt('/admin/works', client)

    expect(await screen.findByRole('heading', { name: '作品管理' })).toBeVisible()
    expect(screen.getByText('正在读取管理作品列表…')).toBeVisible()
    expect(screen.queryByRole('table', { name: '管理作品列表' })).toBeNull()

    await act(async () => {
      releaseRequest()
    })
    const table = await screen.findByRole('table', { name: '管理作品列表' })
    expect(within(table).getByRole('row', { name: /院落模型/ })).toBeVisible()
    const title = screen.getByRole('heading', { name: '作品管理' })
    expect(title).toHaveFocus()

    const edit = within(table).getByRole('link', { name: '编辑 院落模型' })
    edit.focus()
    await act(async () => {
      await client.refetchQueries({ queryKey: queryKeys.admin.works() })
    })
    expect(edit).toHaveFocus()
  })
})

describe('P10 授权预览', () => {
  it('通过管理接口读取草稿，不调用公开详情，也不自动请求模型', async () => {
    await login({ username: 'admin', password: 'admin' })
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    renderAt('/admin/works/work_draft_001/preview')

    expect(await screen.findByRole('heading', { name: '管理员预览' })).toBeVisible()
    expect(await screen.findByRole('heading', { name: '未命名草稿' })).toBeVisible()
    expect(screen.getByText('封面待预览')).toBeVisible()
    expect(screen.getByRole('button', { name: '开始预览' })).toBeEnabled()

    const beforeStart = requestedUrls(fetchSpy.mock.calls)
    expect(beforeStart.some((url) => url.endsWith('/api/admin/works/work_draft_001'))).toBe(true)
    expect(beforeStart.some((url) => /\/api\/works\/work_draft_001$/.test(url))).toBe(false)
    expect(beforeStart.some((url) => /\.(glb|ply)(\?|$)/.test(url))).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: '开始预览' }))
    expect(screen.getByText('正在准备预览')).toBeVisible()
    expect(requestedUrls(fetchSpy.mock.calls).some((url) => /\.(glb|ply)(\?|$)/.test(url))).toBe(false)
  })

  it('预览读取失败可手动重试', async () => {
    await login({ username: 'admin', password: 'admin' })
    server.use(
      http.get(/\/api\/admin\/works\/work_draft_002$/, () =>
        HttpResponse.json(
          { error: { code: 'INTERNAL_ERROR', message: '预览读取失败。' } },
          { status: 500 },
        ),
      ),
    )
    renderAt('/admin/works/work_draft_002/preview')

    const heading = await screen.findByRole('heading', { name: '预览读取失败' })
    await waitFor(() => expect(heading).toHaveFocus())
    expect(screen.getByText('预览读取失败。')).toBeVisible()
    expect(screen.queryByRole('button', { name: '开始预览' })).toBeNull()

    server.resetHandlers()
    fireEvent.click(screen.getByRole('button', { name: '手动重试' }))
    expect(await screen.findByRole('heading', { name: '待补资源的草稿' })).toBeVisible()
  })

  it('预览 404 不渲染观看区', async () => {
    await login({ username: 'admin', password: 'admin' })
    renderAt('/admin/works/no-such-work/preview')

    expect(await screen.findByRole('heading', { name: '作品不存在' })).toBeVisible()
    expect(screen.queryByRole('button', { name: '开始预览' })).toBeNull()
  })

  it('本次授权确认前不展示缓存草稿，403 后撤除观看区', async () => {
    await login({ username: 'admin', password: 'admin' })
    const cached = await getAdminWork('work_draft_001')

    let releaseRequest!: () => void
    const requestGate = new Promise<void>((resolve) => {
      releaseRequest = resolve
    })
    server.use(
      http.get(/\/api\/admin\/works\/work_draft_001$/, async () => {
        await requestGate
        return HttpResponse.json(
          { error: { code: 'FORBIDDEN', message: '无权访问。' } },
          { status: 403 },
        )
      }),
    )

    const client = createQueryClient()
    client.setQueryData(queryKeys.admin.work('work_draft_001'), cached)
    renderAt('/admin/works/work_draft_001/preview', client)

    expect(await screen.findByRole('heading', { name: '管理员预览' })).toBeVisible()
    expect(screen.getByText('正在读取授权预览数据…')).toBeVisible()
    expect(screen.queryByText('未命名草稿')).toBeNull()
    expect(screen.queryByRole('button', { name: '开始预览' })).toBeNull()

    await act(async () => {
      releaseRequest()
    })
    expect(await screen.findByText(/无权访问此管理路径/)).toBeVisible()
    expect(screen.queryByText('未命名草稿')).toBeNull()
    expect(screen.queryByRole('button', { name: '开始预览' })).toBeNull()
  })

  it('本次授权确认前不展示缓存草稿，404 确认后显示不存在', async () => {
    await login({ username: 'admin', password: 'admin' })
    const cached = await getAdminWork('work_draft_002')

    let releaseRequest!: () => void
    const requestGate = new Promise<void>((resolve) => {
      releaseRequest = resolve
    })
    server.use(
      http.get(/\/api\/admin\/works\/work_draft_002$/, async () => {
        await requestGate
        return HttpResponse.json(
          { error: { code: 'WORK_NOT_FOUND', message: '作品不存在。' } },
          { status: 404 },
        )
      }),
    )

    const client = createQueryClient()
    client.setQueryData(queryKeys.admin.work('work_draft_002'), cached)
    renderAt('/admin/works/work_draft_002/preview', client)

    expect(await screen.findByRole('heading', { name: '管理员预览' })).toBeVisible()
    expect(screen.getByText('正在读取授权预览数据…')).toBeVisible()
    expect(screen.queryByText('待补资源的草稿')).toBeNull()
    expect(screen.queryByRole('button', { name: '开始预览' })).toBeNull()

    await act(async () => {
      releaseRequest()
    })
    expect(await screen.findByRole('heading', { name: '作品不存在' })).toBeVisible()
    expect(screen.queryByText('待补资源的草稿')).toBeNull()
    expect(screen.queryByRole('button', { name: '开始预览' })).toBeNull()
  })

  it('切换作品 id 时等待新作品本次确认，不露出上一件或下一件缓存', async () => {
    await login({ username: 'admin', password: 'admin' })
    const first = await getAdminWork('work_draft_001')
    const second = await getAdminWork('work_draft_002')

    let releaseRequest!: () => void
    const requestGate = new Promise<void>((resolve) => {
      releaseRequest = resolve
    })
    server.use(
      http.get(/\/api\/admin\/works\/work_draft_001$/, () => HttpResponse.json(first)),
      http.get(/\/api\/admin\/works\/work_draft_002$/, async () => {
        await requestGate
        return HttpResponse.json(second)
      }),
    )

    const client = createQueryClient()
    client.setQueryData(queryKeys.admin.work('work_draft_001'), first)
    client.setQueryData(queryKeys.admin.work('work_draft_002'), second)
    const { router } = renderAt('/admin/works/work_draft_001/preview', client)

    expect(await screen.findByRole('heading', { name: '未命名草稿' })).toBeVisible()
    await act(async () => {
      await router.navigate('/admin/works/work_draft_002/preview')
    })

    expect(await screen.findByText('正在读取授权预览数据…')).toBeVisible()
    expect(screen.queryByText('未命名草稿')).toBeNull()
    expect(screen.queryByText('待补资源的草稿')).toBeNull()
    expect(screen.queryByRole('button', { name: '开始预览' })).toBeNull()

    await act(async () => {
      releaseRequest()
    })
    expect(await screen.findByRole('heading', { name: '待补资源的草稿' })).toBeVisible()
    expect(screen.queryByText('未命名草稿')).toBeNull()
    expect(screen.getByRole('heading', { name: '管理员预览' })).toHaveFocus()
  })

  it('成功进入预览后聚焦主标题，后台刷新不重复抢焦点', async () => {
    await login({ username: 'admin', password: 'admin' })
    const { client } = renderAt('/admin/works')
    const table = await screen.findByRole('table', { name: '管理作品列表' })
    const preview = within(table).getByRole('link', { name: '预览 院落模型' })
    preview.focus()
    fireEvent.click(preview)

    expect(await screen.findByRole('heading', { name: '管理员预览' })).toBeVisible()
    expect(await screen.findByRole('heading', { name: '院落模型' })).toBeVisible()
    const title = screen.getByRole('heading', { name: '管理员预览' })
    expect(title).toHaveFocus()

    const start = screen.getByRole('button', { name: '开始预览' })
    start.focus()
    await act(async () => {
      await client.refetchQueries({ queryKey: queryKeys.admin.work('work_demo_001') })
    })
    expect(await screen.findByRole('heading', { name: '院落模型' })).toBeVisible()
    expect(start).toHaveFocus()
  })

  it('预览数据 403 时保留管理路径并提示权限', async () => {
    await login({ username: 'admin', password: 'admin' })
    server.use(
      http.get(/\/api\/admin\/works\/work_draft_001$/, () =>
        HttpResponse.json(
          { error: { code: 'FORBIDDEN', message: '无权访问。' } },
          { status: 403 },
        ),
      ),
    )
    const { router } = renderAt('/admin/works/work_draft_001/preview')

    expect(await screen.findByText(/无权访问此管理路径/)).toBeVisible()
    expect(router.state.location.pathname).toBe('/admin/works/work_draft_001/preview')
    expect(screen.queryByText('未命名草稿')).toBeNull()
    expect(screen.queryByRole('button', { name: '开始预览' })).toBeNull()
  })

  it('认证失效时不展示已缓存的草稿内容，并清理管理缓存', async () => {
    await login({ username: 'admin', password: 'admin' })
    const { client } = renderAt('/admin/works/work_draft_001/preview')
    await screen.findByRole('heading', { name: '未命名草稿' })

    setMockScenario('auth-expired')
    await act(async () => {
      await client
        .fetchQuery({
          queryKey: queryKeys.admin.work('work_draft_001'),
          queryFn: () => getAdminWork('work_draft_001'),
          staleTime: 0,
        })
        .catch(() => {})
    })

    expect(await screen.findByRole('heading', { name: '管理员登录' })).toBeVisible()
    expect(screen.queryByText('未命名草稿')).toBeNull()
    expect(screen.queryByRole('button', { name: '开始预览' })).toBeNull()
    expect(
      client.getQueriesData({ queryKey: queryKeys.admin.all }).every(([, cached]) => cached === undefined),
    ).toBe(true)
  })
})
