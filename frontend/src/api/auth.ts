import { apiRequest } from './http'

export interface SessionUser {
  id: string
}

export interface SessionResponse {
  user: SessionUser
}

export interface LoginInput {
  username: string
  password: string
}

/**
 * 认证配置入口。提案为同源 HttpOnly Cookie 会话：
 * - 请求层统一 `credentials: 'include'`，前端不读写 token、不写 localStorage；
 * - 有效期、Cookie 属性、CSRF 与跨域开发方式仍待后端确认；
 * - 登录失败与失效都由服务端返回 401，前端只展示，不做本地“假登录”。
 */
export function login(input: LoginInput, signal?: AbortSignal): Promise<SessionResponse> {
  return apiRequest<SessionResponse>('/auth/login', { method: 'POST', body: input, signal })
}

/** 当前会话；未登录或已失效返回 401。 */
export function getSession(signal?: AbortSignal): Promise<SessionResponse> {
  return apiRequest<SessionResponse>('/auth/me', { signal })
}

export async function logout(): Promise<void> {
  await apiRequest<void>('/auth/logout', { method: 'POST' })
}
