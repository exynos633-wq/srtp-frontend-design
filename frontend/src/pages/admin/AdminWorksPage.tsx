import { Link } from 'react-router'
import { PageHeader } from '../../components/ui/PageHeader'
import { StatusMessage } from '../../components/ui/StatusMessage'
import styles from './AdminPages.module.css'

export default function AdminWorksPage() {
  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="ADMIN"
        title="作品管理"
        description="列表按发布时间降序，包含草稿、已发布与已下架状态；手机上每件作品改为信息块，字段和操作换行保留。"
      />
      <StatusMessage tone="info">
        作品列表与操作在 P10 接入；当前已通过会话检查，列表尚未接入。真实权限仍由服务端校验。
      </StatusMessage>
      <div className={styles.links}>
        <Link className={styles.link} to="/admin/works/new">
          新建作品（P11 接入）
        </Link>
        <Link className={styles.link} to="/">
          返回公开展示
        </Link>
      </div>
    </div>
  )
}
