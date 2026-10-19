import { defineConfig, devices } from '@playwright/test'

// 最小 Playwright 配置：只跑路由可达性冒烟，使用本机已安装的 Chrome（channel）。
// 不下载 Playwright 自带浏览器；若目标机器没有 Chrome，可在本机执行
// `npx playwright install chromium` 并去掉 channel 后运行。
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5173',
    channel: 'chrome',
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'desktop-chrome',
      use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    },
  ],
  webServer: {
    // 显式绑定 127.0.0.1：Vite 默认监听 localhost，在部分 Windows 环境下只绑定 ::1，
    // Playwright 用 127.0.0.1 探活会超时。
    command: 'npm run dev -- --host 127.0.0.1 --port 5173 --strictPort',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      // E2E 必须显式启用开发 Mock；生产构建不会读取这个开关。
      VITE_ENABLE_MOCKS: 'true',
    },
  },
})
