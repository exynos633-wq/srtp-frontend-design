import { Component, Suspense, lazy, useRef, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { listGlobeCities } from '../api/globe'
import { queryKeys } from '../api/queryKeys'
import { isMocksActive } from '../app/mocksStatus'
import { MockBadge } from '../mocks/MockBadge'
import { AmbientLights } from '../components/fx/AmbientLights'
import { Magnetic } from '../components/fx/Magnetic'
import { Button } from '../components/ui/Button'
import { DUR, EASE, SEC } from '../lib/motion'
import { usePrefersReducedMotion } from '../lib/usePrefersReducedMotion'
import { isWebGLAvailable } from '../lib/globeMath'
import styles from './HomePage.module.css'

const GlobeExperience = lazy(() => import('../components/globe/GlobeExperience'))

/**
 * 动效设计 v2.0 §4 首页开场表（毫秒，相对页面挂载）。
 * 表格内的叙事时长按文档取值；与令牌同源的时长直接引用 DUR.*（§3.2）。
 */
const INTRO_MS = {
  nav: 320,
  ruleAt: 80,
  rule: 420,
  eyebrowAt: 140,
  eyebrow: 300,
  lineAt: 220,
  lineStagger: 120,
  line: 560,
  subtitleAt: 560,
  subtitle: DUR.enter,
  linkAt: 660,
  link: 320,
  metaAt: 1100,
  meta: 300,
} as const

/**
 * 动效设计 v2.1 §4.1 首页布光参数（毫秒，相对页面挂载）：
 * 标题入场后一次光扫、副标题逐短语。blur 时长直接复用令牌 DUR.slow / SEC.slow。
 */
const LIGHT_MS = {
  sweepAt: 1200,
  sweep: 1100,
  phraseStagger: 70,
} as const

const toSeconds = (milliseconds: number) => milliseconds / 1000

/** 开场只在本次浏览会话播一次（§4：再次回到首页不重播）。 */
let introPlayed = false

export function HomePage() {
  const reducedMotion = usePrefersReducedMotion()
  const pageRef = useRef<HTMLElement>(null)
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

  // 首页开场（§4）：导航、细线、eyebrow、两行标题、副标题、目录入口、页底元信息。
  // 导航入场归首页、地球里不再重复写同一元素；任何输入立即结束剩余入场。
  useGSAP(
    () => {
      const page = pageRef.current
      if (!page) return
      const nav = document.querySelector<HTMLElement>('[data-public-nav]')

      if (reducedMotion || introPlayed) {
        if (nav) gsap.set(nav, { clearProps: 'opacity,visibility,transform' })
        return
      }

      const rule = page.querySelector<HTMLElement>('[data-home-rule]')
      const eyebrow = page.querySelector<HTMLElement>('[data-home-eyebrow]')
      const lines = page.querySelectorAll<HTMLElement>('[data-home-line]')
      const sweeps = page.querySelectorAll<HTMLElement>('[data-home-sweep]')
      const subtitle = page.querySelector<HTMLElement>('[data-home-subtitle]')
      const phrases = page.querySelectorAll<HTMLElement>('[data-home-phrase]')
      const link = page.querySelector<HTMLElement>('[data-home-link]')
      const meta = page.querySelector<HTMLElement>('[data-home-meta]')
      // §4 手机：除标题外位移减半；标题揭示幅度不缩。
      const shift =
        window.matchMedia?.('(max-width: 767px)').matches === true ? 0.5 : 1

      const timeline = gsap.timeline({ defaults: { ease: EASE.out } })
      if (nav) {
        timeline.fromTo(
          nav,
          { autoAlpha: 0, y: -8 },
          { autoAlpha: 1, y: 0, duration: toSeconds(INTRO_MS.nav) },
          0,
        )
      }
      if (rule) {
        timeline.fromTo(
          rule,
          { scaleX: 0 },
          { scaleX: 1, duration: toSeconds(INTRO_MS.rule) },
          toSeconds(INTRO_MS.ruleAt),
        )
      }
      if (eyebrow) {
        timeline.fromTo(
          eyebrow,
          { opacity: 0, y: 8 * shift },
          { opacity: 1, y: 0, duration: toSeconds(INTRO_MS.eyebrow) },
          toSeconds(INTRO_MS.eyebrowAt),
        )
      }
      lines.forEach((line, index) => {
        const at = toSeconds(INTRO_MS.lineAt + index * INTRO_MS.lineStagger)
        timeline.fromTo(
          line,
          { yPercent: 110 },
          { yPercent: 0, duration: toSeconds(INTRO_MS.line), ease: EASE.enter },
          at,
        )
        // §4.1 标题 blur 8→0：只压位移前 300ms，不拉长整条时间轴（减少动态分支直接跳过）。
        timeline.fromTo(
          line,
          { filter: 'blur(8px)' },
          { filter: 'blur(0px)', duration: SEC.slow, ease: EASE.out },
          at,
        )
      })
      // §4.1 标题光扫：入场约 1.2s 后只扫一次（1100ms），结束归零；不循环。
      const sweepAt = toSeconds(LIGHT_MS.sweepAt)
      sweeps.forEach((sweep) => {
        const line = sweep.parentElement
        if (!line) return
        const lineWidth = () => line.getBoundingClientRect().width
        timeline.fromTo(
          sweep,
          { x: () => -0.3 * lineWidth() },
          {
            x: () => 1.3 * lineWidth(),
            duration: toSeconds(LIGHT_MS.sweep),
            ease: EASE.out,
          },
          sweepAt,
        )
        timeline.fromTo(
          sweep,
          { opacity: 0 },
          { opacity: 0.35, duration: SEC.base, ease: EASE.out },
          sweepAt,
        )
        timeline.to(
          sweep,
          { opacity: 0, duration: SEC.enter, ease: EASE.out },
          sweepAt + SEC.scene,
        )
      })
      if (subtitle) {
        timeline.fromTo(
          subtitle,
          { y: 10 * shift },
          { y: 0, duration: toSeconds(INTRO_MS.subtitle) },
          toSeconds(INTRO_MS.subtitleAt),
        )
      }
      // §4.1 副标题逐短语：opacity 0→1 + blur 8→0，stagger 70ms，总 450ms（≤700ms）。
      phrases.forEach((phrase, index) => {
        timeline.fromTo(
          phrase,
          { opacity: 0, filter: 'blur(8px)' },
          { opacity: 1, filter: 'blur(0px)', duration: SEC.enter, ease: EASE.out },
          toSeconds(INTRO_MS.subtitleAt + LIGHT_MS.phraseStagger * index),
        )
      })
      if (link) {
        timeline.fromTo(
          link,
          { opacity: 0, y: 8 * shift },
          { opacity: 1, y: 0, duration: toSeconds(INTRO_MS.link) },
          toSeconds(INTRO_MS.linkAt),
        )
      }
      if (meta) {
        timeline.fromTo(
          meta,
          { opacity: 0 },
          { opacity: 1, duration: toSeconds(INTRO_MS.meta) },
          toSeconds(INTRO_MS.metaAt),
        )
      }

      const finish = () => {
        if (timeline.isActive()) timeline.progress(1)
      }
      const stopListening = () => {
        window.removeEventListener('pointerdown', finish, true)
        window.removeEventListener('wheel', finish, true)
        window.removeEventListener('keydown', finish, true)
      }
      window.addEventListener('pointerdown', finish, true)
      window.addEventListener('wheel', finish, { capture: true, passive: true })
      window.addEventListener('keydown', finish, true)
      timeline.eventCallback('onComplete', () => {
        introPlayed = true
        // 清掉 GSAP 留下的 filter，避免 blur(0px) 继续形成多余合成层。
        gsap.set([...lines, ...phrases], { clearProps: 'filter' })
        stopListening()
      })

      return () => {
        stopListening()
        timeline.kill()
      }
    },
    { scope: pageRef, dependencies: [reducedMotion], revertOnUpdate: true },
  )

  return (
    <section
      ref={pageRef}
      className={styles.page}
      aria-labelledby="home-title"
      data-home-page="true"
      data-home-webgl={webglAvailable ? 'true' : 'false'}
    >
      <div className={styles.hero}>
        <span className={styles.rule} data-home-rule aria-hidden="true" />
        <p className={styles.eyebrow} data-home-eyebrow>
          A NEW PERSPECTIVE
        </p>
        <h1 id="home-title" className={styles.heroTitle}>
          <span className={styles.line}>
            <span className={styles.lineInner} data-home-line>
              低空之上
            </span>
            <span className={styles.sweep} data-home-sweep aria-hidden="true" />
          </span>
          <span className={styles.line}>
            <span className={styles.lineInner} data-home-line>
              另见世界
            </span>
            <span className={styles.sweep} data-home-sweep aria-hidden="true" />
          </span>
        </h1>
        <p className={styles.subtitle} data-home-subtitle>
          <span className={styles.phrase} data-home-phrase>
            以三维视角，
          </span>
          <span className={styles.phrase} data-home-phrase>
            探索建筑与山川
          </span>
        </p>
        <Magnetic>
          <Link className={styles.heroLink} data-home-link to="/works">
            浏览全部作品 <span aria-hidden="true">→</span>
          </Link>
        </Magnetic>
      </div>

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

        <div className={styles.meta} data-home-meta>
          <MockBadge />
          {webglAvailable && <p>地球影像：NASA Blue Marble</p>}
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

      <AmbientLights />
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
        导航与完整作品目录不受影响。你仍可通过作品目录浏览建筑与地形模型。
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
