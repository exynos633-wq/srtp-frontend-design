import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RouterProvider, createMemoryRouter } from 'react-router'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { HttpResponse, http } from 'msw'
import { getAdminWork, updateAdminWork } from '../../src/api/adminWorks'
import { login } from '../../src/api/auth'
import { queryKeys } from '../../src/api/queryKeys'
import { createQueryClient } from '../../src/app/queryClient'
import { routes } from '../../src/app/routes'
import { server } from '../../src/mocks/node'
import { resetMockState } from '../../src/mocks/scenario'

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
  const view = render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return { client, router, view }
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof Request) return input.url
  return input.href
}

function methodOf(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.method) return init.method
  if (input instanceof Request) return input.method
  return 'GET'
}

type FetchSpy = { mock: { calls: Array<[RequestInfo | URL, RequestInit?]> } }

function requests(
  spy: FetchSpy,
  method: string,
  pattern: RegExp,
): Array<[RequestInfo | URL, RequestInit?]> {
  return spy.mock.calls.filter(([input, init]) => {
    const callMethod = methodOf(input, init)
    return callMethod === method && pattern.test(urlOf(input))
  })
}

function bodyOf(call: [RequestInfo | URL, RequestInit?]): Record<string, unknown> {
  return JSON.parse(String(call[1]?.body ?? '{}')) as Record<string, unknown>
}

async function openEdit(id = 'work_demo_001') {
  await login({ username: 'admin', password: 'admin' })
  const result = renderAt(`/admin/works/${id}/edit`)
  const name = await screen.findByLabelText('作品名称')
  return { ...result, name }
}

describe('P11 新建与编辑表单', () => {
  it('空草稿可以保存：首次只 POST 一次，之后对同一 id PATCH', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await login({ username: 'admin', password: 'admin' })
    const { router } = renderAt('/admin/works/new')

    expect(await screen.findByRole('heading', { name: '新建作品' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))

    await waitFor(() =>
      expect(router.state.location.pathname).toMatch(/^\/admin\/works\/work_mock_\d+\/edit$/),
    )
    const createdId = router.state.location.pathname.split('/')[3]
    await screen.findByLabelText('作品名称')

    const posts = requests(fetchSpy, 'POST', /\/api\/admin\/works$/)
    expect(posts).toHaveLength(1)
    expect(bodyOf(posts[0])).toMatchObject({
      name: '',
      description: '',
      modelingNote: null,
      cityId: null,
    })
    expect(bodyOf(posts[0])).not.toHaveProperty('modelAssetId')
    expect(bodyOf(posts[0])).not.toHaveProperty('coverAssetId')

    fireEvent.change(screen.getByLabelText('作品名称'), { target: { value: '新草稿' } })
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))
    expect(await screen.findByText('已保存当前修改。')).toBeVisible()

    const patches = requests(fetchSpy, 'PATCH', new RegExp(`/api/admin/works/${createdId}$`))
    expect(patches).toHaveLength(1)
    expect(bodyOf(patches[0])).toEqual({ name: '新草稿' })
    expect(requests(fetchSpy, 'POST', /\/api\/admin\/works$/)).toHaveLength(1)
    // 保存成功进入既有编辑路由是内部跳转，不应再次询问离开。
    expect(confirmSpy).not.toHaveBeenCalled()
  })

  it('已发布保存遇到校验失败时聚焦首个字段，保留输入且不提前发布或下架', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const { name } = await openEdit()
    const description = await screen.findByLabelText('建筑介绍（纯文字）')
    expect(description).toHaveValue('传统院落建筑模型，用于展示空间布局与建筑形态。')
    expect(screen.getByRole('button', { name: '保存并更新公开内容' })).toBeVisible()

    fireEvent.change(description, { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: '保存并更新公开内容' }))

    expect(
      await screen.findByText('已发布作品必须保留名称、建筑介绍、封面与模型资源。'),
    ).toBeVisible()
    await waitFor(() => expect(description).toHaveFocus())
    expect(description).toHaveValue('')
    expect(name).toHaveValue('院落模型')
    expect(screen.getByText('已发布')).toBeVisible()
    expect(
      requests(fetchSpy, 'POST', /\/api\/admin\/works\/[^/]+\/(?:publish|unpublish)$/),
    ).toHaveLength(0)

    fireEvent.change(description, { target: { value: '恢复后的建筑介绍。' } })
    fireEvent.click(screen.getByRole('button', { name: '保存并更新公开内容' }))
    expect(await screen.findByText('已保存并更新公开内容。')).toBeVisible()
    expect(screen.getByText('已发布')).toBeVisible()
  })

  it('dirty 基于最近服务端快照：改回基线恢复 clean，保存成功更新基线', async () => {
    const { name, client } = await openEdit()
    client.setQueryData(queryKeys.works.list(), { items: [] })
    expect(screen.queryByText('有未保存的修改')).toBeNull()

    fireEvent.change(name, { target: { value: '临时修改' } })
    expect(screen.getByText('有未保存的修改')).toBeVisible()
    fireEvent.change(name, { target: { value: '院落模型' } })
    expect(screen.queryByText('有未保存的修改')).toBeNull()

    fireEvent.change(name, { target: { value: '保存后的名称' } })
    expect(screen.getByText('有未保存的修改')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '保存并更新公开内容' }))
    expect(await screen.findByText('已保存并更新公开内容。')).toBeVisible()

    expect(screen.queryByText('有未保存的修改')).toBeNull()
    expect(name).toHaveValue('保存后的名称')
    expect(client.getQueryState(queryKeys.works.list())?.isInvalidated).toBe(true)
  })

  it('PATCH 只发实际修改字段，并保留已有模型与封面绑定', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const { name } = await openEdit()
    expect(screen.getByText(/已绑定现有模型资源（GLB）/)).toBeVisible()

    fireEvent.change(name, { target: { value: '只改名称' } })
    fireEvent.click(screen.getByRole('button', { name: '保存并更新公开内容' }))
    expect(await screen.findByText('已保存并更新公开内容。')).toBeVisible()

    const patches = requests(fetchSpy, 'PATCH', /\/api\/admin\/works\/work_demo_001$/)
    expect(patches).toHaveLength(1)
    expect(bodyOf(patches[0])).toEqual({ name: '只改名称' })
    expect(bodyOf(patches[0])).not.toHaveProperty('cityId')
    expect(bodyOf(patches[0])).not.toHaveProperty('modelAssetId')
    expect(bodyOf(patches[0])).not.toHaveProperty('coverAssetId')
    expect(screen.getByText(/已绑定现有模型资源（GLB）/)).toBeVisible()
  })

  it('主动清除城市显式发送 cityId: null，并更新管理数据', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    await openEdit()
    const city = screen.getByLabelText('城市（选填）')
    expect(city).toHaveValue('110100')

    fireEvent.click(screen.getByRole('button', { name: '清除城市' }))
    expect(city).toHaveValue('')
    fireEvent.click(screen.getByRole('button', { name: '保存并更新公开内容' }))
    expect(await screen.findByText('已保存并更新公开内容。')).toBeVisible()

    const patches = requests(fetchSpy, 'PATCH', /\/api\/admin\/works\/work_demo_001$/)
    expect(bodyOf(patches[0])).toEqual({ cityId: null })
    await expect(getAdminWork('work_demo_001')).resolves.toMatchObject({ cityId: null })
  })

  it('切换省份会清掉不适用旧城，只选省份仍保存 null', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    await openEdit()
    const province = screen.getByLabelText('省份（选填）')
    const city = screen.getByLabelText('城市（选填）')

    await screen.findByRole('option', { name: '浙江省' })
    fireEvent.change(province, { target: { value: '330000' } })
    expect(city).toHaveValue('')
    await waitFor(() => expect(city).toBeEnabled())

    fireEvent.click(screen.getByRole('button', { name: '保存并更新公开内容' }))
    expect(await screen.findByText('已保存并更新公开内容。')).toBeVisible()

    const patches = requests(fetchSpy, 'PATCH', /\/api\/admin\/works\/work_demo_001$/)
    expect(bodyOf(patches[0])).toEqual({ cityId: null })
  })

  it('切换省份后选择新城市，PATCH 发送有效 cityId', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    await openEdit()
    const province = screen.getByLabelText('省份（选填）')
    const city = screen.getByLabelText('城市（选填）')
    await screen.findByRole('option', { name: '浙江省' })
    fireEvent.change(province, { target: { value: '330000' } })
    await waitFor(() => expect(city).toBeEnabled())
    fireEvent.change(city, { target: { value: '330100' } })
    fireEvent.click(screen.getByRole('button', { name: '保存并更新公开内容' }))
    expect(await screen.findByText('已保存并更新公开内容。')).toBeVisible()

    const patches = requests(fetchSpy, 'PATCH', /\/api\/admin\/works\/work_demo_001$/)
    expect(bodyOf(patches[0])).toEqual({ cityId: '330100' })
    await expect(getAdminWork('work_demo_001')).resolves.toMatchObject({
      cityId: '330100',
      city: { name: '杭州市' },
    })
  })

  it('省份字典失败保留已有城市，可手动重试且保存不误清空', async () => {
    server.use(
      http.get(/\/api\/admin\/provinces$/, () =>
        HttpResponse.json(
          { error: { code: 'INTERNAL_ERROR', message: '省份字典暂时不可用。' } },
          { status: 500 },
        ),
      ),
    )
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const { name } = await openEdit()
    const province = screen.getByLabelText('省份（选填）')
    const city = screen.getByLabelText('城市（选填）')

    expect(await screen.findByText(/省份字典读取失败，已保留当前选择/)).toBeVisible()
    expect(province).toHaveValue('110000')
    expect(within(province).getByRole('option', { name: '北京市' })).toBeInTheDocument()
    expect(city).toHaveValue('110100')

    fireEvent.change(name, { target: { value: '省份字典失败仍保存' } })
    fireEvent.click(screen.getByRole('button', { name: '保存并更新公开内容' }))
    expect(await screen.findByText('已保存并更新公开内容。')).toBeVisible()
    const patches = requests(fetchSpy, 'PATCH', /\/api\/admin\/works\/work_demo_001$/)
    expect(bodyOf(patches[0])).toEqual({ name: '省份字典失败仍保存' })

    server.resetHandlers()
    fireEvent.click(screen.getByRole('button', { name: '重试省份字典' }))
    await waitFor(() =>
      expect(screen.queryByText(/省份字典读取失败/)).not.toBeInTheDocument(),
    )
    expect(screen.getByLabelText('省份（选填）')).toHaveValue('110000')
  })

  it('新建时只选省份不提交城市编号，直辖市使用统一字典编号', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    await login({ username: 'admin', password: 'admin' })
    const { router } = renderAt('/admin/works/new')

    const province = await screen.findByLabelText('省份（选填）')
    const city = screen.getByLabelText('城市（选填）')
    await screen.findByRole('option', { name: '北京市' })
    fireEvent.change(province, { target: { value: '110000' } })
    await waitFor(() => expect(city).toBeEnabled())
    expect(city).toHaveValue('')

    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))
    await waitFor(() =>
      expect(router.state.location.pathname).toMatch(/^\/admin\/works\/work_mock_\d+\/edit$/),
    )
    const posts = requests(fetchSpy, 'POST', /\/api\/admin\/works$/)
    expect(bodyOf(posts[0])).toMatchObject({ cityId: null })

    // 返回新建路由再验证直辖市城市选择。
    await act(async () => {
      await router.navigate('/admin/works/new')
    })
    const provinceAgain = await screen.findByLabelText('省份（选填）')
    const cityAgain = screen.getByLabelText('城市（选填）')
    await screen.findByRole('option', { name: '北京市' })
    fireEvent.change(provinceAgain, { target: { value: '110000' } })
    await waitFor(() => expect(cityAgain).toBeEnabled())
    fireEvent.change(cityAgain, { target: { value: '110100' } })
    expect(cityAgain).toHaveValue('110100')

    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))
    await waitFor(() =>
      expect(router.state.location.pathname).toMatch(/^\/admin\/works\/work_mock_\d+\/edit$/),
    )
    const secondPost = requests(fetchSpy, 'POST', /\/api\/admin\/works$/)[1]
    expect(bodyOf(secondPost)).toMatchObject({ cityId: '110100' })
  })

  it('城市字典失败保留已有 cityId 与展示名称，可手动重试，保存不误清空', async () => {
    server.use(
      http.get(/\/api\/admin\/cities(?:\?.*)?$/, () =>
        HttpResponse.json(
          { error: { code: 'INTERNAL_ERROR', message: '城市字典暂时不可用。' } },
          { status: 500 },
        ),
      ),
    )
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const { name } = await openEdit()
    const city = screen.getByLabelText('城市（选填）')

    expect(await screen.findByText(/城市字典读取失败，已保留现有城市/)).toBeVisible()
    expect(city).toHaveValue('110100')
    expect(within(city).getByRole('option', { name: '北京市' })).toBeInTheDocument()

    fireEvent.change(name, { target: { value: '字典失败仍保存' } })
    fireEvent.click(screen.getByRole('button', { name: '保存并更新公开内容' }))
    expect(await screen.findByText('已保存并更新公开内容。')).toBeVisible()

    const patches = requests(fetchSpy, 'PATCH', /\/api\/admin\/works\/work_demo_001$/)
    expect(bodyOf(patches[0])).toEqual({ name: '字典失败仍保存' })
    expect(bodyOf(patches[0])).not.toHaveProperty('cityId')
    await expect(getAdminWork('work_demo_001')).resolves.toMatchObject({ cityId: '110100' })

    server.resetHandlers()
    fireEvent.click(screen.getByRole('button', { name: '重试城市字典' }))
    await waitFor(() =>
      expect(screen.queryByText(/城市字典读取失败/)).not.toBeInTheDocument(),
    )
  })

  it('未知城市编号由服务端字段错误返回，保留选择并聚焦城市字段', async () => {
    await openEdit()
    server.use(
      http.patch(/\/api\/admin\/works\/work_demo_001$/, () =>
        HttpResponse.json(
          {
            error: {
              code: 'VALIDATION_FAILED',
              message: '城市不存在。',
              fields: { cityId: '城市不存在或已停用。' },
            },
          },
          { status: 422 },
        ),
      ),
    )

    const province = screen.getByLabelText('省份（选填）')
    const city = screen.getByLabelText('城市（选填）')
    await screen.findByRole('option', { name: '浙江省' })
    fireEvent.change(province, { target: { value: '330000' } })
    await waitFor(() => expect(city).toBeEnabled())
    fireEvent.change(city, { target: { value: '330100' } })
    fireEvent.click(screen.getByRole('button', { name: '保存并更新公开内容' }))

    expect(await screen.findByText('城市不存在或已停用。')).toBeVisible()
    await waitFor(() => expect(city).toHaveFocus())
    expect(city).toHaveValue('330100')
  })

  it('保存失败保留输入，正常修改后可继续保存', async () => {
    const { name } = await openEdit()
    const description = screen.getByLabelText('建筑介绍（纯文字）')
    server.use(
      http.patch(/\/api\/admin\/works\/work_demo_001$/, () =>
        HttpResponse.json(
          { error: { code: 'INTERNAL_ERROR', message: '服务器暂时无法保存。' } },
          { status: 500 },
        ),
      ),
    )

    fireEvent.change(name, { target: { value: '失败前的名称' } })
    fireEvent.change(description, { target: { value: '失败前的介绍' } })
    fireEvent.click(screen.getByRole('button', { name: '保存并更新公开内容' }))

    expect(await screen.findByText('服务器暂时无法保存。')).toBeVisible()
    expect(name).toHaveValue('失败前的名称')
    expect(description).toHaveValue('失败前的介绍')
    expect(screen.getByText('有未保存的修改')).toBeVisible()

    fireEvent.change(description, { target: { value: '失败前的介绍（继续编辑）' } })
    expect(screen.queryByText('服务器暂时无法保存。')).toBeNull()
  })

  it('建筑介绍中的 HTML 按纯文字处理，且不自动请求模型或创建预览会话', async () => {
    await login({ username: 'admin', password: 'admin' })
    await updateAdminWork('work_demo_001', {
      description: '<b>粗体</b>\n第二行',
    })
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    const { view } = renderAt('/admin/works/work_demo_001/edit')
    const description = await screen.findByLabelText('建筑介绍（纯文字）')
    expect(description).toHaveValue('<b>粗体</b>\n第二行')
    expect(view.container.querySelector('b')).toBeNull()
    expect(view.container.querySelector('strong')).toBeNull()

    const requested = fetchSpy.mock.calls.map(([input]) => urlOf(input as RequestInfo | URL))
    expect(requested.some((url) => /\.(glb|ply)(\?|$)/.test(url))).toBe(false)
    expect(requested.some((url) => url.includes('preview-sessions'))).toBe(false)
  })

  it('多行 Enter 只换行，不重复提交，保存内容保留换行', async () => {
    const user = userEvent.setup()
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    await login({ username: 'admin', password: 'admin' })
    const { router } = renderAt('/admin/works/new')

    const description = await screen.findByLabelText('建筑介绍（纯文字）')
    await user.click(description)
    await user.type(description, '第一行{Enter}第二行')
    expect(description).toHaveValue('第一行\n第二行')

    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))
    await waitFor(() =>
      expect(router.state.location.pathname).toMatch(/^\/admin\/works\/work_mock_\d+\/edit$/),
    )
    const posts = requests(fetchSpy, 'POST', /\/api\/admin\/works$/)
    expect(posts).toHaveLength(1)
    expect(bodyOf(posts[0])).toMatchObject({ description: '第一行\n第二行' })
  })

  it('站内返回、导航、预览均需确认；拒绝退出时零 logout 请求且字段保留', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const { router, name } = await openEdit()
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    fireEvent.change(name, { target: { value: '未保存的名称' } })

    fireEvent.click(screen.getByRole('link', { name: '返回作品管理' }))
    await waitFor(() => expect(confirmSpy).toHaveBeenCalledTimes(1))
    expect(router.state.location.pathname).toBe('/admin/works/work_demo_001/edit')
    expect(name).toHaveValue('未保存的名称')

    const nav = screen.getByRole('navigation', { name: '管理后台导航' })
    fireEvent.click(within(nav).getByRole('link', { name: '作品管理' }))
    await waitFor(() => expect(confirmSpy).toHaveBeenCalledTimes(2))
    expect(router.state.location.pathname).toBe('/admin/works/work_demo_001/edit')

    fireEvent.click(screen.getByRole('link', { name: '管理员预览' }))
    await waitFor(() => expect(confirmSpy).toHaveBeenCalledTimes(3))
    expect(router.state.location.pathname).toBe('/admin/works/work_demo_001/edit')

    fireEvent.click(screen.getByRole('button', { name: '退出登录' }))
    await waitFor(() => expect(confirmSpy).toHaveBeenCalledTimes(4))
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    expect(requests(fetchSpy, 'POST', /\/api\/auth\/logout$/)).toHaveLength(0)
    expect(name).toHaveValue('未保存的名称')
    expect(screen.getByRole('heading', { name: '编辑作品' })).toBeVisible()

    confirmSpy.mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: '退出登录' }))
    expect(await screen.findByRole('heading', { name: '管理员登录' })).toBeVisible()
    expect(requests(fetchSpy, 'POST', /\/api\/auth\/logout$/)).toHaveLength(1)
  })

  it('编辑读取等待本次确认，首次初始化后后台刷新不覆盖未保存输入', async () => {
    await login({ username: 'admin', password: 'admin' })
    const cached = await getAdminWork('work_demo_001')
    let releaseRequest!: () => void
    const requestGate = new Promise<void>((resolve) => {
      releaseRequest = resolve
    })
    server.use(
      http.get(/\/api\/admin\/works\/work_demo_001$/, async () => {
        await requestGate
        return HttpResponse.json(cached)
      }),
    )

    const client = createQueryClient()
    client.setQueryData(queryKeys.admin.work('work_demo_001'), {
      ...cached,
      name: '缓存中的旧名称',
    })
    const { router } = renderAt('/admin/works/work_demo_001/edit', client)

    expect(await screen.findByRole('heading', { name: '编辑作品' })).toBeVisible()
    expect(screen.getByText('正在读取作品数据…')).toBeVisible()
    expect(screen.queryByLabelText('作品名称')).toBeNull()

    await act(async () => {
      releaseRequest()
    })
    const name = await screen.findByLabelText('作品名称')
    expect(name).toHaveValue('院落模型')
    expect(router.state.location.pathname).toBe('/admin/works/work_demo_001/edit')

    fireEvent.change(name, { target: { value: '本地未保存名称' } })
    await act(async () => {
      await client.refetchQueries({ queryKey: queryKeys.admin.work('work_demo_001') })
    })
    expect(name).toHaveValue('本地未保存名称')
  })

  it('首次确认后后台刷新失败不撤掉表单或覆盖未保存输入', async () => {
    const { name, client } = await openEdit()
    const cached = await getAdminWork('work_demo_001')
    fireEvent.change(name, { target: { value: '后台刷新期间未保存' } })

    server.use(
      http.get(/\/api\/admin\/works\/work_demo_001$/, () =>
        HttpResponse.json(
          { error: { code: 'INTERNAL_ERROR', message: '后台刷新失败。' } },
          { status: 500 },
        ),
      ),
    )
    await act(async () => {
      await client.refetchQueries({
        queryKey: queryKeys.admin.work('work_demo_001'),
        type: 'all',
      })
      client.setQueryData(queryKeys.admin.work('work_demo_001'), {
        ...cached,
        name: '后台旧名称',
      })
    })

    expect(screen.getByLabelText('作品名称')).toHaveValue('后台刷新期间未保存')
    expect(screen.queryByText('后台旧名称')).toBeNull()
    expect(screen.queryByText('作品读取失败')).toBeNull()
  })

  it('保存请求迟到完成时不覆盖另一件作品', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { name, router } = await openEdit()
    const firstWork = await getAdminWork('work_demo_001')
    let releaseRequest!: () => void
    const requestGate = new Promise<void>((resolve) => {
      releaseRequest = resolve
    })
    server.use(
      http.patch(/\/api\/admin\/works\/work_demo_001$/, async () => {
        await requestGate
        return HttpResponse.json({ ...firstWork, name: '迟到的保存结果' })
      }),
    )

    fireEvent.change(name, { target: { value: '保存中名称' } })
    fireEvent.click(screen.getByRole('button', { name: '保存并更新公开内容' }))
    await screen.findByRole('button', { name: '正在保存…' })

    await act(async () => {
      await router.navigate('/admin/works/work_demo_002/edit')
    })
    const secondName = await screen.findByLabelText('作品名称')
    expect(secondName).toHaveValue('长城模型')

    await act(async () => {
      releaseRequest()
      await new Promise((resolve) => setTimeout(resolve, 60))
    })
    expect(screen.getByLabelText('作品名称')).toHaveValue('长城模型')
    expect(screen.queryByText('迟到的保存结果')).toBeNull()
  })

  it('新建页标题获得焦点', async () => {
    await login({ username: 'admin', password: 'admin' })
    renderAt('/admin/works/new')
    expect(await screen.findByRole('heading', { name: '新建作品' })).toHaveFocus()
  })

  it('编辑页确认后标题获得焦点', async () => {
    const { router } = await openEdit()
    expect(screen.getByRole('heading', { name: '编辑作品' })).toHaveFocus()
    expect(router.state.location.pathname).toBe('/admin/works/work_demo_001/edit')
  })

  it('编辑读取失败时聚焦错误标题，且不展示缓存草稿', async () => {
    await login({ username: 'admin', password: 'admin' })
    const cached = await getAdminWork('work_demo_001')
    const client = createQueryClient()
    client.setQueryData(queryKeys.admin.work('work_demo_001'), cached)
    server.use(
      http.get(/\/api\/admin\/works\/work_demo_001$/, () =>
        HttpResponse.json(
          { error: { code: 'INTERNAL_ERROR', message: '读取作品失败。' } },
          { status: 500 },
        ),
      ),
    )

    renderAt('/admin/works/work_demo_001/edit', client)
    const heading = await screen.findByRole('heading', { name: '作品读取失败' })
    await waitFor(() => expect(heading).toHaveFocus())
    expect(screen.queryByLabelText('作品名称')).toBeNull()
  })

  it('保存收到 401 时沿用认证失效边界并清理管理缓存', async () => {
    const { name, client } = await openEdit()
    server.use(
      http.patch(/\/api\/admin\/works\/work_demo_001$/, () =>
        HttpResponse.json(
          { error: { code: 'UNAUTHENTICATED', message: '登录已失效，请重新登录。' } },
          { status: 401 },
        ),
      ),
    )

    fireEvent.change(name, { target: { value: '不应保留的草稿' } })
    fireEvent.click(screen.getByRole('button', { name: '保存并更新公开内容' }))
    expect(await screen.findByRole('heading', { name: '管理员登录' })).toBeVisible()

    expect(
      client.getQueriesData({ queryKey: queryKeys.admin.all }).every(([, value]) => value === undefined),
    ).toBe(true)
    expect(
      client
        .getQueriesData({ queryKey: queryKeys.dictionary.all })
        .every(([, value]) => value === undefined),
    ).toBe(true)
  })

  it('保存收到 403 时保留路径、清理缓存并交给权限边界反馈', async () => {
    const { name, client, router } = await openEdit()
    server.use(
      http.patch(/\/api\/admin\/works\/work_demo_001$/, () =>
        HttpResponse.json(
          { error: { code: 'FORBIDDEN', message: '无权保存该作品。' } },
          { status: 403 },
        ),
      ),
    )

    fireEvent.change(name, { target: { value: '不应保留的草稿' } })
    fireEvent.click(screen.getByRole('button', { name: '保存并更新公开内容' }))
    expect(await screen.findByText(/无权访问此管理路径/)).toBeVisible()
    expect(router.state.location.pathname).toBe('/admin/works/work_demo_001/edit')
    expect(
      client.getQueriesData({ queryKey: queryKeys.admin.all }).every(([, value]) => value === undefined),
    ).toBe(true)
  })

  it('确认退出后、logout 未完成时其他导航仍需确认，取消后保留字段', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { name, router } = await openEdit()
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    fireEvent.change(name, { target: { value: '退出等待中的未保存名称' } })

    let releaseLogout!: () => void
    const logoutGate = new Promise<void>((resolve) => {
      releaseLogout = resolve
    })
    server.use(
      http.post(/\/api\/auth\/logout$/, async () => {
        await logoutGate
        return new HttpResponse(null, { status: 204 })
      }),
    )

    fireEvent.click(screen.getByRole('button', { name: '退出登录' }))
    expect(await screen.findByRole('button', { name: '正在退出…' })).toBeDisabled()
    const outlet = document.querySelector('[data-admin-outlet]')
    expect(outlet).not.toBeNull()
    expect(outlet).toHaveAttribute('inert')

    confirmSpy.mockReturnValue(false)
    const nav = screen.getByRole('navigation', { name: '管理后台导航' })
    fireEvent.click(within(nav).getByRole('link', { name: '作品管理' }))
    await waitFor(() => expect(confirmSpy).toHaveBeenCalledTimes(2))
    expect(router.state.location.pathname).toBe('/admin/works/work_demo_001/edit')
    expect(name).toHaveValue('退出等待中的未保存名称')

    await act(async () => {
      releaseLogout()
      await new Promise((resolve) => setTimeout(resolve, 40))
    })
    expect(await screen.findByRole('heading', { name: '管理员登录' })).toBeVisible()
    expect(requests(fetchSpy, 'POST', /\/api\/auth\/logout$/)).toHaveLength(1)
  })

  it('延迟退出失败后离开保护仍有效，取消导航保留字段并可继续编辑', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { name, router } = await openEdit()
    fireEvent.change(name, { target: { value: '退出失败后的未保存名称' } })

    let releaseLogout!: () => void
    const logoutGate = new Promise<void>((resolve) => {
      releaseLogout = resolve
    })
    server.use(
      http.post(/\/api\/auth\/logout$/, async () => {
        await logoutGate
        return new HttpResponse(null, { status: 503 })
      }),
    )

    fireEvent.click(screen.getByRole('button', { name: '退出登录' }))
    await screen.findByRole('button', { name: '正在退出…' })
    const outlet = document.querySelector('[data-admin-outlet]')
    expect(outlet).toHaveAttribute('inert')

    confirmSpy.mockReturnValue(false)
    const nav = screen.getByRole('navigation', { name: '管理后台导航' })
    fireEvent.click(within(nav).getByRole('link', { name: '作品管理' }))
    await waitFor(() => expect(confirmSpy).toHaveBeenCalledTimes(2))
    expect(router.state.location.pathname).toBe('/admin/works/work_demo_001/edit')
    expect(name).toHaveValue('退出失败后的未保存名称')

    await act(async () => {
      releaseLogout()
      await new Promise((resolve) => setTimeout(resolve, 40))
    })
    expect(await screen.findByText(/退出未完成/)).toBeVisible()
    expect(document.querySelector('[data-admin-outlet]')).not.toHaveAttribute('inert')
    expect(name).toHaveValue('退出失败后的未保存名称')

    fireEvent.click(within(nav).getByRole('link', { name: '作品管理' }))
    await waitFor(() => expect(confirmSpy).toHaveBeenCalledTimes(3))
    expect(router.state.location.pathname).toBe('/admin/works/work_demo_001/edit')
    expect(name).toHaveValue('退出失败后的未保存名称')
  })

  it('退出后迟到的保存结果不能恢复任何敏感管理缓存', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { name, client } = await openEdit()
    const cached = await getAdminWork('work_demo_001')
    let releaseRequest!: () => void
    const requestGate = new Promise<void>((resolve) => {
      releaseRequest = resolve
    })
    server.use(
      http.patch(/\/api\/admin\/works\/work_demo_001$/, async () => {
        await requestGate
        return HttpResponse.json({ ...cached, name: '退出后迟到的保存' })
      }),
    )

    fireEvent.change(name, { target: { value: '保存中退出' } })
    fireEvent.click(screen.getByRole('button', { name: '保存并更新公开内容' }))
    await screen.findByRole('button', { name: '正在保存…' })

    fireEvent.click(screen.getByRole('button', { name: '退出登录' }))
    expect(await screen.findByRole('heading', { name: '管理员登录' })).toBeVisible()
    expect(
      client.getQueriesData({ queryKey: queryKeys.admin.all }).every(([, value]) => value === undefined),
    ).toBe(true)

    await act(async () => {
      releaseRequest()
      await new Promise((resolve) => setTimeout(resolve, 80))
    })
    expect(
      client.getQueriesData({ queryKey: queryKeys.admin.all }).every(([, value]) => value === undefined),
    ).toBe(true)
    expect(client.getQueryData(queryKeys.admin.work('work_demo_001'))).toBeUndefined()
  })

  it('发布与下架边界仍明确：表单只保存，不出现可用的发布或下架动作', async () => {
    await login({ username: 'admin', password: 'admin' })
    renderAt('/admin/works/work_draft_001/edit')
    await screen.findByLabelText('作品名称')

    expect(screen.getByRole('button', { name: '保存草稿' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: /^发布/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /下架/ })).toBeNull()
    expect(screen.getByText(/发布与下架入口暂不可用/)).toBeVisible()
    expect(screen.getByText('模型资源')).toBeVisible()
    expect(screen.queryByLabelText(/选择模型文件/)).toBeNull()
    expect(screen.queryByLabelText(/选择封面/)).toBeNull()
  })
})
