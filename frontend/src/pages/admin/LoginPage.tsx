import type { FormEvent } from 'react'
import { Button } from '../../components/ui/Button'
import { StatusMessage } from '../../components/ui/StatusMessage'
import { TextField } from '../../components/ui/TextField'
import styles from './LoginPage.module.css'

export default function LoginPage() {
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
  }

  return (
    <div className={styles.page}>
      <form className={styles.panel} onSubmit={handleSubmit}>
        <h1 className={styles.title}>管理员登录</h1>
        <p className={styles.intro}>
          账号与密码由后端交付；本页只提供已确认的字段结构、焦点与禁用样式，不发送登录请求。
        </p>
        <TextField
          id="login-account"
          label="账号"
          autoComplete="username"
          hint="登录方式、有效期与失败提示待后端确认。"
        />
        <TextField id="login-password" label="密码" type="password" autoComplete="current-password" />
        <Button type="submit" variant="primary" disabled>
          登录
        </Button>
        <StatusMessage tone="info">
          认证接口未接入（P09／P16）：不会发送登录请求，也不会保存或提交任何凭据。
        </StatusMessage>
      </form>
    </div>
  )
}
