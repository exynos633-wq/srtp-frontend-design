import { expect, test } from '@playwright/test'

// 每条用例都直接打开目标地址并刷新一次：验证前端路由能接管深层路径。
// 注意：这只证明开发服务器的 history 回退可用，不代表生产部署已配置回退。
const routes = [
  { path: '/', heading: /从一座城，.*走进.*一座建筑/ },
  { path: '/works', heading: '全部作品' },
  { path: '/works/work_demo_001', heading: '院落模型' },
  { path: '/admin/login', heading: '管理员登录' },
  { path: '/admin/works', heading: '作品管理' },
  { path: '/admin/works/new', heading: '新建作品' },
  { path: '/admin/works/work_demo_001/edit', heading: '编辑作品' },
  { path: '/admin/works/work_demo_001/preview', heading: '管理员预览' },
  { path: '/no-such-page', heading: '页面不存在' },
]

for (const route of routes) {
  test(`直接访问并刷新 ${route.path}`, async ({ page }) => {
    await page.goto(route.path)
    const heading = route.path.startsWith('/admin/') && route.path !== '/admin/login' ? '管理员登录' : route.heading
    await expect(page.getByRole('heading', { name: heading })).toBeVisible()

    await page.reload()
    await expect(page.getByRole('heading', { name: heading })).toBeVisible()
  })
}

test('/admin 未登录进入登录页', async ({ page }) => {
  await page.goto('/admin')
  await expect(page).toHaveURL(/\/admin\/login\?returnTo=/)
  await expect(page.getByRole('heading', { name: '管理员登录' })).toBeVisible()
})

test('导航链接在客户端切换页面', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('navigation', { name: '公开展示区导航' }).getByRole('link', { name: '全部作品' }).click()
  await expect(page).toHaveURL(/\/works$/)
  await expect(page.getByRole('heading', { name: '全部作品' })).toBeVisible()
})
