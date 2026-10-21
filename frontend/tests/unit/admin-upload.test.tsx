import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { RouterProvider, createMemoryRouter } from 'react-router'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  createAdminWork,
  getAdminWork,
  unpublishAdminWork,
} from '../../src/api/adminWorks'
import { login } from '../../src/api/auth'
import { createQueryClient } from '../../src/app/queryClient'
import { routes } from '../../src/app/routes'
import { markMocksActive } from '../../src/app/mocksStatus'
import { server } from '../../src/mocks/node'
import { resetMockState, setMockScenario } from '../../src/mocks/scenario'

beforeAll(() => {
  server.listen({ onUnhandledFrame: 'error' })
  markMocksActive()
})
afterEach(() => {
  server.resetHandlers()
  vi.restoreAllMocks()
  resetMockState()
})
afterAll(() => server.close())

const originalCreate = URL.createObjectURL
const originalRevoke = URL.revokeObjectURL
const createObjectUrl = vi.fn()
const revokeObjectUrl = vi.fn()

beforeAll(() => {
  let counter = 0
  createObjectUrl.mockImplementation(() => `blob:p12-cover-${++counter}`)
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: createObjectUrl,
  })
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: revokeObjectUrl,
  })
})

afterAll(() => {
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: originalCreate,
  })
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: originalRevoke,
  })
})

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
    return methodOf(input, init) === method && pattern.test(urlOf(input))
  })
}

function bodyOf(call: [RequestInfo | URL, RequestInit?]): Record<string, unknown> {
  return JSON.parse(String(call[1]?.body ?? '{}')) as Record<string, unknown>
}

function uploadFile(label: string, file: File) {
  const input = screen.getByLabelText(label)
  fireEvent.change(input, { target: { files: [file] } })
}

async function createDraftWithAssets() {
  await login({ username: 'admin', password: 'admin' })
  return createAdminWork({
    name: '资源草稿',
    description: '用于 P12 资源绑定回归。',
    modelAssetId: 'asset_demo_001_model',
    coverAssetId: 'asset_demo_001_cover',
  })
}

async function openEdit(id: string) {
  const result = renderAt(`/admin/works/${id}/edit`)
  await screen.findByLabelText('作品名称')
  return result
}

describe('P12 上传模拟 UI', () => {
  it('已发布作品只允许改资料，资源替换入口保持关闭', async () => {
    await login({ username: 'admin', password: 'admin' })
    renderAt('/admin/works/work_demo_001/edit')
    await screen.findByLabelText('作品名称')

    expect(
      screen.getAllByText('已发布作品不可直接替换模型或封面，请先下架。'),
    ).toHaveLength(2)
    expect(screen.queryByLabelText('选择模型文件')).toBeNull()
    expect(screen.queryByLabelText('选择封面文件')).toBeNull()

    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    fireEvent.change(screen.getByLabelText('作品名称'), {
      target: { value: '只改资料' },
    })
    fireEvent.click(screen.getByRole('button', { name: '保存并更新公开内容' }))
    expect(await screen.findByText('已保存并更新公开内容。')).toBeVisible()
    const patches = requests(fetchSpy, 'PATCH', /\/api\/admin\/works\/work_demo_001$/)
    expect(bodyOf(patches[0])).toEqual({ name: '只改资料' })
    expect(bodyOf(patches[0])).not.toHaveProperty('modelAssetId')
    expect(bodyOf(patches[0])).not.toHaveProperty('coverAssetId')
  })

  it('模型成功、封面失败互不影响；失败保留旧绑定，重试后一起保存', async () => {
    const draft = await createDraftWithAssets()
    setMockScenario('upload-cover-failure')
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    await openEdit(draft.id)

    expect(screen.getByText('现有模型资源（GLB）')).toBeVisible()
    expect(screen.getByAltText('已保存封面')).toBeVisible()

    uploadFile(
      '选择模型文件',
      new File(['model'], 'courtyard.glb', { type: 'model/gltf-binary' }),
    )
    uploadFile(
      '选择封面文件',
      new File(['cover'], 'cover.png', { type: 'image/png' }),
    )

    const modelField = document.getElementById('work-model-asset')
    const coverField = document.getElementById('work-cover-asset')
    expect(modelField).not.toBeNull()
    expect(coverField).not.toBeNull()
    await within(modelField!).findByText('模拟验证通过（ready）', {}, { timeout: 4000 })
    await within(coverField!).findByText(/模拟服务端验证失败/, {}, { timeout: 4000 })

    // 封面失败时旧封面仍在，模型与文字字段也未被清空。
    expect(screen.getByAltText('已保存封面')).toBeVisible()
    expect(screen.getByText('现有模型资源（GLB）')).toBeVisible()
    expect(screen.getByLabelText('作品名称')).toHaveValue('资源草稿')
    expect(screen.getByText('有未保存的修改')).toBeVisible()

    setMockScenario('normal')
    fireEvent.click(within(coverField!).getByRole('button', { name: '重试封面' }))
    await within(coverField!).findByText('模拟验证通过（ready）', {}, { timeout: 4000 })

    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))
    expect(await screen.findByText('已保存当前修改。')).toBeVisible()

    const patches = requests(fetchSpy, 'PATCH', new RegExp(`/api/admin/works/${draft.id}$`))
    expect(patches).toHaveLength(1)
    const body = bodyOf(patches[0])
    expect(body.modelAssetId).toMatch(/^asset_mock_upload_model_/)
    expect(body.coverAssetId).toMatch(/^asset_mock_upload_cover_/)
    expect(body).not.toHaveProperty('name')

    const saved = await getAdminWork(draft.id)
    expect(saved.modelAssetId).toBe(body.modelAssetId)
    expect(saved.coverAssetId).toBe(body.coverAssetId)
    expect(saved.modelFormat).toBe('glb')
  })

  it('验证中不能保存，取消新选择后恢复旧绑定与保存能力', async () => {
    const draft = await createDraftWithAssets()
    setMockScenario('upload-validating')
    await openEdit(draft.id)

    uploadFile(
      '选择模型文件',
      new File(['model'], 'slow.glb', { type: 'model/gltf-binary' }),
    )
    await screen.findByText('模拟服务端验证中', {}, { timeout: 4000 })
    expect(
      screen.getByText(/模型或封面仍在模拟传输或验证中/),
    ).toBeVisible()
    expect(screen.getByRole('button', { name: '保存草稿' })).toBeDisabled()
    expect(screen.getByText('现有模型资源（GLB）')).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: '取消新模型' }))
    expect(screen.getByText('现有模型资源（GLB）')).toBeVisible()
    expect(screen.getByText('已取消新选择；已保存绑定未改变。')).toBeVisible()
    expect(screen.getByRole('button', { name: '保存草稿' })).toBeEnabled()
    expect(screen.queryByText(/模型或封面仍在模拟传输或验证中/)).toBeNull()
  })

  it('选文件与未保存 ready 都算 dirty，离开需确认；取消后恢复 clean', async () => {
    const draft = await createDraftWithAssets()
    setMockScenario('upload-validating')
    const { router } = await openEdit(draft.id)
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)

    uploadFile(
      '选择封面文件',
      new File(['cover'], 'leave.png', { type: 'image/png' }),
    )
    await screen.findByText('模拟服务端验证中', {}, { timeout: 4000 })
    expect(screen.getByText('有未保存的修改')).toBeVisible()

    fireEvent.click(screen.getByRole('link', { name: '返回作品管理' }))
    await waitFor(() => expect(confirmSpy).toHaveBeenCalledTimes(1))
    expect(router.state.location.pathname).toBe(`/admin/works/${draft.id}/edit`)
    expect(screen.getByText('leave.png')).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: '取消新封面' }))
    expect(screen.queryByText('有未保存的修改')).toBeNull()
    expect(screen.getByAltText('已保存封面')).toBeVisible()
  })

  it('新建首次 POST 绑定 ready 资源，进入编辑后 PATCH 不丢绑定', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    await login({ username: 'admin', password: 'admin' })
    const { router } = renderAt('/admin/works/new')

    expect(await screen.findByRole('heading', { name: '新建作品' })).toBeVisible()
    uploadFile(
      '选择模型文件',
      new File(['model'], 'new-model.glb', { type: 'model/gltf-binary' }),
    )
    uploadFile(
      '选择封面文件',
      new File(['cover'], 'new-cover.png', { type: 'image/png' }),
    )

    const modelField = document.getElementById('work-model-asset')!
    const coverField = document.getElementById('work-cover-asset')!
    await within(modelField).findByText('模拟验证通过（ready）', {}, { timeout: 4000 })
    await within(coverField).findByText('模拟验证通过（ready）', {}, { timeout: 4000 })
    expect(screen.getByText('有未保存的修改')).toBeVisible()
    const save = screen.getByRole('button', { name: '保存草稿' })
    await waitFor(() => expect(save).toBeEnabled())
    fireEvent.click(save)

    await waitFor(() =>
      expect(router.state.location.pathname).toMatch(/^\/admin\/works\/work_mock_\d+\/edit$/),
    )
    const createdId = router.state.location.pathname.split('/')[3]
    await screen.findByLabelText('作品名称')
    expect(screen.getByText('现有模型资源（GLB）')).toBeVisible()
    expect(screen.getByAltText('已保存封面')).toBeVisible()
    expect(screen.queryByText('有未保存的修改')).toBeNull()

    const posts = requests(fetchSpy, 'POST', /\/api\/admin\/works$/)
    expect(posts).toHaveLength(1)
    const postBody = bodyOf(posts[0])
    expect(postBody.modelAssetId).toMatch(/^asset_mock_upload_model_/)
    expect(postBody.coverAssetId).toMatch(/^asset_mock_upload_cover_/)

    fireEvent.change(screen.getByLabelText('作品名称'), {
      target: { value: '新建资源草稿' },
    })
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))
    expect(await screen.findByText('已保存当前修改。')).toBeVisible()

    const patches = requests(fetchSpy, 'PATCH', new RegExp(`/api/admin/works/${createdId}$`))
    expect(patches).toHaveLength(1)
    expect(bodyOf(patches[0])).toEqual({ name: '新建资源草稿' })
    expect(bodyOf(patches[0])).not.toHaveProperty('modelAssetId')
    expect(bodyOf(patches[0])).not.toHaveProperty('coverAssetId')
    expect(requests(fetchSpy, 'POST', /\/api\/admin\/works$/)).toHaveLength(1)
  })
  it('下架后资源替换 409 保留旧绑定、字段与 offline，重试后仍需手动发布', async () => {
    const draft = await createDraftWithAssets()
    await unpublishAdminWork(draft.id)
    setMockScenario('model-in-use')
    await openEdit(draft.id)

    const name = screen.getByLabelText('作品名称')
    fireEvent.change(name, { target: { value: '409 失败也保留' } })
    uploadFile(
      '选择模型文件',
      new File(['model'], 'replacement.glb', { type: 'model/gltf-binary' }),
    )
    const modelField = document.getElementById('work-model-asset')!
    await within(modelField).findByText('模拟验证通过（ready）', {}, { timeout: 4000 })

    fireEvent.click(screen.getByRole('button', { name: '保存修改' }))
    expect(await screen.findByText(/该模型资源正在预览会话中/)).toBeVisible()
    expect(name).toHaveValue('409 失败也保留')
    expect(within(modelField).getByText('模拟验证通过（ready）')).toBeVisible()
    expect(screen.getByText('现有模型资源（GLB）')).toBeVisible()
    expect(screen.getByText('已下架')).toBeVisible()

    const failed = await getAdminWork(draft.id)
    expect(failed.status).toBe('offline')
    expect(failed.modelAssetId).toBe('asset_demo_001_model')
    expect(failed.name).toBe('资源草稿')

    setMockScenario('normal')
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }))
    expect(await screen.findByText('已保存当前修改。')).toBeVisible()
    const saved = await getAdminWork(draft.id)
    expect(saved.status).toBe('offline')
    expect(saved.name).toBe('409 失败也保留')
    expect(saved.modelAssetId).toMatch(/^asset_mock_upload_model_/)
    expect(screen.getByRole('button', { name: '发布作品' })).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: '发布作品' }))
    expect(
      await screen.findByText('已发布作品，公开目录和城市列表已更新。'),
    ).toBeVisible()
    expect((await getAdminWork(draft.id)).status).toBe('published')
  })

})
