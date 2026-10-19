import { StatusMessage } from '../components/ui/StatusMessage'
import styles from './HomePage.module.css'

export default function HomePage() {
  return (
    <section className={styles.hero} aria-labelledby="home-title">
      <p className={styles.eyebrow}>SPATIAL ATLAS</p>
      <h1 className={styles.title} id="home-title">
        从城市进入建筑模型
      </h1>
      <p className={styles.lead}>
        同一座城市的已发布作品共用地球上的一个点位，城市气泡列出该城市的模型；没有填写城市的作品只在全部作品中浏览。
      </p>
      <StatusMessage tone="info">
        地球、城市点位与镜头联动在 P07／P08 接入。当前页面没有三维场景，也不代表动画验收。
      </StatusMessage>
    </section>
  )
}
