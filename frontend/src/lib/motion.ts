/**
 * 动效数值的唯一来源：与 styles/tokens.css 的 --dur-* / --ease-* 一一对应。
 * 组件与时间轴只从这里取时长、曲线，不再写 0.18 / power2.out 之类的字面量
 * （UI设计/动效设计v2.0.md §3）。
 */

/** 毫秒。和 tokens.css 的 --dur-* 保持一致。 */
export const DUR = {
  press: 140,
  fast: 160,
  base: 220,
  slow: 280,
  enter: 380,
  scene: 600,
  cinema: 1200,
} as const

export type DurationName = keyof typeof DUR

/** 秒。GSAP 的 duration 只使用这里的值。 */
export const SEC = {
  press: DUR.press / 1000,
  fast: DUR.fast / 1000,
  base: DUR.base / 1000,
  slow: DUR.slow / 1000,
  enter: DUR.enter / 1000,
  scene: DUR.scene / 1000,
  cinema: DUR.cinema / 1000,
} as const

/** GSAP 缓动别名，语义与 tokens.css 的曲线一致。 */
export const EASE = {
  /** 进入/退出/默认，对应 cubic-bezier(0.23, 1, 0.32, 1)。 */
  out: 'power2.out',
  /** 屏上移动/镜头，对应 cubic-bezier(0.77, 0, 0.175, 1)。 */
  inOut: 'power2.inOut',
  /** 标题、列表的进入，收尾更果断。 */
  enter: 'power3.out',
  /** 抽屉式面板、菜单。 */
  drawer: 'power3.out',
  /** 首页开幕镜头。 */
  cinema: 'power2.inOut',
} as const

export type EaseName = keyof typeof EASE
