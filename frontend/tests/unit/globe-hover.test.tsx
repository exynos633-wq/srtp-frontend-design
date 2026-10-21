import { act, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CityBubbleProps } from '../../src/components/globe/CityBubble'
import GlobeExperience from '../../src/components/globe/GlobeExperience'

// Keep the real pointer/timer controller while replacing rendering and network layers.
vi.mock('@react-three/fiber', () => ({
  Canvas: () => null,
  useFrame: vi.fn(),
  useThree: vi.fn(),
}))
vi.mock('@gsap/react', () => ({ useGSAP: vi.fn() }))
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}))
vi.mock('../../src/components/globe/Earth', () => ({ Earth: () => null }))
vi.mock('../../src/components/globe/CityBubble', () => ({
  CityBubble: ({ sectionRef, onPointerEnter, onPointerLeave }: CityBubbleProps) => (
    <section
      ref={sectionRef}
      data-city-bubble="true"
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
    />
  ),
}))

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('PointerEvent', class extends MouseEvent {
    pointerType: string

    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init)
      this.pointerType = init.pointerType ?? 'mouse'
    }
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function renderGlobe() {
  const { container } = render(
    <GlobeExperience
      cities={[{
        id: '110100',
        name: '北京市',
        province: { id: '110000', name: '北京市' },
        center: { latitude: 39.9, longitude: 116.4 },
        workCount: 3,
      }]}
      reducedMotion
    />,
  )
  const point = container.querySelector<HTMLButtonElement>('[data-city-point]')!
  return { point, bubble: () => container.querySelector('[data-city-bubble]') }
}

function enter(element: Element, relatedTarget: EventTarget = document.body) {
  fireEvent.pointerOver(element, { pointerType: 'mouse', relatedTarget })
}

function leave(element: Element, relatedTarget: EventTarget = document.body) {
  fireEvent.pointerOut(element, { pointerType: 'mouse', relatedTarget })
}

function advance(milliseconds: number) {
  act(() => { vi.advanceTimersByTime(milliseconds) })
}

describe('城市点位悬停计时', () => {
  it('快速划过点位后不再延迟打开气泡', () => {
    const { point, bubble } = renderGlobe()
    enter(point)
    advance(50)
    leave(point)
    advance(1000)
    expect(bubble()).toBeNull()
  })

  it('持续悬停可打开气泡，离开后按宽限时间关闭', () => {
    const { point, bubble } = renderGlobe()
    enter(point)
    advance(120)
    expect(bubble()).not.toBeNull()
    leave(point)
    advance(199)
    expect(bubble()).not.toBeNull()
    advance(1)
    expect(bubble()).toBeNull()
  })

  it('从点位移入已打开的气泡时保留气泡', () => {
    const { point, bubble } = renderGlobe()
    enter(point)
    advance(120)
    const card = bubble()!
    leave(point, card)
    advance(100)
    enter(card, point)
    advance(1000)
    expect(bubble()).not.toBeNull()
  })

  it('快速离开后重新进入同一点位可重新计时打开', () => {
    const { point, bubble } = renderGlobe()
    enter(point)
    advance(50)
    leave(point)
    advance(50)
    enter(point)
    advance(119)
    expect(bubble()).toBeNull()
    advance(1)
    expect(bubble()).not.toBeNull()
  })
  it('城市最后一件作品移出后关闭气泡并把焦点交给地球舞台', () => {
    const cities = [{
      id: '440300',
      name: '深圳市',
      province: { id: '440000', name: '广东省' },
      center: { latitude: 22.54, longitude: 114.06 },
      workCount: 1,
    }]
    const { container, rerender } = render(
      <GlobeExperience cities={cities} reducedMotion />,
    )
    const point = container.querySelector<HTMLButtonElement>('[data-city-point]')!
    enter(point)
    advance(120)
    expect(container.querySelector('[data-city-bubble]')).not.toBeNull()

    rerender(<GlobeExperience cities={[]} reducedMotion />)
    advance(0)

    expect(container.querySelector('[data-city-bubble]')).toBeNull()
    expect(container.querySelector('[data-globe-stage]')).toHaveFocus()
  })

})
