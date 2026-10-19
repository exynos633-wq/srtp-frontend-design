import { Link, useParams } from 'react-router'
import { PageHeader } from '../../components/ui/PageHeader'
import { StatusMessage } from '../../components/ui/StatusMessage'
import styles from './AdminPages.module.css'

export default function WorkEditPage() {
  const { id } = useParams<{ id: string }>()

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow={`WORK ${id ?? '未知编号'}`}
        title="编辑作品"
        description="桌面双列约 60/40：左侧字段，右侧模型文件与封面；<1024 按任务顺序单列重排。"
      />
      <StatusMessage tone="info">
        编辑表单与离开保护在 P11 实现；模型文件替换需要先下架、等服务端确认无会话后才能替换（P13）。
      </StatusMessage>
      <div className={styles.links}>
        <Link className={styles.link} to="/admin/works">
          返回作品管理
        </Link>
        <Link className={styles.link} to={`/admin/works/${id ?? 'demo-001'}/preview`}>
          管理员预览（P05 接入）
        </Link>
      </div>
    </div>
  )
}
