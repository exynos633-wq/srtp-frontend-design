import { useParams } from 'react-router'
import DevPlaceholder from '../../components/DevPlaceholder'

export default function WorkEditPage() {
  const { id } = useParams<{ id: string }>()

  return (
    <DevPlaceholder
      route="/admin/works/:id/edit"
      title="编辑作品"
      note={
        <>
          编辑表单与离开保护在 P11 实现；模型文件替换需要先下架、等服务端确认无会话后
          才能替换（P13）。当前作品编号：<code>{id ?? '（缺失）'}</code>。
        </>
      }
    />
  )
}
