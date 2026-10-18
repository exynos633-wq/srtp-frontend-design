import { useParams } from 'react-router'
import DevPlaceholder from '../components/DevPlaceholder'

export default function WorkDetailPage() {
  const { id } = useParams<{ id: string }>()

  return (
    <DevPlaceholder
      route="/works/:id"
      title="作品详情"
      note={
        <>
          观看区外壳与“未启动、准备中、繁忙、离线、断线、结束”状态在 P05
          实现；本页不会加载模型，也不会申请渲染会话。当前作品编号：
          <code>{id ?? '（缺失）'}</code>。
        </>
      }
    />
  )
}
