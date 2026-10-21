import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useBeforeUnload, useBlocker, useNavigate, useSearchParams } from 'react-router'
import { getSession, login } from '../../api/auth'
import { adminReturnPath, clearAdminCache } from '../../api/adminSession'
import { queryKeys } from '../../api/queryKeys'
import { Button } from '../../components/ui/Button'
import { StatusMessage } from '../../components/ui/StatusMessage'
import { TextField } from '../../components/ui/TextField'
import { isMocksActive } from '../../app/mocksStatus'
import { ApiError } from '../../api/http'
import styles from './LoginPage.module.css'

export default function LoginPage() {
  const client = useQueryClient()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const target = adminReturnPath(params.get('returnTo'))
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const title = useRef<HTMLHeadingElement>(null)
  const busy = useRef(false)
  const completed = useRef(false)
  const activeRequest = useRef<AbortController | null>(null)
  const dirty = Boolean(username || password)
  useEffect(() => {
    title.current?.focus()
    return () => activeRequest.current?.abort()
  }, [])
  useBlocker(() => !completed.current && dirty && !window.confirm('登录信息尚未提交，确定离开？'))
  useBeforeUnload((event) => {
    if (dirty && !completed.current) { event.preventDefault(); event.returnValue = '' }
  })
  const session = useQuery({
    queryKey: queryKeys.auth.me(), queryFn: ({ signal }) => getSession(signal),
    staleTime: 0, refetchOnMount: 'always',
  })
  useEffect(() => {
    if (session.data && !session.isError && !session.isFetching && !dirty) {
      completed.current = true
      void navigate(target, { replace: true })
    }
  }, [session.data, session.isError, session.isFetching, dirty, navigate, target])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy.current || session.isFetching) return
    busy.current = true
    setPending(true)
    setError('')
    const controller = new AbortController()
    activeRequest.current = controller
    try {
      await client.cancelQueries({ queryKey: queryKeys.auth.me() })
      const result = await login({ username: username.trim(), password }, controller.signal)
      if (controller.signal.aborted) return
      clearAdminCache(client)
      client.setQueryData(queryKeys.auth.failure(), null)
      client.setQueryData(queryKeys.auth.me(), result)
      completed.current = true
      setPassword('')
      await navigate(target, { replace: true })
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : '登录失败，请手动重试。')
    } finally {
      busy.current = false
      if (!controller.signal.aborted) setPending(false)
    }
  }

  return (
    <div className={styles.page}>
      <form className={styles.panel} onSubmit={(event) => void handleSubmit(event)} aria-busy={pending}>
        <h1 ref={title} className={styles.title} tabIndex={-1}>管理员登录</h1>
        {params.get('reason') === 'expired' && <StatusMessage tone="warning">登录已失效，请重新登录。原管理路径已保留。</StatusMessage>}
        {session.isFetching && <StatusMessage>正在检查管理员会话…</StatusMessage>}
        {session.error && (!(session.error instanceof ApiError) || session.error.status !== 401) && <StatusMessage tone="error">认证检查失败：{session.error.message}。可重新提交账号与密码。</StatusMessage>}
        <TextField id="login-account" label="账号" name="username" required autoComplete="username" autoCapitalize="none" spellCheck={false} value={username} onChange={(event) => setUsername(event.target.value)} readOnly={pending} />
        <TextField id="login-password" label="密码" name="password" required type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} readOnly={pending} />
        {error && <StatusMessage tone="error">{error}</StatusMessage>}
        <Button type="submit" variant="primary" disabled={pending || session.isFetching}>{pending ? '正在登录…' : '登录'}</Button>
        <p className={styles.intro}>使用预先创建的管理员账号。</p>
        {isMocksActive() && <StatusMessage>开发 Mock：演示账号 admin / admin，仅模拟服务端会话，刷新后需重新登录。</StatusMessage>}
      </form>
    </div>
  )
}
