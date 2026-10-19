import { Link, useParams } from 'react-router'
import { Button } from '../components/ui/Button'
import { StatusMessage } from '../components/ui/StatusMessage'
import styles from './WorkDetailPage.module.css'

export default function WorkDetailPage() {
  const { id } = useParams<{ id: string }>()

  return (
    <div className={styles.page}>
      <Link className={styles.back} to="/works">
        返回全部作品
      </Link>
      <div className={styles.layout}>
        <section className={styles.viewer} aria-label="模型观看区">
          <div className={styles.cover}>
            <span className={styles.coverNote}>封面待接入</span>
          </div>
          <div className={styles.controls}>
            <Button variant="primary" disabled>
              开始预览
            </Button>
            <Button disabled>复位</Button>
            <Button disabled>放大查看</Button>
            <Button disabled>结束预览</Button>
          </div>
          <StatusMessage tone="info">
            观看区外壳与“未启动／准备中／繁忙／断线／结束”状态在 P05 接入；当前不加载模型，也不申请渲染会话。
          </StatusMessage>
        </section>
        <aside className={styles.info} aria-label="作品信息">
          <header className={styles.infoHeader}>
            <h1 className={styles.title}>作品详情</h1>
            <p className={styles.city}>未设置城市</p>
            <p className={styles.meta}>WORK {id ?? '未知编号'}</p>
          </header>
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>建筑介绍</h2>
            <p className={styles.paragraph}>
              接口接入后在此显示纯文字介绍，保留换行；不渲染 HTML 或 Markdown。
            </p>
          </section>
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>建模说明</h2>
            <p className={styles.paragraph}>选填内容；未填写时不显示本区块。</p>
          </section>
          <StatusMessage tone="info">
            作品数据与封面在 P03 起接入，模型与预览在 P05／P18 接入。
          </StatusMessage>
        </aside>
      </div>
    </div>
  )
}
