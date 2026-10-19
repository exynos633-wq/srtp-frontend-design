import { Link, useParams } from 'react-router'
import { PageHeader } from '../../components/ui/PageHeader'
import { StatusMessage } from '../../components/ui/StatusMessage'
import styles from './AdminPages.module.css'

export default function WorkPreviewPage() {
  const { id } = useParams<{ id: string }>()

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow={`WORK ${id ?? '未知编号'}`}
        title="管理员预览"
        description="预览复用公开端观看区外壳；作品可见性与预览授权由服务端负责，前端不做权限伪装。"
      />
      <StatusMessage tone="info">
        观看区外壳在 P05 接入，真实观看器在 P18 接入；当前不加载模型，也不创建渲染会话。
      </StatusMessage>
      <div className={styles.links}>
        <Link className={styles.link} to={`/works/${id ?? 'demo-001'}`}>
          查看公开详情
        </Link>
        <Link className={styles.link} to="/admin/works">
          返回作品管理
        </Link>
      </div>
    </div>
  )
}
