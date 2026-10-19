import DevPlaceholder from '../../components/DevPlaceholder'

export default function AdminWorksPage() {
  return (
    <DevPlaceholder
      route="/admin/works"
      title="作品管理"
      note="作品列表与操作在 P10 实现；当前没有数据，也没有登录态。P01 不含任何权限判断，能打开本页不代表已登录——真实权限由服务端校验。"
    />
  )
}
