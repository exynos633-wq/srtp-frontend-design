import { Link } from 'react-router'
import DevPlaceholder from '../components/DevPlaceholder'
import styles from './NotFoundPage.module.css'

export default function NotFoundPage() {
  return (
    <div className={styles.wrap}>
      <DevPlaceholder
        route="未匹配的地址"
        title="页面不存在（404）"
        note="该地址不在首期路由表内。可以从首页或全部作品重新进入。"
      >
        <p className={styles.links}>
          <Link to="/">返回首页</Link>
          <Link to="/works">前往全部作品</Link>
        </p>
      </DevPlaceholder>
    </div>
  )
}
