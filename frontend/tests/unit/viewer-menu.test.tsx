import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ModelViewport } from '../../src/components/viewer/ModelViewport'
import type { ModelViewerEvent } from '../../src/viewer/types'

const calls = vi.hoisted(() => ({ load: vi.fn(), dispose: vi.fn(), begin: vi.fn(), end: vi.fn(), reset: vi.fn() }))
vi.mock('../../src/viewer/ModelViewer', () => ({
  ModelViewer: class {
    private emit: (event: ModelViewerEvent) => void
    constructor(_canvas: unknown, _root: unknown, options: { onEvent: (event: ModelViewerEvent) => void }) { this.emit = options.onEvent }
    load = () => { calls.load(); this.emit({ type: 'phase', phase: 'ready' }) }
    dispose = calls.dispose
    setDprCap() {}
    beginParameterInteraction = calls.begin
    endParameterInteraction = calls.end
    resetView = calls.reset
  },
}))
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('精简查看器工具栏', () => {
  it('常用视图操作移出更多，保留次要操作并支持 Escape 返回焦点', async () => {
    render(<ModelViewport source={null} modelName="院落" onZoom={() => {}} onEnd={() => {}} />)
    const toolbar = screen.getByRole('toolbar')
    expect(within(toolbar).getAllByRole('button')).toHaveLength(6)
    for (const name of ['复位视角', '放大查看', '全屏查看']) {
      expect(within(toolbar).getByRole('button', { name })).toBeVisible()
    }
    expect(screen.queryByRole('button', { name: /步行/ })).toBeNull()
    const trigger = screen.getByRole('button', { name: '… 更多' })
    fireEvent.click(trigger)
    expect(screen.getByRole('menu')).toBeVisible()
    for (const name of ['复位视角', '放大查看', '全屏查看']) {
      expect(screen.queryByRole('menuitem', { name })).toBeNull()
    }
    for (const name of ['保存 PNG 截图', '录制 35 秒', '显示设置', '模型信息', '结束预览']) {
      expect(screen.getByRole('menuitem', { name })).toBeVisible()
    }
    await waitFor(() => expect(screen.getByRole('menuitem', { name: '保存 PNG 截图' })).toHaveFocus())
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'End' })
    expect(screen.getByRole('menuitem', { name: '结束预览' })).toHaveFocus()
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(trigger).toHaveFocus()
  })

  it('建模说明进入信息面板，面板互斥且文字更新不会重载模型', () => {
    const view = render(<ModelViewport source={null} modelName="院落" modelingNote="实景重建\n保留屋檐细节" />)
    fireEvent.click(screen.getByRole('button', { name: '… 更多' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /模型信息/ }))
    expect(screen.queryByRole('menu')).toBeNull()
    expect(screen.getByRole('heading', { name: '建模说明' })).toBeVisible()
    expect(screen.getByText(/保留屋檐细节/)).toBeVisible()
    view.rerender(<ModelViewport source={null} modelName="院落" modelingNote="更新后的说明" />)
    expect(screen.getByText('更新后的说明')).toBeVisible()
    expect(calls.load).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: '关闭模型信息' }))
    expect(screen.getByRole('button', { name: '… 更多' })).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: '… 更多' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '显示设置' }))
    expect(screen.getByRole('complementary', { name: '显示设置' })).toBeVisible()
    expect(screen.queryByRole('complementary', { name: '模型信息' })).toBeNull()
    expect(screen.queryByLabelText('步行相对速度')).toBeNull()
  })
})
