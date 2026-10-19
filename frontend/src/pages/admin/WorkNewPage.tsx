import { Link } from 'react-router'
import { PageHeader } from '../../components/ui/PageHeader'
import { StatusMessage } from '../../components/ui/StatusMessage'
import styles from './AdminPages.module.css'

export default function WorkNewPage() {
  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="ADMIN"
        title="新建作品"
        description="字段顺序：名称 → 所在城市（选填，省份＋城市）→ 模型文件、封面 → 建筑介绍、建模说明 → 保存／预览／手动发布。"
      />
      <StatusMessage tone="info">
        表单、标准省市选择、草稿保存与发布校验在 P11 实现；当前不包含输入控件，也不会写入任何数据。
      </StatusMessage>
      <div className={styles.links}>
        <Link className={styles.link} to="/admin/works">
          返回作品管理
        </Link>
      </div>
    </div>
  )
}
