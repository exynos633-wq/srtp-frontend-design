import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { RouterProvider, createMemoryRouter } from 'react-router'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { HttpResponse, http } from 'msw'
import {
  createAdminWork,
  getAdminWork,
} from '../../src/api/adminWorks'
import { login } from '../../src/api/auth'
import { getPublicWork } from '../../src/api/works'
import { queryKeys } from '../../src/api/queryKeys'
import { createQueryClient } from '../../src/app/queryClient'
import { routes } from '../../src/app/routes'
import { server } from '../../src/mocks/node'
import { resetMockState } from '../../src/mocks/scenario'

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
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

async function createDraftWithAssets() {
  await login({ username: 'admin', password: 'admin' })
  return createAdminWork({
    name: '发布回归草稿',
    description: '用于发布与下架回归。',
    modelAssetId: 'asset_demo_001_model',
    coverAssetId: 'asset_demo_001_cover',
  })
}

async function openEdit(id: string) {
  const result = renderAt(`/admin/works/${id}/edit`)
  await screen.findByLabelText('作品名称')
  return result
}

function seedCaches(client: QueryClient) {
  client.setQueryData(queryKeys.works.list(), { items: [] })
  client.setQueryData(queryKeys.globe.cities(), { items: [] })
  client.setQueryData(queryKeys.admin.works(), { items: [] })
}

describe('P13 发布、下架与公开生命周期', () => {
  it('缺必填发布返回 422，聚焦首个资源错误并保持草稿', async () => {
    await login({ username: 'admin', password: 'admin' })
    renderAt('/admin/works/work_draft_002/edit')
    await screen.findByLabelText('作品名称')

    fireEvent.click(screen.getByRole('button', { name: '发布作品' }))
    expect(await screen.findByText('发布前请补全必填内容。')).toBeVisible()
    await waitFor(() =>
      expect(document.getElementById('work-model-asset')).toHaveFocus(),
    )
    expect(screen.getByText('草稿')).toBeVisible()
    expect(screen.getByRole('button', { name: '发布作品' })).toBeEnabled()
  })

  it('dirty 时发布需先保存；保存后手动发布才更新公开状态与缓存', async () => {
    const draft = await createDraftWithAssets()
    const { client } = await openEdit(draft.id)
    seedCaches(client)

    fireEvent.change(screen.getByLabelText('作品名称'), {
      target: { value: '保存后再发布' },
    })
    const publish = screen.getByRole('button', { name: '发布作品' })
    expect(publish).toBeDisabled()
    expect(screen.getByText(/发布前请先保存当前修改/)).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))
    expect(await screen.findByText('已保存当前修改。')).toBeVisible()
    expect(publish).toBeEnabled()

    fireEvent.click(publish)
    expect(
      await screen.findByText('已发布作品，公开目录和城市列表已更新。'),
    ).toBeVisible()
    expect(await getAdminWork(draft.id)).toMatchObject({
      status: 'published',
      name: '保存后再发布',
      cityId: null,
    })
    expect(client.getQueryState(queryKeys.works.list())?.isInvalidated).toBe(true)
    expect(client.getQueryState(queryKeys.globe.cities())?.isInvalidated).toBe(true)
    expect(client.getQueryState(queryKeys.admin.works())?.isInvalidated).toBe(true)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '下架作品' })).toHaveFocus(),
    )
  })

  it('未保存新作品只有保存草稿后才有可用的发布入口', async () => {
    await login({ username: 'admin', password: 'admin' })
    const { router } = renderAt('/admin/works/new')
    await screen.findByRole('heading', { name: '新建作品' })

    const newPublish = screen.getByRole('button', { name: '发布作品' })
    expect(newPublish).toBeDisabled()
    expect(newPublish).toHaveAttribute('title', '请先保存草稿，再进入编辑页发布')

    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))
    await waitFor(() =>
      expect(router.state.location.pathname).toMatch(/^\/admin\/works\/work_mock_\d+\/edit$/),
    )
    await screen.findByLabelText('作品名称')
    expect(screen.getByRole('button', { name: '发布作品' })).toBeEnabled()
  })

  it('下架需要确认；取消不改变状态，确认后公开 404、缓存失效且焦点回到发布按钮', async () => {
    await login({ username: 'admin', password: 'admin' })
    const { client } = await openEdit('work_demo_001')
    seedCaches(client)
    const confirmSpy = vi
      .spyOn(window, 'confirm')
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true)

    fireEvent.click(screen.getByRole('button', { name: '下架作品' }))
    expect(confirmSpy).toHaveBeenCalledTimes(1)
    expect(screen.getByText('已发布')).toBeVisible()
    expect(screen.getByRole('button', { name: '下架作品' })).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: '下架作品' }))
    expect(await screen.findByText('已下架作品，公开目录和城市列表已更新。')).toBeVisible()
    expect(screen.getByText('已下架')).toBeVisible()
    await expect(getPublicWork('work_demo_001')).rejects.toMatchObject({ status: 404 })
    expect(client.getQueryState(queryKeys.works.list())?.isInvalidated).toBe(true)
    expect(client.getQueryState(queryKeys.globe.cities())?.isInvalidated).toBe(true)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '发布作品' })).toHaveFocus(),
    )
  })

  it('发布 pending 期间重复点击只发一次请求并禁用操作', async () => {
    const draft = await createDraftWithAssets()
    let releasePublish!: () => void
    const publishGate = new Promise<void>((resolve) => {
      releasePublish = resolve
    })
    let publishRequests = 0
    server.use(
      http.post(/\/api\/admin\/works\/[^/]+\/publish$/, async () => {
        publishRequests += 1
        await publishGate
        return HttpResponse.json({
          ...draft,
          status: 'published',
          publishedAt: '2026-10-20T10:00:00+08:00',
          updatedAt: '2026-10-20T10:00:00+08:00',
        })
      }),
    )

    await openEdit(draft.id)
    const publish = screen.getByRole('button', { name: '发布作品' })
    fireEvent.click(publish)
    fireEvent.click(publish)
    expect(await screen.findByRole('button', { name: '正在发布…' })).toBeDisabled()
    expect(publishRequests).toBe(1)

    await act(async () => {
      releasePublish()
      await new Promise((resolve) => setTimeout(resolve, 30))
    })
    expect(await screen.findByText('已发布作品，公开目录和城市列表已更新。')).toBeVisible()
    expect(publishRequests).toBe(1)
  })

  it('发布 401 走统一认证清理并撤除私有管理缓存', async () => {
    const draft = await createDraftWithAssets()
    const { client } = await openEdit(draft.id)
    server.use(
      http.post(/\/api\/admin\/works\/[^/]+\/publish$/, () =>
        HttpResponse.json(
          { error: { code: 'UNAUTHENTICATED', message: '登录已失效，请重新登录。' } },
          { status: 401 },
        ),
      ),
    )

    fireEvent.click(screen.getByRole('button', { name: '发布作品' }))
    expect(await screen.findByRole('heading', { name: '管理员登录' })).toBeVisible()
    expect(
      client.getQueriesData({ queryKey: queryKeys.admin.all }).every(([, value]) => value === undefined),
    ).toBe(true)
  })

  it('退出后迟到的发布结果不能回填管理缓存', async () => {
    const draft = await createDraftWithAssets()
    let releasePublish!: () => void
    const publishGate = new Promise<void>((resolve) => {
      releasePublish = resolve
    })
    server.use(
      http.post(/\/api\/admin\/works\/[^/]+\/publish$/, async () => {
        await publishGate
        return HttpResponse.json({
          ...draft,
          status: 'published',
          publishedAt: '2026-10-20T10:00:00+08:00',
          updatedAt: '2026-10-20T10:00:00+08:00',
        })
      }),
    )

    const { client } = await openEdit(draft.id)
    client.setQueryData(queryKeys.works.list(), { items: [] })
    client.setQueryData(queryKeys.globe.cities(), { items: [] })
    fireEvent.click(screen.getByRole('button', { name: '发布作品' }))
    await screen.findByRole('button', { name: '正在发布…' })
    fireEvent.click(screen.getByRole('button', { name: '退出登录' }))
    expect(await screen.findByRole('heading', { name: '管理员登录' })).toBeVisible()

    await act(async () => {
      releasePublish()
      await new Promise((resolve) => setTimeout(resolve, 40))
    })
    expect(client.getQueryState(queryKeys.works.list())?.isInvalidated).toBe(true)
    expect(client.getQueryState(queryKeys.globe.cities())?.isInvalidated).toBe(true)
    expect(
      client.getQueriesData({ queryKey: queryKeys.admin.all }).every(([, value]) => value === undefined),
    ).toBe(true)
  })

  it('保存迟到成功在退出后仍失效公开缓存，不回填私有内容', async () => {
    await login({ username: 'admin', password: 'admin' })
    const before = await getAdminWork('work_demo_001')
    let releaseSave!: () => void
    const saveGate = new Promise<void>((resolve) => {
      releaseSave = resolve
    })
    server.use(
      http.patch(/\/api\/admin\/works\/work_demo_001$/, async () => {
        await saveGate
        return HttpResponse.json({
          ...before,
          name: '迟到保存',
          updatedAt: '2026-10-20T10:00:00+08:00',
        })
      }),
    )
    const { client } = await openEdit('work_demo_001')
    client.setQueryData(queryKeys.works.list(), { items: [] })
    client.setQueryData(queryKeys.globe.cities(), { items: [] })
    fireEvent.change(screen.getByLabelText('作品名称'), { target: { value: '迟到保存' } })
    fireEvent.click(screen.getByRole('button', { name: '保存并更新公开内容' }))
    await screen.findByRole('button', { name: '正在保存…' })

    vi.spyOn(window, 'confirm').mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: '退出登录' }))
    expect(await screen.findByRole('heading', { name: '管理员登录' })).toBeVisible()

    await act(async () => {
      releaseSave()
      await new Promise((resolve) => setTimeout(resolve, 40))
    })
    expect(client.getQueryState(queryKeys.works.list())?.isInvalidated).toBe(true)
    expect(client.getQueryState(queryKeys.globe.cities())?.isInvalidated).toBe(true)
    expect(
      client.getQueriesData({ queryKey: queryKeys.admin.all }).every(([, value]) => value === undefined),
    ).toBe(true)
  })

  it('保存城市变更后失效管理、详情、目录与地球缓存', async () => {
    const draft = await createDraftWithAssets()
    const { client } = await openEdit(draft.id)
    client.setQueryData(queryKeys.works.detail(draft.id), { id: draft.id })
    client.setQueryData(queryKeys.works.list(), { items: [] })
    client.setQueryData(queryKeys.globe.cities(), { items: [] })
    client.setQueryData(queryKeys.globe.cityWorks('110100'), {
      city: { id: '110100', name: '北京市', province: { id: '110000', name: '北京市' } },
      items: [],
    })
    client.setQueryData(queryKeys.admin.works(), { items: [] })

    const province = screen.getByLabelText('省份（选填）')
    const city = screen.getByLabelText('城市（选填）')
    await screen.findByRole('option', { name: '北京市' })
    fireEvent.change(province, { target: { value: '110000' } })
    await waitFor(() => expect(city).toBeEnabled())
    fireEvent.change(city, { target: { value: '110100' } })

    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))
    expect(await screen.findByText('已保存当前修改。')).toBeVisible()

    for (const queryKey of [
      queryKeys.works.list(),
      queryKeys.works.detail(draft.id),
      queryKeys.globe.cities(),
      queryKeys.globe.cityWorks('110100'),
      queryKeys.admin.works(),
    ]) {
      expect(client.getQueryState(queryKey)?.isInvalidated).toBe(true)
    }
  })

  it('带未保存修改下架不会覆盖字段，焦点落到可用的保存控制', async () => {
    await login({ username: 'admin', password: 'admin' })
    await openEdit('work_demo_001')
    const name = screen.getByLabelText('作品名称')
    fireEvent.change(name, { target: { value: '下架不丢输入' } })
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    fireEvent.click(screen.getByRole('button', { name: '下架作品' }))
    expect(await screen.findByText('已下架作品，公开目录和城市列表已更新。')).toBeVisible()
    expect(name).toHaveValue('下架不丢输入')
    expect(screen.getByText('已下架')).toBeVisible()
    expect(screen.getByRole('button', { name: '发布作品' })).toBeDisabled()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '保存修改' })).toHaveFocus(),
    )
  })

})
