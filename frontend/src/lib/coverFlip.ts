import gsap from 'gsap'
import { Flip } from 'gsap/Flip'
import type { CoverSource } from './worksNavigation'

gsap.registerPlugin(Flip)

/**
 * 封面连续转场的最小实现：一个视觉克隆 + 一层遮罩，结束后全部移除。
 * 克隆不接收指针、不进入 Tab 顺序，也不携带链接语义。
 */
export interface CoverTransitionOptions {
  source: CoverSource
  target: HTMLElement
  /** 信息层开始展开的时点；不是页面可用性的前置条件。 */
  onEntered: () => void
  coverUrl: string
}

function readRadius(): string {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue('--radius-panel')
    .trim()
  return value || '8px'
}

/** 来源已经离开视口、尺寸退化或裁切比例差太多时，改用独立入场路径。 */
export function canUseCoverSource(source: CoverSource, target: DOMRect): boolean {
  const { rect } = source
  if (rect.width < 8 || rect.height < 8) return false
  if (target.width < 8 || target.height < 8) return false
  if (
    rect.left >= window.innerWidth ||
    rect.top >= window.innerHeight ||
    rect.left + rect.width <= 0 ||
    rect.top + rect.height <= 0
  ) {
    return false
  }
  const sourceAspect = rect.width / rect.height
  const targetAspect = target.width / target.height
  return Math.abs(sourceAspect - targetAspect) / targetAspect < 0.08
}

export function runCoverTransition({
  source,
  target,
  onEntered,
  coverUrl,
}: CoverTransitionOptions): () => void {
  const radius = readRadius()
  const mask = document.createElement('div')
  mask.setAttribute('aria-hidden', 'true')
  mask.style.cssText = [
    'position:fixed',
    'inset:0',
    'z-index:190',
    'pointer-events:none',
    'background:rgb(8 13 18 / 28%)',
    'opacity:0',
  ].join(';')

  const layer = document.createElement('div')
  layer.setAttribute('aria-hidden', 'true')
  layer.style.cssText = [
    'position:fixed',
    `left:${source.rect.left}px`,
    `top:${source.rect.top}px`,
    `width:${source.rect.width}px`,
    `height:${source.rect.height}px`,
    'z-index:200',
    'pointer-events:none',
    'overflow:hidden',
    `border-radius:${radius}`,
    'background:var(--color-image-bed, #20272b)',
  ].join(';')

  const image = document.createElement('img')
  image.src = coverUrl
  image.alt = ''
  image.draggable = false
  image.style.cssText = 'display:block;width:100%;height:100%;object-fit:contain;'

  layer.append(image)
  document.body.append(mask, layer)
  gsap.set(target, { opacity: 0 })

  let finished = false
  let entered = false
  let timeline: gsap.core.Timeline | null = null

  const notifyEntered = () => {
    if (entered) return
    entered = true
    onEntered()
  }

  const removeVisuals = () => {
    timeline?.kill()
    timeline = null
    window.removeEventListener('resize', handleResize)
    layer.remove()
    mask.remove()
    gsap.set(target, { clearProps: 'opacity' })
  }

  const finish = () => {
    if (finished) return
    finished = true
    removeVisuals()
  }

  function handleResize() {
    if (finished) return
    finished = true
    removeVisuals()
    notifyEntered()
  }

  timeline = gsap.timeline({ onComplete: finish })
  timeline.to(mask, { opacity: 1, duration: 0.18, ease: 'power1.out' }, 0)
  const fit = Flip.fit(layer, target, { duration: 0.66, ease: 'power3.inOut', scale: true })
  if (fit) timeline.add(fit as gsap.core.Tween, 0.02)
  timeline.call(notifyEntered, undefined, 0.42)

  window.addEventListener('resize', handleResize, { once: true })

  return () => {
    finished = true
    removeVisuals()
  }
}

/** 无有效来源时的独立详情入场：只动详情自身，不伪造来源卡片。 */
export function runDirectCoverEntrance(
  cover: HTMLElement,
  onEntered: () => void,
): () => void {
  const tween = gsap.fromTo(
    cover,
    { opacity: 0, y: 12 },
    { opacity: 1, y: 0, duration: 0.5, ease: 'power2.out' },
  )
  const enteredAt = window.setTimeout(onEntered, 180)
  return () => {
    window.clearTimeout(enteredAt)
    tween.kill()
  }
}
