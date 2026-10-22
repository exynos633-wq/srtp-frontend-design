import type { ViewerMode } from './types'
import { DEFAULT_AUTO_ROTATE_SPEED, DEFAULT_RESUME_DELAY_MS } from './types'

/**
 * 自动旋转时钟。只负责“什么时候允许转、这一帧转多少度”，不碰相机。
 *
 * 交互分两种：持续交互（按住拖动、滑块按住、移动键按住）用 begin/end 包裹，
 * 期间无论多久都不恢复；离散操作（滚轮、按钮）用 noteInteraction 开始等待。
 * 隐藏/非 Orbit 只暂停，不重置最后一次交互时间，恢复时保留剩余等待。
 */
export class AutoRotateClock {
  private enabled: boolean
  private userDisabled: boolean
  private paused: boolean
  private interactionActive = false
  private lastInteraction: number
  private lastTick: number
  private speed: number
  private readonly resumeDelay: number

  constructor(options: {
    enabled: boolean
    speed?: number
    resumeDelayMs?: number
    now?: number
  }) {
    this.enabled = options.enabled
    this.userDisabled = !options.enabled
    this.paused = !options.enabled
    this.speed = options.speed ?? DEFAULT_AUTO_ROTATE_SPEED
    this.resumeDelay = options.resumeDelayMs ?? DEFAULT_RESUME_DELAY_MS
    const now = options.now ?? 0
    this.lastInteraction = now
    this.lastTick = now
  }

  get isEnabled(): boolean {
    return this.enabled
  }

  get isUserDisabled(): boolean {
    return this.userDisabled
  }

  get isPaused(): boolean {
    return this.paused
  }

  get isInteractionActive(): boolean {
    return this.interactionActive
  }

  setSpeed(speed: number): void {
    if (Number.isFinite(speed) && speed > 0) this.speed = speed
  }

  /** 用户显式开关；关闭后交互/加载完成都不能自动恢复。 */
  setUserEnabled(enabled: boolean, now: number): void {
    this.userDisabled = !enabled
    this.enabled = enabled
    this.interactionActive = false
    this.paused = true
    this.lastInteraction = now
    this.lastTick = now
  }

  /** 持续交互开始：按住期间始终暂停，不受 15 秒计时影响。 */
  beginInteraction(now: number): void {
    this.interactionActive = true
    this.lastInteraction = now
    this.lastTick = now
    this.paused = true
  }

  /** 持续交互结束：从松手/取消/失焦开始等待恢复间隔。 */
  endInteraction(now: number): void {
    this.interactionActive = false
    this.lastInteraction = now
    this.lastTick = now
    this.paused = true
  }

  /** 离散有效操作：从此刻开始等待恢复间隔。按住中调用不提前恢复。 */
  noteInteraction(now: number): void {
    this.lastInteraction = now
    this.lastTick = now
    this.paused = true
  }

  /** 初次就绪：立即允许旋转，但第一帧 delta 为 0。 */
  start(now: number): void {
    this.interactionActive = false
    this.lastTick = now
    this.lastInteraction = now
    this.paused = !this.enabled || this.userDisabled
  }

  /** 从隐藏/非 Orbit 返回：保留上次交互的剩余等待，不直接解除 pause。 */
  resume(now: number): void {
    this.interactionActive = false
    this.lastTick = now
    this.paused = true
  }

  /** 隐藏/非 Orbit：暂停但保留 lastInteraction，供恢复时继续等待。 */
  pause(now: number): void {
    this.interactionActive = false
    this.lastTick = now
    this.paused = true
  }

  /** 兼容旧调用名：保留等待语义。 */
  resetTimebase(now: number): void {
    this.pause(now)
  }

  advance(now: number, mode: ViewerMode, visible: boolean): number {
    const deltaSeconds = Math.min(0.1, Math.max(0, (now - this.lastTick) / 1000))
    this.lastTick = now
    if (!this.enabled || this.userDisabled || !visible || mode !== 'orbit') {
      this.paused = true
      return 0
    }
    if (this.interactionActive) {
      this.paused = true
      return 0
    }
    if (this.paused) {
      if (now - this.lastInteraction < this.resumeDelay) return 0
      this.paused = false
      return 0
    }
    return this.speed * deltaSeconds
  }
}
