import { Link } from 'react-router'
import styles from './WorkCard.module.css'

export interface WorkCardProps {
  /** 详情地址；整张卡片只有这一个链接目标。 */
  href: string
  title: string
  /** 未填城市显示“未设置城市”，不作为错误状态。 */
  cityName?: string | null
  coverUrl?: string | null
  /** 仅用于目录内的选中态示意，不替代业务状态文字。 */
  selected?: boolean
}

export function WorkCard({ href, title, cityName, coverUrl, selected = false }: WorkCardProps) {
  return (
    <li className={styles.item}>
      <Link className={styles.card} to={href}>
        <span className={styles.media} data-selected={selected ? 'true' : undefined}>
          {coverUrl ? (
            <img className={styles.image} src={coverUrl} alt="" loading="lazy" />
          ) : (
            <span className={styles.placeholder}>封面待接入</span>
          )}
        </span>
        <span className={styles.body}>
          <h3 className={styles.title}>{title}</h3>
          <span className={styles.city}>{cityName ?? '未设置城市'}</span>
        </span>
      </Link>
    </li>
  )
}
