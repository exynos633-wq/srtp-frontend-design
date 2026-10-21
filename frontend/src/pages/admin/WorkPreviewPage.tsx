import { useLayoutEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router'
import { getAdminWork } from '../../api/adminWorks'
import { isApiError } from '../../api/http'
import { queryKeys } from '../../api/queryKeys'
import { Button } from '../../components/ui/Button'
import { PageHeader } from '../../components/ui/PageHeader'
import { StatusMessage } from '../../components/ui/StatusMessage'
import { PreviewViewer } from '../../components/works/PreviewViewer'
import {
  modelFormatLabel,
  workDisplayName,
  workStatusLabel,
} from '../../lib/workLabels'
import adminStyles from './AdminPages.module.css'
import styles from './WorkPreviewPage.module.css'

export default function WorkPreviewPage() {
  const { id } = useParams<{ id: string }>()
  const titleRef = useRef<HTMLHeadingElement>(null)
  const stateHeadingRef = useRef<HTMLHeadingElement>(null)
  const focusedTitleRef = useRef<string | null>(null)
  const retryingRef = useRef(false)

  const { data, isError, isFetching, isFetchedAfterMount, error, refetch } = useQuery({
    queryKey: queryKeys.admin.work(id ?? ''),
    queryFn: ({ signal }) => getAdminWork(id ?? '', signal),
    enabled: Boolean(id),
    // 预览授权按当前作品状态重新检查，不复用可能过期的草稿缓存。
    staleTime: 0,
    refetchOnMount: 'always',
  })

  const notFound = !id || (isApiError(error) && error.status === 404)
  const unauthorized = isApiError(error) && error.status === 401
  const forbidden = isApiError(error) && error.status === 403
  // 本次挂载确认成功前不展示缓存；失败后也不渲染旧草稿。
  const confirmed = Boolean(id) && isFetchedAfterMount && !isError
  const work = confirmed ? data : undefined
  const awaitingConfirmation = Boolean(id) && !notFound && !isError && !confirmed

  useLayoutEffect(() => {
    if (!work) {
      focusedTitleRef.current = null
      return
    }
    if (focusedTitleRef.current === work.id) return
    focusedTitleRef.current = work.id
    // 仅本次进入并确认成功后聚焦；后台刷新同一作品不再抢焦点。
    titleRef.current?.focus({ preventScroll: true })
  }, [work])

  useLayoutEffect(() => {
    if (isError || !id) stateHeadingRef.current?.focus({ preventScroll: true })
  }, [id, isError])

  async function retryPreview() {
    if (retryingRef.current) return
    retryingRef.current = true
    try {
      await refetch()
    } finally {
      retryingRef.current = false
    }
  }

  const errorMessage = error instanceof Error ? error.message : '读取预览数据失败，请稍后手动重试。'

  return (
    <div className={adminStyles.page}>
      <Link className={styles.back} to="/admin/works">
        <span aria-hidden="true">←</span>
        返回作品管理
      </Link>

      <PageHeader
        eyebrow="ADMIN PREVIEW"
        title="管理员预览"
        description="检查作品封面与展示效果。草稿和已下架作品仅供管理员查看。"
        headingRef={titleRef}
        headingTabIndex={-1}
      />

      <StatusMessage tone="info">
        当前为模拟预览，真实模型观看尚未接入。点击“开始预览”后展示模拟效果。
      </StatusMessage>

      {awaitingConfirmation ? (
        <div className={styles.state} aria-busy="true">
          <StatusMessage tone="info">正在读取授权预览数据…</StatusMessage>
        </div>
      ) : null}

      {notFound ? (
        <div className={styles.state}>
          <h2 className={styles.stateTitle} ref={stateHeadingRef} tabIndex={-1}>
            作品不存在
          </h2>
          <StatusMessage tone="error">
            该作品可能已被移除，或编号有误。请返回作品管理核对作品列表。
          </StatusMessage>
        </div>
      ) : null}

      {!notFound && unauthorized ? (
        <div className={styles.state}>
          <h2 className={styles.stateTitle} ref={stateHeadingRef} tabIndex={-1}>
            登录已失效
          </h2>
          <StatusMessage tone="error">
            预览授权检查失败，请重新登录后再打开此作品的预览。
          </StatusMessage>
        </div>
      ) : null}

      {!notFound && forbidden ? (
        <div className={styles.state}>
          <h2 className={styles.stateTitle} ref={stateHeadingRef} tabIndex={-1}>
            无权预览此作品
          </h2>
          <StatusMessage tone="error">
            当前管理员无权读取该作品的预览数据。请返回作品管理或联系管理员核对权限。
          </StatusMessage>
        </div>
      ) : null}

      {!notFound && isError && !unauthorized && !forbidden ? (
        <div className={styles.state}>
          <h2 className={styles.stateTitle} ref={stateHeadingRef} tabIndex={-1}>
            预览读取失败
          </h2>
          <StatusMessage tone="error">{errorMessage}</StatusMessage>
          <div className={styles.stateAction}>
            <Button onClick={() => void retryPreview()}>
              {isFetching ? '正在重试…' : '手动重试'}
            </Button>
          </div>
        </div>
      ) : null}

      {work ? (
        <div className={styles.layout}>
          <div className={styles.viewerColumn}>
            <PreviewViewer
              key={work.id}
              work={{
                id: work.id,
                name: workDisplayName(work.name),
                coverUrl: work.coverUrl ?? '',
              }}
            />
          </div>

          <aside className={styles.meta} aria-label="作品信息">
            <div className={styles.metaHead}>
              <p className={styles.eyebrow}>当前预览</p>
              <h2 className={styles.workName}>{workDisplayName(work.name)}</h2>
            </div>

            <dl className={styles.metaList}>
              <div className={styles.metaRow}>
                <dt>状态</dt>
                <dd>
                  <span className={styles.status} data-status={work.status}>
                    {workStatusLabel(work.status)}
                  </span>
                </dd>
              </div>
              <div className={styles.metaRow}>
                <dt>城市</dt>
                <dd>{work.city?.name ?? '未设置城市'}</dd>
              </div>
              <div className={styles.metaRow}>
                <dt>格式</dt>
                <dd>{modelFormatLabel(work.modelFormat)}</dd>
              </div>
            </dl>

            <p className={styles.note}>
              此处供你检查作品资料，预览不会改变作品的发布状态。
            </p>
          </aside>
        </div>
      ) : null}
    </div>
  )
}
