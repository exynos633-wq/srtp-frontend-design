import type { ReactElement } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { PublicNav } from '../../src/components/layouts/PublicNav'
import { Button } from '../../src/components/ui/Button'
import { SelectField } from '../../src/components/ui/SelectField'
import { SkipLink } from '../../src/components/ui/SkipLink'
import { StatusMessage } from '../../src/components/ui/StatusMessage'
import { TextareaField } from '../../src/components/ui/TextareaField'
import { TextField } from '../../src/components/ui/TextField'
import { WorkCard } from '../../src/components/works/WorkCard'

const withRouter = (ui: ReactElement, path = '/') =>
  render(<MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>)

describe('Button', () => {
  it('默认不提交表单，并可使用禁用态', () => {
    render(<Button>保存草稿</Button>)
    const button = screen.getByRole('button', { name: '保存草稿' })
    expect(button.getAttribute('type')).toBe('button')
    expect(button).toBeEnabled()
  })

  it('禁用按钮保持文字可读（不整块降透明度）', () => {
    render(<Button disabled>登录</Button>)
    expect(screen.getByRole('button', { name: '登录' })).toBeDisabled()
  })
})

describe('字段', () => {
  it('文本字段关联标签、必填语义与错误说明', () => {
    render(<TextField id="work-name" label="名称" required error="名称不能为空" />)

    const input = screen.getByLabelText('名称')
    expect(input).toBeRequired()
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAttribute('aria-describedby', 'work-name-error')
    expect(screen.getByText('必填')).toBeVisible()
    expect(screen.getByRole('alert')).toHaveTextContent('名称不能为空')
  })

  it('无错误时使用提示文本', () => {
    render(<TextField id="work-note" label="建模说明" hint="选填，最多 2000 字" />)

    const input = screen.getByLabelText('建模说明')
    expect(input).toHaveAttribute('aria-describedby', 'work-note-hint')
    expect(input).not.toHaveAttribute('aria-invalid')
    expect(screen.getByText('选填，最多 2000 字')).toBeVisible()
  })

  it('多行文本可用 Enter 换行', () => {
    render(<TextareaField id="intro" label="建筑介绍" />)

    const textarea = screen.getByLabelText('建筑介绍')
    expect(textarea.tagName).toBe('TEXTAREA')
    expect(textarea).not.toHaveAttribute('aria-invalid')
  })

  it('选择字段使用原生 select', () => {
    render(
      <SelectField id="province" label="省份" defaultValue="">
        <option value="">请选择省份</option>
        <option value="110000">北京市</option>
      </SelectField>,
    )

    const select = screen.getByLabelText('省份')
    expect(select.tagName).toBe('SELECT')
    expect(select).toHaveValue('')
    expect(screen.getByRole('option', { name: '北京市' })).toBeVisible()
  })
})

describe('StatusMessage', () => {
  it('一般说明用 status，错误用 alert', () => {
    const { rerender } = render(<StatusMessage tone="info">演示数据</StatusMessage>)
    expect(screen.getByRole('status')).toHaveTextContent('演示数据')

    rerender(<StatusMessage tone="error">保存失败</StatusMessage>)
    expect(screen.getByRole('alert')).toHaveTextContent('保存失败')
  })
})

describe('WorkCard', () => {
  it('整卡只有一个链接，未填城市显示统一文案', () => {
    withRouter(
      <ul>
        <WorkCard workId="work_demo_001" href="/works/work_demo_001" title="院落模型" cityName={null} />
      </ul>,
    )

    expect(screen.getAllByRole('link')).toHaveLength(1)
    expect(screen.getByRole('link')).toHaveAttribute('href', '/works/work_demo_001')
    expect(screen.getByRole('heading', { name: '院落模型' })).toBeVisible()
    expect(screen.getByText('未设置城市')).toBeVisible()
  })

  it('已有城市时显示城市名', () => {
    withRouter(
      <ul>
        <WorkCard workId="work_demo_002" href="/works/work_demo_002" title="长城模型" cityName="北京市（演示）" />
      </ul>,
    )

    expect(screen.getByText('北京市（演示）')).toBeVisible()
    expect(screen.queryByText('未设置城市')).toBeNull()
  })

  it('封面加载失败时给出非模型替代，不保留破图', () => {
    const { container } = withRouter(
      <ul>
        <WorkCard
          workId="work_demo_001"
          href="/works/work_demo_001"
          title="院落模型"
          coverUrl="/mock/cover-missing.png"
        />
      </ul>,
    )

    fireEvent.error(container.querySelector('img') as HTMLImageElement)
    expect(screen.getByText('封面暂不可用')).toBeVisible()
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getAllByRole('link')).toHaveLength(1)
  })

  it('无封面地址时显示“暂无封面”，仍可进入详情', () => {
    withRouter(
      <ul>
        <WorkCard workId="work_demo_003" href="/works/work_demo_003" title="丘陵模型" coverUrl={null} />
      </ul>,
    )

    expect(screen.getByText('暂无封面')).toBeVisible()
    expect(screen.getByRole('link', { name: /丘陵模型/ })).toHaveAttribute(
      'href',
      '/works/work_demo_003',
    )
  })
})

describe('导航与跳转入口', () => {
  it('当前页链接带 aria-current，其余不带', () => {
    withRouter(<PublicNav />, '/works')

    const nav = screen.getByRole('navigation', { name: '公开展示区导航' })
    expect(nav).toBeVisible()
    expect(screen.getByRole('link', { name: '全部作品' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: '地图探索' })).not.toHaveAttribute('aria-current')
  })

  it('跳到主要内容指向主区锚点', () => {
    render(<SkipLink />)
    expect(screen.getByRole('link', { name: '跳到主要内容' })).toHaveAttribute(
      'href',
      '#main-content',
    )
  })
})
