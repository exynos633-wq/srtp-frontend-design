import { Link } from 'react-router'
import styles from './NotFoundPage.module.css'

export default function NotFoundPage() {
  return (
    <section className={styles.page} aria-labelledby="not-found-title">
      <p className={styles.code}>404</p>
      <h1 className={styles.title} id="not-found-title">
        页面不存在
      </h1>
      <p className={styles.text}>该地址不在首期路由表内，可以从首页或全部作品重新进入。</p>
      <p className={styles.links}>
        <Link className={styles.link} to="/">
          返回首页
        </Link>
        <Link className={styles.link} to="/works">
          前往全部作品
        </Link>
      </p>
    </section>
  )
}
