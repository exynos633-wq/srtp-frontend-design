import { useParams } from 'react-router'
import DevPlaceholder from '../../components/DevPlaceholder'

export default function WorkPreviewPage() {
  const { id } = useParams<{ id: string }>()

  return (
    <DevPlaceholder
      route="/admin/works/:id/preview"
      title="管理员预览"
      note={
        <>
          预览复用观看区外壳（P05）；作品可见性与预览授权由服务端负责，前端不做
          权限伪装。当前不加载模型，也不创建会话。当前作品编号：
          <code>{id ?? '（缺失）'}</code>。
        </>
      }
    />
  )
}
