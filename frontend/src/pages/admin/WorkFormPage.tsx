import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useBlocker, useNavigate } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createAdminWork, getAdminWork, updateAdminWork } from '../../api/adminWorks'
import { listCities, listProvinces } from '../../api/dictionary'
import { isApiError } from '../../api/http'
import { isUploadSimulationEnabled } from '../../api/mockUploads'
import { isMocksActive } from '../../app/mocksStatus'
import { invalidateAfterWorkChange, queryKeys } from '../../api/queryKeys'
import { UploadField } from '../../components/uploads/UploadField'
import { Button } from '../../components/ui/Button'
import { PageHeader } from '../../components/ui/PageHeader'
import { SelectField } from '../../components/ui/SelectField'
import { StatusMessage } from '../../components/ui/StatusMessage'
import { TextareaField } from '../../components/ui/TextareaField'
import { TextField } from '../../components/ui/TextField'
import { registerLeaveGuard } from '../../lib/leaveGuard'
import { classNames } from '../../lib/classNames'
import { useMockUpload } from '../../lib/useMockUpload'
import { workStatusLabel } from '../../lib/workLabels'
import {
  baselineFromAdminWork,
  draftFromAdminWork,
  EMPTY_WORK_BASELINE,
  EMPTY_WORK_DRAFT,
  isDraftDirty,
  toCreateInput,
  toPatchInput,
  type WorkFormDraft,
} from '../../lib/workForm'
import type { AdminWork, WorkWriteInput } from '../../types/work'
import styles from './WorkFormPage.module.css'

const LEAVE_MESSAGE = '有未保存的修改，离开后这些修改会丢失。确定离开吗？'

const FIELD_IDS = {
  name: 'work-name',
  cityId: 'work-city',
  description: 'work-description',
  modelingNote: 'work-modeling-note',
  modelAssetId: 'work-model-asset',
  coverAssetId: 'work-cover-asset',
} as const

type ServerField = keyof typeof FIELD_IDS
const FIELD_ORDER: ServerField[] = [
  'name',
  'cityId',
  'description',
  'modelingNote',
  'modelAssetId',
  'coverAssetId',
]

interface WorkFormPageProps {
  /** 新建时不传；编辑时使用既有管理路由的作品编号。 */
  workId?: string
}

function focusElement(field: ServerField) {
  let element = document.getElementById(FIELD_IDS[field])
  // 城市字段在未选省份时不可操作，把焦点交给省份，避免聚焦失败。
  if (field === 'cityId' && element instanceof HTMLSelectElement && element.disabled) {
    element = document.getElementById('work-province')
  }
  element?.focus()
  element?.scrollIntoView?.({ block: 'center' })
}

function BackLink() {
  return (
    <Link className={styles.backLink} to="/admin/works">
      返回作品管理
    </Link>
  )
}

/** 编辑读取：本次挂载等待服务端确认后才挂载表单，缓存不先于确认展示。 */
function WorkFormLoader({
  workId,
  onConfirmed,
}: {
  workId: string
  onConfirmed: (work: AdminWork) => void
}) {
  const workQuery = useQuery({
    queryKey: queryKeys.admin.work(workId),
    queryFn: ({ signal }) => getAdminWork(workId, signal),
    staleTime: 0,
    refetchOnMount: 'always',
  })
  const errorHeadingRef = useRef<HTMLHeadingElement>(null)

  useLayoutEffect(() => {
    if (!workQuery.isError) return
    errorHeadingRef.current?.focus({ preventScroll: true })
  }, [workQuery.isError])

  // 确认后把数据交给上层并卸载本读取器；表单挂载后不再观察该查询，
  // 因此后台刷新失败或迟到结果都不会撤掉、覆盖未保存输入。
  useEffect(() => {
    if (workQuery.data && workQuery.isFetchedAfterMount && !workQuery.isError) {
      onConfirmed(workQuery.data)
    }
  }, [onConfirmed, workQuery.data, workQuery.isError, workQuery.isFetchedAfterMount])

  if (workQuery.isError) {
    const message =
      workQuery.error instanceof Error ? workQuery.error.message : '读取作品失败，请手动重试。'
    return (
      <div className={classNames(styles.page, styles.statePage)}>
        <div className={styles.head}>
          <PageHeader
            eyebrow={`WORK ${workId}`}
            title="编辑作品"
            description="读取尚未完成确认，因此暂不显示可能过期的草稿内容。"
          />
          <BackLink />
        </div>
        <h2 className={styles.stateTitle} ref={errorHeadingRef} tabIndex={-1}>
          作品读取失败
        </h2>
        <StatusMessage tone="error">{message}</StatusMessage>
        <div className={styles.stateActions}>
          <Button onClick={() => void workQuery.refetch()}>
            {workQuery.isFetching ? '正在重试…' : '手动重试'}
          </Button>
          <BackLink />
        </div>
      </div>
    )
  }

  if (!workQuery.data || !workQuery.isFetchedAfterMount) {
    return (
      <div className={classNames(styles.page, styles.statePage)}>
        <div className={styles.head}>
          <PageHeader
            eyebrow={`WORK ${workId}`}
            title="编辑作品"
            description="正在读取作品数据；读取完成前不会显示旧内容。"
          />
          <BackLink />
        </div>
        <StatusMessage tone="info">正在读取作品数据…</StatusMessage>
      </div>
    )
  }

  return (
    <div className={classNames(styles.page, styles.statePage)}>
      <div className={styles.head}>
        <PageHeader
          eyebrow={`WORK ${workId}`}
          title="编辑作品"
          description="正在打开编辑表单。"
        />
        <BackLink />
      </div>
      <StatusMessage tone="info">正在打开编辑表单…</StatusMessage>
    </div>
  )
}

export default function WorkFormPage({ workId }: WorkFormPageProps) {
  const [initialWork, setInitialWork] = useState<AdminWork | null>(null)

  if (workId === undefined) return <WorkForm />
  if (initialWork) {
    return <WorkForm key={initialWork.id} workId={workId} initialWork={initialWork} />
  }
  return <WorkFormLoader workId={workId} onConfirmed={setInitialWork} />
}

interface WorkFormProps {
  workId?: string
  initialWork?: AdminWork
}

function WorkForm({ workId, initialWork }: WorkFormProps) {
  const isNew = workId === undefined
  const navigate = useNavigate()
  const client = useQueryClient()

  // 编辑表单只在读取确认后挂载；之后的后台刷新不会改写这些初始快照。
  const [draft, setDraft] = useState<WorkFormDraft>(() =>
    initialWork ? draftFromAdminWork(initialWork) : EMPTY_WORK_DRAFT,
  )
  const [baseline, setBaseline] = useState(() =>
    initialWork ? baselineFromAdminWork(initialWork) : EMPTY_WORK_BASELINE,
  )
  const [work, setWork] = useState<AdminWork | null>(initialWork ?? null)
  const [saving, setSaving] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState('')
  const [savedMessage, setSavedMessage] = useState('')
  const titleRef = useRef<HTMLHeadingElement>(null)

  const uploadsEnabled = isUploadSimulationEnabled(import.meta.env.DEV, isMocksActive())
  const modelUpload = useMockUpload('model')
  const coverUpload = useMockUpload('cover')
  const status = work?.status ?? 'draft'
  const hasUnsavedSelection = modelUpload.selection !== null || coverUpload.selection !== null
  const hasUnsettledSelection = modelUpload.hasUnsettled || coverUpload.hasUnsettled
  const resourceEditingDisabled = saving || !uploadsEnabled || status !== 'draft'
  const resourceDisabledReason = !uploadsEnabled
    ? '当前环境未开放上传；正式上传协议与校验规则待确认。'
    : status !== 'draft'
      ? '已发布或已下架作品的资源替换尚未开放；本页只更新资料。'
      : saving
        ? '正在保存，完成后再选择文件。'
        : undefined

  // 通过 MutationCache 的 admin mutationKey 走现有 401/403 清理与 AuthGate 通知。
  const saveMutation = useMutation({
    mutationKey: queryKeys.admin.works(),
    mutationFn: ({ id, input }: { id: string | null; input: WorkWriteInput }) =>
      id ? updateAdminWork(id, input) : createAdminWork(input),
  })

  useLayoutEffect(() => {
    // 新建或编辑确认后，焦点落在页面标题，便于从任务起点开始键盘操作。
    titleRef.current?.focus({ preventScroll: true })
  }, [])

  const savingRef = useRef(false)
  const createdIdRef = useRef<string | null>(null)
  const mountedRef = useRef(true)
  const allowedNavigationRef = useRef<string | null>(null)
  const dirtyRef = useRef(false)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const dirty = useMemo(
    () => isDraftDirty(draft, baseline) || hasUnsavedSelection,
    [baseline, draft, hasUnsavedSelection],
  )
  useEffect(() => {
    dirtyRef.current = dirty
  }, [dirty])

  const confirmLeave = useCallback(() => {
    if (!dirtyRef.current) return true
    return window.confirm(LEAVE_MESSAGE)
  }, [])

  const allowNavigationTo = useCallback((pathname: string) => {
    allowedNavigationRef.current = pathname
  }, [])

  useEffect(
    () =>
      registerLeaveGuard({
        confirmLeave,
        allowNavigationTo,
        resetConsent: () => {
          allowedNavigationRef.current = null
        },
      }),
    [allowNavigationTo, confirmLeave],
  )

  const blocker = useBlocker(({ currentLocation, nextLocation }) => {
    if (!dirtyRef.current) return false
    if (allowedNavigationRef.current === nextLocation.pathname) {
      // 只消费一次：定向放行退出成功的登录跳转或保存成功的编辑跳转。
      allowedNavigationRef.current = null
      return false
    }
    return (
      currentLocation.pathname !== nextLocation.pathname ||
      currentLocation.search !== nextLocation.search
    )
  })

  useEffect(() => {
    if (blocker.state !== 'blocked') return
    if (confirmLeave()) blocker.proceed()
    else blocker.reset()
  }, [blocker, confirmLeave])

  useEffect(() => {
    if (!dirty) return
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      // 浏览器只保证展示通用提示；是否允许离开由平台决定。
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [dirty])

  const provinceId = draft.provinceId
  const provincesQuery = useQuery({
    queryKey: queryKeys.dictionary.provinces(),
    queryFn: ({ signal }) => listProvinces(signal),
    staleTime: 5 * 60_000,
  })
  const citiesQuery = useQuery({
    queryKey: queryKeys.dictionary.cities(provinceId ?? ''),
    queryFn: ({ signal }) => listCities(provinceId ?? '', signal),
    enabled: provinceId !== null,
    staleTime: 5 * 60_000,
  })

  const savedCity = work?.city ?? null
  const provinces = provincesQuery.data?.items ?? []
  const provinceFallback =
    provinceId !== null &&
    savedCity?.province.id === provinceId &&
    !provinces.some((province) => province.id === provinceId)
      ? savedCity.province
      : null
  const cities = citiesQuery.data?.items ?? []
  const cityFallbackName =
    draft.cityId !== null && !cities.some((city) => city.id === draft.cityId)
      ? savedCity?.id === draft.cityId
        ? savedCity.name
        : `已保存城市（编号 ${draft.cityId}）`
      : null

  const provincesLoading = provincesQuery.isPending
  const citiesLoading = provinceId !== null && citiesQuery.isPending
  const citySelectDisabled =
    saving || provinceId === null || provincesLoading || citiesLoading
  const clearCityDisabled = saving || draft.cityId === null

  function clearFeedback() {
    setFormError('')
    setSavedMessage('')
    setFieldErrors((current) => (Object.keys(current).length === 0 ? current : {}))
  }

  function changeDraft(patch: Partial<WorkFormDraft>) {
    setDraft((current) => ({ ...current, ...patch }))
    clearFeedback()
  }

  function changeProvince(value: string) {
    const nextProvince = value === '' ? null : value
    if (nextProvince === draft.provinceId) return
    // 省份只是筛选；切换后旧城市不再适用，必须清空而不是提交旧 cityId。
    changeDraft({ provinceId: nextProvince, cityId: null })
  }

  function changeCity(value: string) {
    changeDraft({ cityId: value === '' ? null : value })
  }

  function clearCity() {
    if (draft.cityId === null) return
    changeDraft({ cityId: null })
  }

  function focusFirstServerError(fields: Record<string, string>) {
    const first = FIELD_ORDER.find((field) => Boolean(fields[field]))
    if (!first) return
    window.setTimeout(() => {
      // 卸载后的迟到结果不能把焦点抢到另一件作品。
      if (!mountedRef.current) return
      focusElement(first)
    }, 0)
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (savingRef.current) return

    if (hasUnsettledSelection) {
      setFormError('模型或封面仍在模拟传输或验证中，请等待模拟验证通过或取消新选择后再保存。')
      setSavedMessage('')
      return
    }

    const resources = {
      modelAssetId: modelUpload.readyAssetId,
      coverAssetId: coverUpload.readyAssetId,
    }
    const existingId = workId ?? createdIdRef.current
    const patch = existingId ? toPatchInput(draft, baseline, resources) : null
    if (existingId && Object.keys(patch ?? {}).length === 0) {
      setFormError('')
      setFieldErrors({})
      setSavedMessage('没有需要保存的修改。')
      return
    }

    savingRef.current = true
    setSaving(true)
    setFormError('')
    setFieldErrors({})
    setSavedMessage('')

    try {
      const saved = await saveMutation.mutateAsync({
        id: existingId ?? null,
        input: existingId ? (patch ?? {}) : toCreateInput(draft, resources),
      })

      // 退回登录页后不得把迟到结果写回任何管理缓存；未挂载时只失效公开/列表，
      // 不写私有草稿，避免重新登录后旧请求恢复上一会话的敏感内容。
      if (client.getQueryData(queryKeys.auth.me()) == null) return
      if (!mountedRef.current) {
        for (const queryKey of invalidateAfterWorkChange()) {
          void client.invalidateQueries({ queryKey })
        }
        return
      }

      if (!existingId) createdIdRef.current = saved.id
      client.setQueryData(queryKeys.admin.work(saved.id), saved)
      for (const queryKey of invalidateAfterWorkChange()) {
        void client.invalidateQueries({ queryKey })
      }

      modelUpload.clearAfterSave()
      coverUpload.clearAfterSave()
      setWork(saved)
      setDraft(draftFromAdminWork(saved))
      setBaseline(baselineFromAdminWork(saved))
      setSavedMessage(
        saved.status === 'published' ? '已保存并更新公开内容。' : '已保存当前修改。',
      )

      if (isNew) {
        // 首次创建成功后进入既有编辑路由；只放行这一条目标，不打开通用绿灯。
        const editPath = `/admin/works/${saved.id}/edit`
        allowNavigationTo(editPath)
        navigate(editPath, { replace: true })
      }
    } catch (error) {
      if (!mountedRef.current) return
      if (isApiError(error)) {
        // 401/403 已由 MutationCache 交给 AuthGate 处理，不再保留本页敏感状态。
        if (error.status === 401 || error.status === 403) return
        const fields = error.fields ?? {}
        setFieldErrors(fields)
        setFormError(error.message)
        focusFirstServerError(fields)
      } else {
        setFormError('保存失败，请稍后手动重试。')
      }
    } finally {
      if (mountedRef.current) {
        savingRef.current = false
        setSaving(false)
      }
    }
  }

  const saveLabel = saving
    ? '正在保存…'
    : status === 'published'
      ? '保存并更新公开内容'
      : status === 'offline'
        ? '保存修改'
        : '保存草稿'

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <PageHeader
          eyebrow={isNew ? 'ADMIN' : `WORK ${workId}`}
          title={isNew ? '新建作品' : '编辑作品'}
          headingRef={titleRef}
          headingTabIndex={-1}
          description={
            isNew
              ? '可以只填一部分保存草稿。模型或封面要等模拟验证通过后才能绑定；保存不会自动发布。'
              : '保存会更新本页资料与已验证通过的新资源绑定。已发布作品不会自动发布或下架，资源替换尚未开放。'
          }
        />
        <BackLink />
      </div>

      <div className={styles.statusRow}>
        <span className={styles.status} data-status={status}>
          {workStatusLabel(status)}
        </span>
        {dirty ? (
          <span className={styles.dirty} role="status">
            有未保存的修改
          </span>
        ) : null}
      </div>

      {status === 'published' ? (
        <StatusMessage tone="info">
          该作品正在公开展示。保存会更新公开内容并重新检查发布必填项，但不会下架作品。
        </StatusMessage>
      ) : null}

      {formError ? <StatusMessage tone="error">{formError}</StatusMessage> : null}
      {savedMessage ? <StatusMessage tone="success">{savedMessage}</StatusMessage> : null}

      <form className={styles.form} onSubmit={(event) => void handleSubmit(event)} noValidate>
        <div className={styles.layout}>
          <div className={styles.primary}>
            <TextField
              id={FIELD_IDS.name}
              label="作品名称"
              hint="发布时必填；草稿可以留空。"
              error={fieldErrors.name}
              name="name"
              autoComplete="off"
              value={draft.name}
              readOnly={saving}
              onChange={(event) => changeDraft({ name: event.target.value })}
            />

            <div className={styles.cityGroup}>
              <div className={styles.cityRow}>
                <SelectField
                  id="work-province"
                  label="省份（选填）"
                  value={draft.provinceId ?? ''}
                  disabled={saving || provincesLoading}
                  onChange={(event) => changeProvince(event.target.value)}
                >
                  <option value="">
                    {provincesLoading ? '正在读取省份…' : '请选择省份'}
                  </option>
                  {provinces.map((province) => (
                    <option key={province.id} value={province.id}>
                      {province.name}
                    </option>
                  ))}
                  {provinceFallback ? (
                    <option value={provinceFallback.id}>{provinceFallback.name}</option>
                  ) : null}
                </SelectField>

                <SelectField
                  id={FIELD_IDS.cityId}
                  label="城市（选填）"
                  error={fieldErrors.cityId}
                  value={draft.cityId ?? ''}
                  disabled={citySelectDisabled}
                  onChange={(event) => changeCity(event.target.value)}
                >
                  <option value="">
                    {provinceId === null
                      ? '请先选择省份'
                      : citiesLoading
                        ? '正在读取城市…'
                        : '请选择城市'}
                  </option>
                  {cities.map((city) => (
                    <option key={city.id} value={city.id}>
                      {city.name}
                    </option>
                  ))}
                  {cityFallbackName ? (
                    <option value={draft.cityId ?? ''}>{cityFallbackName}</option>
                  ) : null}
                </SelectField>

                <div className={styles.clearCityWrap}>
                  <Button
                    className={styles.clearCity}
                    disabled={clearCityDisabled}
                    onClick={clearCity}
                  >
                    清除城市
                  </Button>
                </div>
              </div>

              <p className={styles.cityHint}>
                省份只用于筛选城市，不单独保存；只选省份时城市仍为空。填写城市后可从地球城市卡片发现，
                不填仍可保存与发布。
              </p>

              {provincesQuery.isError ? (
                <StatusMessage tone="warning">
                  省份字典读取失败，已保留当前选择；仍可保存其他字段。
                  <Button
                    className={styles.inlineButton}
                    disabled={provincesQuery.isFetching}
                    onClick={() => void provincesQuery.refetch()}
                  >
                    {provincesQuery.isFetching ? '正在重试…' : '重试省份字典'}
                  </Button>
                </StatusMessage>
              ) : null}

              {citiesQuery.isError && provinceId !== null ? (
                <StatusMessage tone="warning">
                  城市字典读取失败，已保留现有城市，不会当作主动清空。
                  <Button
                    className={styles.inlineButton}
                    disabled={citiesQuery.isFetching}
                    onClick={() => void citiesQuery.refetch()}
                  >
                    {citiesQuery.isFetching ? '正在重试…' : '重试城市字典'}
                  </Button>
                </StatusMessage>
              ) : null}
            </div>
          </div>

          <section className={styles.resourcePanel} aria-label="模型与封面资源">
            <p className={styles.protocolNote}>
              {uploadsEnabled
                ? '以下为仅开发环境的上传模拟：只传文件名、大小与文件类型等说明信息，不读取或传输文件内容。正式上传接口、类型细则、大小上限、分片/续传与校验规则均待确认。'
                : '上传功能尚未开放；正式上传协议、类型细则与校验规则待确认。'}
            </p>

            <UploadField
              kind="model"
              id={FIELD_IDS.modelAssetId}
              headingId="work-model-heading"
              required
              savedAssetId={work?.modelAssetId ?? null}
              savedModelFormat={work?.modelFormat ?? null}
              upload={modelUpload}
              disabled={resourceEditingDisabled}
              disabledReason={resourceDisabledReason}
              error={fieldErrors.modelAssetId}
            />

            <UploadField
              kind="cover"
              id={FIELD_IDS.coverAssetId}
              headingId="work-cover-heading"
              required
              savedAssetId={work?.coverAssetId ?? null}
              savedCoverUrl={work?.coverUrl ?? null}
              upload={coverUpload}
              disabled={resourceEditingDisabled}
              disabledReason={resourceDisabledReason}
              error={fieldErrors.coverAssetId}
            />
          </section>

          <div className={styles.secondary}>
            <TextareaField
              id={FIELD_IDS.description}
              label="建筑介绍（纯文字）"
              hint="发布时必填；支持换行，按普通文字显示，不解析 HTML 或 Markdown。"
              error={fieldErrors.description}
              name="description"
              rows={6}
              value={draft.description}
              readOnly={saving}
              onChange={(event) => changeDraft({ description: event.target.value })}
            />
            <TextareaField
              id={FIELD_IDS.modelingNote}
              label="建模说明（选填）"
              hint="支持多行；Enter 只换行，不会提交表单。"
              error={fieldErrors.modelingNote}
              name="modelingNote"
              rows={4}
              value={draft.modelingNote}
              readOnly={saving}
              onChange={(event) => changeDraft({ modelingNote: event.target.value })}
            />
          </div>
        </div>

        {hasUnsettledSelection ? (
          <StatusMessage tone="warning">
            模型或封面仍在模拟传输或验证中。请等待模拟验证通过，或取消新选择后再保存；
            已保存的资源绑定不会被清除。
          </StatusMessage>
        ) : null}

        <div className={styles.actions}>
          <Button
            type="submit"
            variant="primary"
            className={styles.saveButton}
            disabled={saving || hasUnsettledSelection}
          >
            {saveLabel}
          </Button>
          {workId ? (
            <Link className={styles.actionLink} to={`/admin/works/${workId}/preview`}>
              管理员预览
            </Link>
          ) : (
            <Button disabled title="先保存草稿后才能预览">
              管理员预览
            </Button>
          )}
          <p className={styles.boundary}>
            发布与下架入口暂不可用；保存不会自动发布或下架作品。站内离开会先确认；
            刷新或关闭页面的提示由浏览器决定。
          </p>
        </div>
      </form>
    </div>
  )
}
