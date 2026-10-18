/**
 * 公开运行配置。
 *
 * 这里的值会进入前端构建产物，只能放可公开信息；任何供应商密钥、服务器口令、
 * 管理员密码都不得写入（见 工程设计/04 第 4 节、02 第 1 节）。
 */
const readEnv = (value: string | undefined, fallback: string): string => {
  if (value === undefined || value.trim() === '') {
    return fallback
  }
  return value.trim()
}

export const appConfig = {
  /** 站名暂用“建筑模型展厅”，Logo 与正式名称待定（工程设计/06 第 1、2 条）。 */
  appName: readEnv(import.meta.env.VITE_APP_NAME, '建筑模型展厅'),
  /** 业务 API 基址；真实地址由后端确认，接口契约仍为草案（工程设计/02）。 */
  apiBaseUrl: readEnv(import.meta.env.VITE_API_BASE_URL, '/api'),
  /** 开发 Mock 开关：默认且生产必须关闭；MSW 到 P03 才接入。 */
  enableMocks: readEnv(import.meta.env.VITE_ENABLE_MOCKS, 'false') === 'true',
} as const
