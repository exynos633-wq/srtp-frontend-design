import { Component, Suspense, lazy, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { listGlobeCities } from '../api/globe'
import { queryKeys } from '../api/queryKeys'
import { isMocksActive } from '../app/mocksStatus'
import { MockBadge } from '../mocks/MockBadge'
import { Button } from '../components/ui/Button'
import { usePrefersReducedMotion } from '../lib/usePrefersReducedMotion'
import { isWebGLAvailable } from '../lib/globeMath'
import styles from './HomePage.module.css'

const GlobeExperience = lazy(() => import('../components/globe/GlobeExperience'))

export function HomePage() {
  const reducedMotion = usePrefersReducedMotion()
  const [webglAvailable] = useState(() => isWebGLAvailable())
  const citiesQuery = useQuery({
    queryKey: queryKeys.globe.cities(),
    queryFn: ({ signal }) => listGlobeCities(signal),
  })

  const cities = citiesQuery.data?.items ?? []
  const loading = citiesQuery.isPending
  const error = citiesQuery.error
  const errorMessage =
    error instanceof Error && error.message
      ? error.message
      : '读取城市点位失败，请稍后手动重试。'

  return (
    <section
      className={styles.page}
      aria-labelledby="home-title"
      data-home-page="true"
      data-home-webgl={webglAvailable ? 'true' : 'false'}
    >
      <h1 id="home-title" className={styles.srOnly}>
        从城市进入建筑模型
      </h1>

      <div className={styles.scene} data-home-scene="true">
        {webglAvailable ? (
          <GlobeErrorBoundary fallback={<GlobeFallback />}>
            <Suspense fallback={<ScenePending />}>
              <GlobeExperience cities={cities} reducedMotion={reducedMotion} />
            </Suspense>
          </GlobeErrorBoundary>
        ) : (
          <GlobeFallback />
        )}

        <div className={styles.meta}>
          <MockBadge />
          {webglAvailable && <p>演示地球 · 正式地理素材待接入</p>}
          {webglAvailable && isMocksActive() && (
            <p>城市坐标为 Mock 演示数据，待正式字典替换</p>
          )}
        </div>

        {loading && (
          <p className={styles.loading} role="status">
            正在读取城市点位…
          </p>
        )}

        {!loading && error && (
          <div className={styles.panel} role="alert">
            <h2 className={styles.panelTitle}>城市点位读取失败</h2>
            <p className={styles.panelText}>{errorMessage}</p>
            <p className={styles.panelText}>页面与全部作品目录仍可使用；这里不会自动重试。</p>
            <div className={styles.panelActions}>
              <Button onClick={() => void citiesQuery.refetch()} disabled={citiesQuery.isFetching}>
                手动重试
              </Button>
              <Link className={styles.textLink} to="/works">
                查看全部作品
              </Link>
            </div>
          </div>
        )}

        {!loading && !error && cities.length === 0 && (
          <div className={styles.panel} role="status">
            <h2 className={styles.panelTitle}>当前没有可用的城市点位</h2>
            <p className={styles.panelText}>
              公开目录中仍有已发布作品，可能未设置城市，或城市中心尚未配置。
              这不表示没有作品。
            </p>
            <div className={styles.panelActions}>
              <Link className={styles.textLink} to="/works">
                前往全部作品
              </Link>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

function ScenePending() {
  return (
    <p className={styles.pending} role="status">
      <span className={styles.pulse} aria-hidden="true" />
      正在加载地球场景…
    </p>
  )
}

function GlobeFallback() {
  return (
    <div className={styles.fallback} role="group" aria-label="三维地球不可用">
      <p className={styles.fallbackEyebrow}>三维场景不可用</p>
      <h2 className={styles.fallbackTitle}>当前浏览器无法显示地球场景</h2>
      <p className={styles.fallbackText}>
        导航与完整作品目录不受影响。正式地球素材与真实地理效果尚未接入，这里不会用静态图伪装成可交互地球。
      </p>
      <Link className={styles.fallbackLink} to="/works">
        前往全部作品
      </Link>
    </div>
  )
}

interface GlobeErrorBoundaryProps {
  children: ReactNode
  fallback: ReactNode
}

class GlobeErrorBoundary extends Component<
  GlobeErrorBoundaryProps,
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

export default HomePage
