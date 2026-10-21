import { QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { RouterProvider, createMemoryRouter } from 'react-router'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { adminReturnPath } from '../../src/api/adminSession'
import { login, logout } from '../../src/api/auth'
import { getAdminWork, listAdminWorks } from '../../src/api/adminWorks'
import { queryKeys } from '../../src/api/queryKeys'
import { createQueryClient } from '../../src/app/queryClient'
import { routes } from '../../src/app/routes'
import { server } from '../../src/mocks/node'
import { resetMockState, setMockScenario } from '../../src/mocks/scenario'

beforeAll(() => server.listen({ onUnhandledFrame: 'bypass' }))
afterEach(() => { server.resetHandlers(); resetMockState() })
afterAll(() => server.close())
function open(path: string) {
  const client = createQueryClient()
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>)
  return { router, client }
}
async function submit() {
  fireEvent.change(await screen.findByLabelText(/^账号/), { target: { value: 'admin' } })
  fireEvent.change(screen.getByLabelText(/^密码/), { target: { value: 'admin' } })
  await waitFor(() => expect(screen.getByRole('button', { name: '登录' })).toBeEnabled())
  fireEvent.submit(screen.getByRole('button', { name: '登录' }).closest('form')!)
}

describe('P09 认证边界', () => {
  it('只允许定义的管理路径，拒绝外部、编码与未知路径', () => {
    for (const path of ['https://evil.test', '//evil.test', '/admin/login', '/admin/works/../login', '/admin/works?next=//evil', '/admin/works/%2f/edit']) expect(adminReturnPath(path)).toBe('/admin/works')
    expect(adminReturnPath('/admin/works/work_draft_001/edit')).toBe('/admin/works/work_draft_001/edit')
  })
  it('未登录检查中不显示管理页，成功返回原编辑路径', async () => {
    const { router } = open('/admin/works/work_draft_001/edit')
    expect(await screen.findByText('正在检查管理员会话…')).toBeVisible()
    expect(screen.queryByRole('heading', { name: '编辑作品' })).toBeNull()
    await screen.findByRole('heading', { name: '管理员登录' })
    await submit()
    expect(await screen.findByRole('heading', { name: '编辑作品' })).toBeVisible()
    expect(router.state.location.pathname).toBe('/admin/works/work_draft_001/edit')
  })
  it('错误保留账号密码，重复提交只发送一次请求', async () => {
    let requests = 0
    server.use(http.post(/\/api\/auth\/login$/, async () => {
      requests++
      await new Promise((resolve) => setTimeout(resolve, 100))
      return HttpResponse.json({ error: { code: 'INVALID_CREDENTIALS', message: '账号或密码不正确。' } }, { status: 401 })
    }))
    open('/admin/login')
    await submit()
    fireEvent.submit(screen.getByRole('button', { name: '正在登录…' }).closest('form')!)
    expect(await screen.findByText('账号或密码不正确。')).toBeVisible()
    expect(requests).toBe(1)
    expect(screen.getByLabelText(/^密码/)).toHaveValue('admin')
  })
  it('管理请求401清理草稿和字典缓存，回登录并保留路径', async () => {
    await login({ username: 'admin', password: 'admin' })
    const { client, router } = open('/admin/works')
    await screen.findByRole('heading', { name: '作品管理' })
    await screen.findByRole('table', { name: '管理作品列表' })
    client.setQueryData(queryKeys.admin.work('work_draft_001'), { description: '敏感草稿' })
    client.setQueryData(queryKeys.dictionary.provinces(), { items: [] })
    setMockScenario('auth-expired')
    await act(async () => { await client.fetchQuery({ queryKey: queryKeys.admin.works(), queryFn: () => listAdminWorks(), staleTime: 0 }).catch(() => {}) })
    expect(await screen.findByRole('heading', { name: '管理员登录' })).toBeVisible()
    expect(
      client.getQueriesData({ queryKey: queryKeys.admin.all }).every(([, cached]) => cached === undefined),
    ).toBe(true)
    expect(
      client.getQueriesData({ queryKey: queryKeys.dictionary.all }).every(([, cached]) => cached === undefined),
    ).toBe(true)
    expect(router.state.location.search).toContain('returnTo=%2Fadmin%2Fworks')
  })
  it('403保留管理路径和权限反馈，重查后恢复', async () => {
    await login({ username: 'admin', password: 'admin' })
    setMockScenario('auth-forbidden')
    const { router } = open('/admin/works/work_draft_001/edit')
    expect(await screen.findByText(/无权访问此管理路径/)).toBeVisible()
    expect(router.state.location.pathname).toBe('/admin/works/work_draft_001/edit')
    setMockScenario('normal')
    fireEvent.click(screen.getByRole('button', { name: '重新检查认证' }))
    expect(await screen.findByRole('heading', { name: '编辑作品' })).toBeVisible()
  })
  it('退出清缓存，服务端拒绝草稿读取，返回旧页也要重新认证', async () => {
    await login({ username: 'admin', password: 'admin' })
    const { client, router } = open('/admin/works')
    await screen.findByRole('heading', { name: '作品管理' })
    client.setQueryData(queryKeys.admin.work('work_draft_001'), { description: '草稿' })
    fireEvent.click(screen.getByRole('button', { name: '退出登录' }))
    await screen.findByRole('heading', { name: '管理员登录' })
    expect(client.getQueriesData({ queryKey: queryKeys.admin.all })).toEqual([])
    await expect(getAdminWork('work_draft_001')).rejects.toMatchObject({ status: 401 })
    await act(async () => { await router.navigate('/admin/works') })
    expect(await screen.findByRole('heading', { name: '管理员登录' })).toBeVisible()
    await logout()
  })
  it('退出收到401也立即撤去管理内容和缓存', async () => {
    await login({ username: 'admin', password: 'admin' })
    const { client } = open('/admin/works')
    await screen.findByRole('heading', { name: '作品管理' })
    client.setQueryData(queryKeys.admin.work('work_draft_001'), { description: '草稿' })
    server.use(http.post(/\/api\/auth\/logout$/, () => {
      setMockScenario('auth-expired')
      return HttpResponse.json({ error: { code: 'UNAUTHENTICATED', message: '登录已失效' } }, { status: 401 })
    }))
    fireEvent.click(screen.getByRole('button', { name: '退出登录' }))
    await screen.findByRole('heading', { name: '管理员登录' })
    expect(client.getQueriesData({ queryKey: queryKeys.admin.all })).toEqual([])
  })
  it('退出服务不可用时诚实反馈，保留页面供手动重试', async () => {
    await login({ username: 'admin', password: 'admin' })
    open('/admin/works')
    await screen.findByRole('heading', { name: '作品管理' })
    server.use(http.post(/\/api\/auth\/logout$/, () => new HttpResponse(null, { status: 503 })))
    fireEvent.click(screen.getByRole('button', { name: '退出登录' }))
    expect(await screen.findByText(/退出未完成/)).toBeVisible()
    expect(screen.getByRole('heading', { name: '作品管理' })).toBeVisible()
    expect(screen.getByRole('button', { name: '退出登录' })).toBeEnabled()
  })

  it('直接打开登录页检查会话失效也清除先前管理缓存', async () => {
    const { client } = open('/admin/login')
    client.setQueryData(queryKeys.admin.work('work_draft_001'), { description: '先前页面的草稿' })
    await screen.findByRole('heading', { name: '管理员登录' })
    await waitFor(() => expect(screen.getByRole('button', { name: '登录' })).toBeEnabled())
    expect(client.getQueriesData({ queryKey: queryKeys.admin.all })).toEqual([])
  })

})
