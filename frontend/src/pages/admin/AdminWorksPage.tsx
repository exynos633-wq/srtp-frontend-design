import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { Link } from 'react-router'
import {
  listAdminWorks,
  publishAdminWork,
  unpublishAdminWork,
} from '../../api/adminWorks'
import { isApiError } from '../../api/http'
import { adminWorkInvalidationKeys, publicWorkInvalidationKeys, queryKeys } from '../../api/queryKeys'
import { Button } from '../../components/ui/Button'
import { PageHeader } from '../../components/ui/PageHeader'
import { StatusMessage } from '../../components/ui/StatusMessage'
import { classNames } from '../../lib/classNames'
import { prefersReducedMotion } from '../../lib/prefersReducedMotion'
import { modelFormatLabel, workDisplayName, workStatusLabel } from '../../lib/workLabels'
import type { ItemList } from '../../types/api'
import type { AdminWork, WorkStatus } from '../../types/work'
import adminStyles from './AdminPages.module.css'
import styles from './AdminWorksPage.module.css'

const ACTION_FIELD_LABELS: Record<string, string> = {
  name: '名称',
  description: '建筑介绍',
  coverAssetId: '封面',
  modelAssetId: '模型资源',
  cityId: '城市',
}

type WorkAction = 'publish' | 'unpublish'

interface ActionError {
  workId: string
  message: string
  fields?: Record<string, string>
}

function WorkCover({ coverUrl }: { coverUrl: string | null }) {
  const [failed, setFailed] = useState(false)

  if (!coverUrl || failed) {
    return <span className={styles.coverFallback}>缺封面</span>
  }

  return (
    <span className={styles.coverBox}>
      <img
        className={styles.coverImage}
        src={coverUrl}
        alt=""
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
      />
    </span>
  )
}

function StatusBadge({ status }: { status: WorkStatus }) {
  return (
    <span className={styles.status} data-status={status}>
      {workStatusLabel(status)}
    </span>
  )
}

function fieldSummary(fields?: Record<string, string>): string {
  if (!fields) return ''
  const labels = Object.keys(fields).map((key) => ACTION_FIELD_LABELS[key] ?? key)
  return labels.length > 0 ? `需补齐：${labels.join('、')}。` : ''
}

export default function AdminWorksPage() {
  const pageRef = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const errorHeadingRef = useRef<HTMLHeadingElement>(null)
  const actionErrorRef = useRef<HTMLHeadingElement>(null)
  const focusedTitleRef = useRef(false)
  const retryingRef = useRef(false)
  const actionBusyRef = useRef(false)
  const mountedRef = useRef(true)
  const client = useQueryClient()

  const [pendingAction, setPendingAction] = useState<{
    id: string
    action: WorkAction
  } | null>(null)
  const [actionError, setActionError] = useState<ActionError | null>(null)
  const [actionNotice, setActionNotice] = useState('')

  const { data, isError, isFetching, isFetchedAfterMount, error, refetch } = useQuery({
    queryKey: queryKeys.admin.works(),
    queryFn: ({ signal }) => listAdminWorks(signal),
    // 管理数据每次进入都向服务端确认，避免把过期状态当成当前列表。
    staleTime: 0,
    refetchOnMount: 'always',
  })

  const actionMutation = useMutation({
    mutationKey: queryKeys.admin.works(),
    mutationFn: ({ id, action }: { id: string; action: WorkAction }) =>
      action === 'publish' ? publishAdminWork(id) : unpublishAdminWork(id),
  })

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  // 缓存在本次挂载确认前不当作当前列表展示。
  const confirmed = isFetchedAfterMount && !isError
  const works = confirmed ? (data?.items ?? []) : []
  const awaitingConfirmation = !isError && !confirmed
  const actionPending = pendingAction !== null

  // 与公开列表一致：只在减少动态偏好之外做轻量分区进入。
  useGSAP(
    () => {
      if (works.length === 0 || prefersReducedMotion()) return
      const rows = pageRef.current?.querySelectorAll<HTMLElement>('[data-admin-work]')
      if (!rows || rows.length === 0) return
      // 只做短位移，不靠透明度隐藏内容；慢设备或测试中信息也立即可读。
      const tween = gsap.fromTo(
        rows,
        { y: 12 },
        {
          y: 0,
          duration: 0.32,
          ease: 'power2.out',
          stagger: 0.035,
          overwrite: true,
          clearProps: 'transform',
        },
      )
      return () => {
        tween.kill()
        gsap.set(rows, { clearProps: 'transform' })
      }
    },
    { scope: pageRef, dependencies: [works.length] },
  )

  useLayoutEffect(() => {
    if (!confirmed) {
      focusedTitleRef.current = false
      return
    }
    if (focusedTitleRef.current) return
    focusedTitleRef.current = true
    // 数据确认后把阅读起点交给主标题；后台刷新不重复抢焦点。
    titleRef.current?.focus({ preventScroll: true })
  }, [confirmed])

  useLayoutEffect(() => {
    if (isError) errorHeadingRef.current?.focus({ preventScroll: true })
  }, [isError])

  async function retryList() {
    if (retryingRef.current) return
    retryingRef.current = true
    try {
      await refetch()
    } finally {
      retryingRef.current = false
    }
  }

  function focusWorkAction(id: string) {
    if (!mountedRef.current) return
    pageRef.current
      ?.querySelector<HTMLButtonElement>(`[data-work-action="${id}"]`)
      ?.focus({ preventScroll: true })
  }

  async function runAction(work: AdminWork, action: WorkAction) {
    if (actionBusyRef.current) return
    const name = workDisplayName(work.name)

    if (action === 'unpublish') {
      const confirmedByUser = window.confirm(
        `确定下架《${name}》吗？下架后公开目录和城市列表会立即移除该作品。`,
      )
      if (!confirmedByUser) {
        focusWorkAction(work.id)
        return
      }
    }

    actionBusyRef.current = true
    setPendingAction({ id: work.id, action })
    setActionError(null)
    setActionNotice('')

    try {
      const updated = await actionMutation.mutateAsync({ id: work.id, action })

      // 服务端已提交：公开缓存先失效，即使本页已在退出过程中卸载。
      for (const queryKey of publicWorkInvalidationKeys) {
        void client.invalidateQueries({ queryKey })
      }
      // 退出后迟到的结果不能回填私有管理缓存。
      if (client.getQueryData(queryKeys.auth.me()) == null) return
      if (!mountedRef.current) {
        for (const queryKey of adminWorkInvalidationKeys) {
          void client.invalidateQueries({ queryKey })
        }
        return
      }

      client.setQueryData<ItemList<AdminWork>>(queryKeys.admin.works(), (current) =>
        current
          ? {
              items: current.items.map((item) => (item.id === updated.id ? updated : item)),
            }
          : current,
      )
      client.setQueryData(queryKeys.admin.work(updated.id), updated)
      for (const queryKey of adminWorkInvalidationKeys) {
        void client.invalidateQueries({ queryKey })
      }

      setActionNotice(
        action === 'publish' ? `已发布《${name}》。` : `已下架《${name}》。`,
      )
      window.setTimeout(() => focusWorkAction(updated.id), 0)
    } catch (failure) {
      if (!mountedRef.current) return
      if (isApiError(failure)) {
        // 401/403 由 MutationCache 交给 AuthGate 处理。
        if (failure.status === 401 || failure.status === 403) return
        setActionError({
          workId: work.id,
          message: failure.message,
          fields: failure.fields,
        })
      } else {
        setActionError({
          workId: work.id,
          message: '发布或下架未完成，请稍后手动重试。',
        })
      }
      window.setTimeout(() => actionErrorRef.current?.focus({ preventScroll: true }), 0)
    } finally {
      actionBusyRef.current = false
      if (mountedRef.current) setPendingAction(null)
    }
  }

  const errorMessage =
    error instanceof Error ? error.message : '读取管理作品列表失败，请稍后手动重试。'

  return (
    <div className={classNames(adminStyles.page, styles.worksPage)} ref={pageRef}>
      <div className={styles.head}>
        <PageHeader
          eyebrow="ADMIN"
          title="作品管理"
          description="按更新时间展示草稿、已发布与已下架作品。发布与下架以服务端结果为准。"
          headingRef={titleRef}
          headingTabIndex={-1}
        />
        <Link className={styles.primaryLink} to="/admin/works/new">
          新建作品
        </Link>
      </div>

      <StatusMessage tone="info">
        发布前请先保存作品资料；发布与下架都会刷新公开目录、详情和城市列表。下架不会删除作品。
      </StatusMessage>

      {actionNotice ? <StatusMessage tone="success">{actionNotice}</StatusMessage> : null}

      {actionError ? (
        <div className={styles.state}>
          <h2 className={styles.stateTitle} ref={actionErrorRef} tabIndex={-1}>
            发布或下架未完成
          </h2>
          <StatusMessage tone="error">
            {actionError.message}
            {fieldSummary(actionError.fields)}
          </StatusMessage>
          {actionError.fields ? (
            <div className={styles.stateAction}>
              <Link
                className={styles.actionLink}
                to={`/admin/works/${actionError.workId}/edit`}
              >
                去编辑补齐
              </Link>
            </div>
          ) : null}
        </div>
      ) : null}

      {awaitingConfirmation ? (
        <div className={styles.state} aria-busy="true">
          <StatusMessage tone="info">正在读取管理作品列表…</StatusMessage>
        </div>
      ) : null}

      {isError ? (
        <div className={styles.state}>
          <h2 className={styles.stateTitle} ref={errorHeadingRef} tabIndex={-1}>
            作品列表读取失败
          </h2>
          <StatusMessage tone="error">{errorMessage}</StatusMessage>
          <div className={styles.stateAction}>
            <Button onClick={() => void retryList()}>
              {isFetching ? '正在重试…' : '手动重试'}
            </Button>
          </div>
        </div>
      ) : null}

      {confirmed && works.length === 0 ? (
        <div className={styles.state}>
          <StatusMessage tone="info">管理列表暂无作品。可先新建草稿。</StatusMessage>
        </div>
      ) : null}

      {confirmed && works.length > 0 ? (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <caption className={styles.caption}>管理作品列表</caption>
            <colgroup>
              <col className={styles.coverCol} />
              <col />
              <col className={styles.statusCol} />
              <col className={styles.cityCol} />
              <col className={styles.formatCol} />
              <col className={styles.actionsCol} />
            </colgroup>
            <thead className={styles.tableHead}>
              <tr>
                <th scope="col" className={styles.th}>
                  封面
                </th>
                <th scope="col" className={styles.th}>
                  名称
                </th>
                <th scope="col" className={styles.th}>
                  状态
                </th>
                <th scope="col" className={styles.th}>
                  城市
                </th>
                <th scope="col" className={styles.th}>
                  格式
                </th>
                <th scope="col" className={styles.th}>
                  操作
                </th>
              </tr>
            </thead>
            <tbody className={styles.tableBody}>
              {works.map((work) => {
                const name = workDisplayName(work.name)
                const isPublished = work.status === 'published'
                const action: WorkAction = isPublished ? 'unpublish' : 'publish'
                const pending = pendingAction?.id === work.id
                return (
                  <tr className={styles.row} data-admin-work key={work.id}>
                    <td className={classNames(styles.cell, styles.coverCell)}>
                      <WorkCover key={`${work.id}:${work.coverUrl ?? ''}`} coverUrl={work.coverUrl} />
                    </td>
                    <td className={classNames(styles.cell, styles.nameCell)}>
                      <span className={styles.name}>{name}</span>
                    </td>
                    <td className={classNames(styles.cell, styles.statusCell)}>
                      <StatusBadge status={work.status} />
                    </td>
                    <td className={classNames(styles.cell, styles.cityCell)} data-label="城市">
                      {work.city?.name ?? '未设置城市'}
                    </td>
                    <td className={classNames(styles.cell, styles.formatCell)} data-label="格式">
                      {modelFormatLabel(work.modelFormat)}
                    </td>
                    <td className={classNames(styles.cell, styles.actionsCell)} data-label="操作">
                      <div className={styles.actions}>
                        <Link
                          className={styles.actionLink}
                          to={`/admin/works/${work.id}/edit`}
                          aria-label={`编辑 ${name}`}
                        >
                          编辑
                        </Link>
                        <Link
                          className={styles.actionLink}
                          to={`/admin/works/${work.id}/preview`}
                          aria-label={`预览 ${name}`}
                        >
                          预览
                        </Link>
                        <Button
                          data-work-action={work.id}
                          disabled={actionPending}
                          aria-busy={pending || undefined}
                          aria-label={`${isPublished ? '下架' : '发布'} ${name}`}
                          title={`${isPublished ? '下架' : '发布'}《${name}》`}
                          onClick={() => void runAction(work, action)}
                        >
                          {pending
                            ? pendingAction.action === 'publish'
                              ? '正在发布…'
                              : '正在下架…'
                            : isPublished
                              ? '下架'
                              : '发布'}
                        </Button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  )
}
