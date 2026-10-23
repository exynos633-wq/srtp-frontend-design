import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PreviewViewer } from '../../src/components/works/PreviewViewer'
import type { PublicWork } from '../../src/types/work'

vi.mock('../../src/components/viewer/ModelViewport', () => import('./support/ModelViewportStub'))

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

const modelSource = {
  kind: 'url' as const,
  url: '/__dev/models/asset_demo_001_model/courtyard.glb?v=1',
  version: 'v1',
  name: '院落模型',
}

const renderViewer = (onEntered = vi.fn()) => {
  render(<PreviewViewer work={work} onEntered={onEntered} modelSource={modelSource} />)
  return onEntered
}

const start = () => fireEvent.click(screen.getByRole('button', { name: '开始预览' }))

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('观看区外壳的真实生命周期边界', () => {
  it('未开始时只展示封面与开始入口，不挂载查看器', () => {
    renderViewer()
    expect(screen.getByText('封面待预览')).toBeVisible()
    expect(screen.getByRole('button', { name: '开始预览' })).toBeEnabled()
    expect(screen.queryByTestId('model-viewport-stub')).toBeNull()
    expect(screen.queryByText(/模拟观看画面/)).toBeNull()
    expect(screen.queryByText(/真实模型渲染尚未接入/)).toBeNull()
  })

  it('开始后才挂载真实查看器，不再显示模拟首帧', async () => {
    renderViewer()
    start()
    expect(await screen.findByTestId('model-viewport-stub')).toBeVisible()
    expect(screen.getByText('真实查看器测试替身 · 院落模型')).toBeVisible()
    expect(screen.queryByText(/模拟观看画面/)).toBeNull()
    expect(await screen.findByText('真实模型 · 本地客户端渲染')).toBeVisible()
  })

  it('准备中结束会卸载查看器，迟到的准备结果不能恢复画面', async () => {
    renderViewer()
    start()
    await screen.findByTestId('model-viewport-stub')
    const endButton = screen.getAllByRole('button', { name: '结束预览' })[0]!
    fireEvent.click(endButton)
    expect(screen.getAllByText(/观看实例已释放/).length).toBeGreaterThan(0)
    await waitFor(() => expect(screen.queryByTestId('model-viewport-stub')).toBeNull())
    expect(screen.getByRole('button', { name: '开始预览' })).toBeEnabled()
  })

  it('快速开始、结束、再次开始不会串用旧查看器', async () => {
    renderViewer()
    start()
    await screen.findByTestId('model-viewport-stub')
    fireEvent.click(screen.getAllByRole('button', { name: '结束预览' })[0]!)
    start()
    expect(await screen.findByTestId('model-viewport-stub')).toBeVisible()
    expect(screen.queryByText('预览已结束')).toBeNull()
    expect(screen.getAllByTestId('model-viewport-stub')).toHaveLength(1)
  })

  it('放大使用页内模态层，Esc 关闭后保留同一查看器', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
    )
    renderViewer()
    start()
    await screen.findByTestId('model-viewport-stub')
    fireEvent.click(screen.getByRole('button', { name: '放大查看' }))

    const dialog = screen.getByRole('dialog', { name: '放大查看：院落模型' })
    expect(dialog).toBeVisible()
    expect(screen.getByRole('button', { name: '恢复常规查看' })).toBeVisible()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    await waitFor(() => expect(screen.getByRole('button', { name: '放大查看' })).toHaveFocus())
    expect(screen.getByTestId('model-viewport-stub')).toBeVisible()
  })

  it('放大中结束预览不关闭模态层，恢复常规查看后才回到开始入口', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
    )
    renderViewer()
    start()
    await screen.findByTestId('model-viewport-stub')
    fireEvent.click(screen.getByRole('button', { name: '放大查看' }))
    expect(screen.getByRole('dialog')).toBeVisible()

    fireEvent.click(screen.getAllByRole('button', { name: '结束预览' })[0]!)
    expect(screen.getByRole('dialog')).toBeVisible()
    expect(screen.getAllByText(/观看实例已释放/).length).toBeGreaterThan(0)
    expect(screen.queryByTestId('model-viewport-stub')).toBeNull()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    await waitFor(() => expect(screen.getByRole('button', { name: '开始预览' })).toHaveFocus())
  })

  it('可用性检查失败只提供手动重试，不自动加载模型', async () => {
    const ensureAvailable = vi.fn().mockRejectedValue(new Error('公开读取失败'))
    render(<PreviewViewer work={work} ensureAvailable={ensureAvailable} />)
    start()
    expect(await screen.findByText('无法确认作品可用性')).toBeVisible()
    expect(screen.getByText('公开读取失败')).toBeVisible()
    expect(screen.queryByTestId('model-viewport-stub')).toBeNull()
    await waitFor(() => expect(screen.queryByTestId('model-viewport-stub')).toBeNull())
  })

  it('封面加载失败时提供不冒充模型的替代', () => {
    render(<PreviewViewer work={work} />)
    const image = document.querySelector('img')
    expect(image).not.toBeNull()
    fireEvent.error(image as HTMLImageElement)
    expect(screen.getByText('封面暂不可用')).toBeVisible()
    expect(document.querySelector('img')).toBeNull()
  })

  it('同一作品的失败封面被替换后重新加载，不重建已开始的观看', async () => {
    const { container, rerender } = render(<PreviewViewer work={work} modelSource={modelSource} />)
    start()
    const viewport = await screen.findByTestId('model-viewport-stub')
    fireEvent.error(container.querySelector('img')!)
    expect(screen.getByText('封面暂不可用')).toBeVisible()

    rerender(<PreviewViewer work={{ ...work, coverUrl: '/new-cover.png' }} modelSource={modelSource} />)
    const replacement = container.querySelector('img')
    expect(replacement).toHaveAttribute('src', '/new-cover.png')
    fireEvent.load(replacement!)
    expect(screen.queryByText('封面暂不可用')).toBeNull()
    expect(screen.getByTestId('model-viewport-stub')).toBe(viewport)
  })
})
