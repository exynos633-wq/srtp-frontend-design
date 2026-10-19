import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PreviewViewer } from '../../src/components/works/PreviewViewer'
import type { PublicWork } from '../../src/types/work'

vi.mock('../../src/lib/coverFlip', () => ({
  canUseCoverSource: () => false,
  runCoverTransition: () => () => {},
  runDirectCoverEntrance: (_element: HTMLElement, onEntered: () => void) => {
    onEntered()
    return () => {}
  },
}))

const work: PublicWork = {
  id: 'work_demo_001',
  name: '院落模型',
  city: null,
  coverUrl: '/mock/placeholder-cover.svg',
  modelFormat: 'glb',
  description: '传统院落的空间层次。',
  modelingNote: null,
}

const renderViewer = (onEntered = vi.fn()) => {
  render(<PreviewViewer work={work} onEntered={onEntered} />)
  return onEntered
}

const start = () => fireEvent.click(screen.getByRole('button', { name: '开始预览' }))

const advance = (ms: number) => {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('观看区外壳的模拟生命周期', () => {
  it('未开始时只展示封面与开始入口，不进入准备状态', () => {
    renderViewer()
    expect(screen.getByText('封面待预览')).toBeVisible()
    expect(screen.getByRole('button', { name: '开始预览' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '复位' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '放大查看' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '结束预览' })).toBeDisabled()
    expect(screen.queryByText('正在准备预览')).toBeNull()
  })

  it('开始后进入准备状态，准备完成才显示模拟画面', () => {
    renderViewer()
    start()
    expect(screen.getByText('正在准备预览')).toBeVisible()
    expect(screen.getByText('模拟准备 · 不伪造首帧')).toBeVisible()
    expect(screen.queryByText('模拟观看画面')).toBeNull()

    advance(1400)
    expect(screen.getByText('模拟观看画面')).toBeVisible()
    expect(screen.getByText('真实模型渲染尚未接入，不表示模型已加载')).toBeVisible()
    expect(screen.getByRole('button', { name: '复位' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '放大查看' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '结束预览' })).toBeEnabled()
  })

  it('准备中结束后，迟到的准备结果不能恢复画面', () => {
    renderViewer()
    start()
    fireEvent.click(screen.getByRole('button', { name: '结束预览' }))
    expect(screen.getByText('观看实例已释放。你可以重新开始一次预览。')).toBeVisible()

    advance(3000)
    expect(screen.getByText('观看实例已释放。你可以重新开始一次预览。')).toBeVisible()
    expect(screen.queryByText('模拟观看画面')).toBeNull()
    expect(screen.getByRole('button', { name: '开始预览' })).toBeEnabled()
  })

  it('快速开始、结束、再次开始不会串用旧计时器', () => {
    renderViewer()
    start()
    fireEvent.click(screen.getByRole('button', { name: '结束预览' }))
    start()
    advance(1400)
    expect(screen.getByText('模拟观看画面')).toBeVisible()
    expect(screen.queryByText('预览已结束')).toBeNull()
    expect(screen.getAllByText('模拟观看画面')).toHaveLength(1)
  })

  it('放大使用页内模态层，Esc 关闭后保留同一观看区', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
    )
    renderViewer()
    start()
    advance(1400)
    fireEvent.click(screen.getByRole('button', { name: '放大查看' }))

    const dialog = screen.getByRole('dialog', { name: '放大查看：院落模型' })
    expect(dialog).toBeVisible()
    expect(screen.getByRole('button', { name: '恢复常规查看' })).toBeVisible()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    act(() => {
      vi.runAllTimers()
    })
    expect(screen.getByRole('button', { name: '放大查看' })).toHaveFocus()
    expect(screen.getByText('模拟观看画面')).toBeVisible()
  })

  it('放大中结束预览不关闭模态层，恢复常规查看后才回到开始入口', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
    )
    renderViewer()
    start()
    advance(1400)
    fireEvent.click(screen.getByRole('button', { name: '放大查看' }))
    expect(screen.getByRole('dialog')).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: '结束预览' }))
    expect(screen.getByRole('dialog')).toBeVisible()
    expect(screen.getByText('观看实例已释放。你可以重新开始一次预览。')).toBeVisible()
    expect(screen.getByRole('button', { name: '放大查看' })).toBeDisabled()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    act(() => {
      vi.runAllTimers()
    })
    expect(screen.getByRole('button', { name: '开始预览' })).toHaveFocus()
  })

  it('模拟繁忙只提供手动重试，不自动开始', () => {
    renderViewer()
    fireEvent.change(screen.getByLabelText('开发演示 · 下次开始的模拟结果'), {
      target: { value: 'busy' },
    })
    start()
    advance(1400)
    expect(screen.getByText('渲染资源繁忙')).toBeVisible()
    expect(screen.getByText('等待手动重试')).toBeVisible()
    expect(screen.getByRole('button', { name: '手动重试' })).toBeVisible()
    expect(screen.queryByText('模拟观看画面')).toBeNull()

    advance(5000)
    expect(screen.queryByText('模拟观看画面')).toBeNull()
  })

  it('封面加载失败时提供不冒充模型的替代', () => {
    render(<PreviewViewer work={work} />)
    const image = document.querySelector('img')
    expect(image).not.toBeNull()
    fireEvent.error(image as HTMLImageElement)
    expect(screen.getByText('封面暂不可用')).toBeVisible()
    expect(document.querySelector('img')).toBeNull()
  })
})
