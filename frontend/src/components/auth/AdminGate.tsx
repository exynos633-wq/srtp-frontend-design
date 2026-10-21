import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Navigate, useLocation } from 'react-router'
import type { ReactNode } from 'react'
import { getSession, type SessionResponse } from '../../api/auth'
import { clearAdminCache, adminReturnPath } from '../../api/adminSession'
import { ApiError } from '../../api/http'
import { queryKeys } from '../../api/queryKeys'
import { Button } from '../ui/Button'
import { StatusMessage } from '../ui/StatusMessage'

export default function AdminGate({ children }: { children: ReactNode }) {
  const client = useQueryClient()
  const { pathname } = useLocation()
  const session = useQuery<SessionResponse | null>({
    queryKey: queryKeys.auth.me(),
    queryFn: async ({ signal }) => {
      try { return await getSession(signal) } catch (error) {
        clearAdminCache(client)
        throw error
      }
    },
    staleTime: 0,
    refetchOnMount: 'always',
  })
  const failure = useQuery<ApiError | null>({
    queryKey: queryKeys.auth.failure(), queryFn: () => null, enabled: false,
  }).data
  if (session.isFetching || session.isPending) return <StatusMessage>正在检查管理员会话…</StatusMessage>
  const error = failure ?? session.error
  if (error instanceof ApiError && error.status === 403) {
    return <StatusMessage tone="error">无权访问此管理路径（403）。当前路径已保留，请联系管理员核对权限。<Button onClick={() => { client.setQueryData(queryKeys.auth.failure(), null); void session.refetch() }}>重新检查认证</Button></StatusMessage>
  }
  if ((error instanceof ApiError && error.status === 401) || (!session.data && !error)) {
    return <Navigate replace to={`/admin/login?returnTo=${encodeURIComponent(adminReturnPath(pathname))}${failure || (error instanceof ApiError && error.message.includes('失效')) ? '&reason=expired' : ''}`} />
  }
  if (error) return <StatusMessage tone="error">认证检查失败：{error.message}<Button onClick={() => void session.refetch()}>重新检查认证</Button></StatusMessage>
  return children
}
