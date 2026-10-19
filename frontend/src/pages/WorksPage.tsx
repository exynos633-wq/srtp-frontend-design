import { PageHeader } from '../components/ui/PageHeader'
import { StatusMessage } from '../components/ui/StatusMessage'
import { WorkCard } from '../components/works/WorkCard'
import styles from './WorksPage.module.css'

/** 结构示例：名称取自现有三件样例，城市标“演示”，不代表接口数据。 */
const sampleWorks = [
  { id: 'demo-001', title: '院落模型', cityName: '北京市（演示）' },
  { id: 'demo-002', title: '长城模型', cityName: '北京市（演示）' },
  { id: 'demo-003', title: '丘陵模型', cityName: null },
] as const

export default function WorksPage() {
  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="演示数据"
        title="全部作品"
        description="目录按发布时间降序排列，不分页。城市选填：未设置的模型只在这里和详情中出现，不进入地球点位。"
      />
      <StatusMessage tone="info">
        封面与作品数据在 P03／P04 接入；当前卡片是栅格与文字基线，不连接接口。
      </StatusMessage>
      <ul className={styles.grid}>
        {sampleWorks.map((work) => (
          <WorkCard
            key={work.id}
            href={`/works/${work.id}`}
            title={work.title}
            cityName={work.cityName}
          />
        ))}
      </ul>
    </div>
  )
}
