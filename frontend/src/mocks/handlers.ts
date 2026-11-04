import { delay, HttpResponse, http } from 'msw'
import type { SessionUser } from '../api/auth'
import type { ApiErrorBody } from '../types/api'
import type { UploadAssetKind, UploadAssetStatus, UploadSimulationAsset } from '../types/upload'
import type { AdminWork, ModelFormat } from '../types/work'
import {
  getDatabase,
  nextTimestamp,
  nextUploadId,
  nextWorkId,
  type MockUploadRecord,
  type MockWork,
} from './db'
import {
  findAdminWork,
  findPublicWork,
  listAdminWorks,
  listCityWorks,
  listGlobeCities,
  listPublishedWorks,
  toAdminWork,
} from './selectors'
import { getMockScenario } from './scenario'

/**
 * Mock 传输层。路径、状态码与错误体按工程设计 02 的草案实现；
 * `/api/dev/mock/uploads` 是 P12 开发演示专用 metadata 模拟，不是正式上传协议。
 */

const DEMO_ACCOUNT = { username: 'admin', password: 'admin' }

function fail(status: number, code: string, message: string, fields?: Record<string, string>) {
  const body: ApiErrorBody = { error: { code, message, ...(fields ? { fields } : {}) } }
  return HttpResponse.json(body, { status })
}

function currentSession(): SessionUser | null {
  return getDatabase().session
}

/** 管理接口统一入口：场景“登录失效”时，即使有会话也返回 401。 */
function requireSession(): SessionUser | null | Response {
  if (getMockScenario() === 'auth-forbidden') return fail(403, 'FORBIDDEN', '当前管理员无权访问此资源。')
  if (getMockScenario() === 'auth-expired') {
    return fail(401, 'UNAUTHENTICATED', '登录已失效，请重新登录。')
  }
  const session = currentSession()
  if (!session) return fail(401, 'UNAUTHENTICATED', '请先登录。')
  return session
}

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const value: unknown = await request.json()
    if (typeof value !== 'object' || value === null) return null
    return value as Record<string, unknown>
  } catch {
    return null
  }
}

function hasOwn(body: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(body, key)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

/** 发布必填校验：发布接口与“已发布作品保存”共用同一套规则。 */
function publishFieldErrors(work: MockWork): Record<string, string> {
  const fields: Record<string, string> = {}
  if (!isNonEmptyString(work.name)) fields.name = '请填写作品名称。'
  if (!isNonEmptyString(work.description)) fields.description = '请填写建筑介绍。'
  if (!isNonEmptyString(work.coverAssetId)) fields.coverAssetId = '请上传封面。'
  if (!isNonEmptyString(work.modelAssetId)) fields.modelAssetId = '请上传可用的模型资源。'
  return fields
}

/** receiving/validating 的模拟时长；仅开发演示，不是正式协议或真实进度。 */
const RECEIVING_MS = 700
const VALIDATING_MS = 700

function inferModelFormat(name: string): ModelFormat | null {
  const lower = name.toLowerCase()
  if (lower.endsWith('.glb')) return 'glb'
  if (lower.endsWith('.ply')) return 'gaussian-ply'
  return null
}

function isLikelyCover(name: string, mimeType: string): boolean {
  if (mimeType.startsWith('image/')) return true
  return /\.(png|jpe?g|webp|gif|avif|svg)$/i.test(name)
}

/** 资源状态由登记与 elapsed 推导，客户端只信服务端模拟结果。 */
function simulateUploadState(upload: MockUploadRecord): {
  status: UploadAssetStatus
  simulatedProgress: number | null
  error: string | null
} {
  if (upload.seeded) {
    return { status: 'ready', simulatedProgress: null, error: null }
  }

  const elapsed = Date.now() - upload.createdAt
  if (elapsed < RECEIVING_MS) {
    return {
      status: 'receiving',
      simulatedProgress: Math.min(95, Math.round((elapsed / RECEIVING_MS) * 100)),
      error: null,
    }
  }

  if (upload.outcome === 'hold') {
    return { status: 'validating', simulatedProgress: null, error: null }
  }

  if (elapsed < RECEIVING_MS + VALIDATING_MS) {
    return { status: 'validating', simulatedProgress: null, error: null }
  }

  return {
    status: upload.outcome === 'failed' ? 'failed' : 'ready',
    simulatedProgress: null,
    error: upload.outcome === 'failed' ? upload.failureReason : null,
  }
}

function toUploadSimulationAsset(upload: MockUploadRecord): UploadSimulationAsset {
  const state = simulateUploadState(upload)
  return {
    assetId: upload.assetId,
    kind: upload.kind,
    originalName: upload.originalName,
    sizeBytes: upload.sizeBytes,
    status: state.status,
    simulatedProgress: state.simulatedProgress,
    modelFormat: upload.modelFormat,
    error: state.error,
  }
}

type ReadyBinding = { upload: MockUploadRecord } | { error: string }

/** 绑定前由 Mock 登记重新确认 kind 与 ready，不接受客户端自报状态。 */
function readyUploadForBinding(assetId: string, kind: UploadAssetKind): ReadyBinding {
  const upload = getDatabase().uploads.find((item) => item.assetId === assetId)
  if (!upload) return { error: '资源不存在或不可用。' }
  if (upload.kind !== kind) {
    return { error: kind === 'model' ? '该资源不是模型文件。' : '该资源不是封面图片。' }
  }
  const state = simulateUploadState(upload)
  if (state.status === 'failed') return { error: '资源验证失败，不能绑定。' }
  if (state.status !== 'ready') return { error: '资源尚未通过验证，不能绑定。' }
  if (kind === 'model' && upload.modelFormat === null) {
    return { error: '模型格式尚未确认，不能绑定。' }
  }
  return { upload }
}

/** 仅替换封面地址以演示加载失败；作品数据仍来自正常读取。 */
const BROKEN_COVER_URL = '/mock/cover-missing.png'

function withCoverScenario<T extends { coverUrl: string }>(work: T): T {
  if (getMockScenario() !== 'cover-failure') return work
  return { ...work, coverUrl: BROKEN_COVER_URL }
}

function toWriteResult(work: MockWork): AdminWork {
  return toAdminWork(work)
}

/** 与 feature/backend-client-rendering 的 preview-config 响应保持一致。 */
function previewConfig(id: string, admin: boolean) {
  const work = findAdminWork(id)
  if (!work || !work.modelAssetId) {
    return fail(404, 'NO_MODEL', '该作品尚未配置可用的模型资源。')
  }
  const base = admin
    ? `/api/admin/works/${encodeURIComponent(id)}/model`
    : `/api/works/${encodeURIComponent(id)}/model`
  return HttpResponse.json({
    workId: work.id,
    mode: 'client',
    source: {
      kind: 'url',
      url: `${base}?v=${encodeURIComponent(work.modelAssetId)}`,
      version: work.modelAssetId,
      name: work.name ?? '',
      format: work.modelFormat ?? 'glb',
    },
    view: {
      sourceUp: work.modelFormat === 'glb' ? 'y' : 'z',
      orientation: { x: 0, y: 0, z: 0 },
      scale: 1,
      initialCamera: null,
      ground: null,
      walkArea: null,
      eyeHeight: null,
    },
  })
}

export const handlers = [
  http.get(/\/api\/works$/, () => {
    const scenario = getMockScenario()
    if (scenario === 'list-failure') return fail(500, 'INTERNAL_ERROR', '读取作品列表失败。')
    if (scenario === 'empty') return HttpResponse.json({ items: [] })
    return HttpResponse.json({ items: listPublishedWorks().map(withCoverScenario) })
  }),

  http.get(/\/api\/works\/([^/]+)$/, ({ params }) => {
    const id = String(params[0])
    const scenario = getMockScenario()
    if (scenario === 'list-failure') return fail(500, 'INTERNAL_ERROR', '读取作品详情失败。')
    if (scenario === 'empty') return fail(404, 'WORK_NOT_FOUND', '作品不存在或未公开。')
    const work = findPublicWork(id)
    if (!work) return fail(404, 'WORK_NOT_FOUND', '作品不存在或未公开。')
    return HttpResponse.json(withCoverScenario(work))
  }),

  http.get(/\/api\/works\/([^/]+)\/preview-config$/, ({ params }) => {
    const id = String(params[0])
    if (!findPublicWork(id)) return fail(404, 'WORK_NOT_FOUND', '作品不存在或未公开。')
    return previewConfig(id, false)
  }),

  http.get(/\/api\/admin\/works\/([^/]+)\/preview-config$/, ({ params }) => {
    const session = requireSession()
    if (session instanceof Response) return session
    return previewConfig(String(params[0]), true)
  }),

  http.get(/\/api\/globe\/cities$/, () => {
    const scenario = getMockScenario()
    if (scenario === 'list-failure') return fail(500, 'INTERNAL_ERROR', '读取城市聚合失败。')
    if (scenario === 'empty' || scenario === 'globe-empty') {
      return HttpResponse.json({ items: [] })
    }
    return HttpResponse.json({ items: listGlobeCities() })
  }),

  http.get(/\/api\/globe\/cities\/([^/]+)\/works$/, ({ params }) => {
    const cityId = String(params[0])
    const scenario = getMockScenario()
    if (scenario === 'list-failure') return fail(500, 'INTERNAL_ERROR', '读取城市作品失败。')
    // 城市引用由字典派生，响应里必须带可显示的名称与省份，不能只回编号。
    const city = getDatabase().cities.find((item) => item.id === cityId)
    const province = city ? getDatabase().provinces.find((item) => item.id === city.provinceId) : undefined
    if (!city || !province) return fail(404, 'CITY_NOT_FOUND', '城市不存在。')
    if (scenario === 'city-list-failure') {
      return fail(500, 'INTERNAL_ERROR', '读取城市作品失败。')
    }
    if (scenario === 'city-empty') {
      return HttpResponse.json({ city: { id: city.id, name: city.name, province }, items: [] })
    }
    const items = listCityWorks(cityId)
    if (items === null) return fail(404, 'CITY_NOT_FOUND', '城市不存在。')
    return HttpResponse.json({ city: { id: city.id, name: city.name, province }, items })
  }),

  http.post(/\/api\/auth\/login$/, async ({ request }) => {
    await delay(400)
    if (getMockScenario() === 'login-error') return fail(401, 'INVALID_CREDENTIALS', '账号或密码不正确。')
    const body = await readJson(request)
    if (!body) return fail(422, 'VALIDATION_FAILED', '请填写账号与密码。')
    const { username, password } = body
    if (username !== DEMO_ACCOUNT.username || password !== DEMO_ACCOUNT.password) {
      return fail(401, 'INVALID_CREDENTIALS', '账号或密码不正确。')
    }
    const session: SessionUser = { id: 'user_demo_admin' }
    getDatabase().session = session
    return HttpResponse.json({ user: session })
  }),

  http.get(/\/api\/auth\/me$/, async () => {
    await delay(150)
    if (getMockScenario() === 'auth-forbidden') return fail(403, 'FORBIDDEN', '当前管理员无权访问此资源。')
    if (getMockScenario() === 'auth-expired') return fail(401, 'UNAUTHENTICATED', '登录已失效，请重新登录。')
    const session = currentSession()
    if (!session) return fail(401, 'UNAUTHENTICATED', '未登录。')
    return HttpResponse.json({ user: session })
  }),

  http.post(/\/api\/auth\/logout$/, () => {
    getDatabase().session = null
    return new HttpResponse(null, { status: 204 })
  }),

  // P12 开发模拟：只接收 metadata，不读取、保存或外发文件内容。
  http.post(/\/api\/dev\/mock\/uploads$/, async ({ request }) => {
    const session = requireSession()
    if (session instanceof Response) return session
    const body = await readJson(request)
    if (!body) return fail(422, 'VALIDATION_FAILED', '模拟上传请求格式不正确。')

    const kind = body.kind
    if (kind !== 'model' && kind !== 'cover') {
      return fail(422, 'VALIDATION_FAILED', '模拟资源类型不正确。', {
        kind: '资源类型必须是 model 或 cover。',
      })
    }
    const originalName = body.originalName
    const sizeBytes = body.sizeBytes
    const mimeType = typeof body.mimeType === 'string' ? body.mimeType : ''
    if (
      !isNonEmptyString(originalName) ||
      typeof sizeBytes !== 'number' ||
      !Number.isFinite(sizeBytes) ||
      sizeBytes < 0
    ) {
      return fail(422, 'VALIDATION_FAILED', '模拟上传 metadata 不完整。')
    }

    let outcome: MockUploadRecord['outcome'] = 'ready'
    let failureReason: string | null = null
    let modelFormat: ModelFormat | null = null

    if (kind === 'model') {
      modelFormat = inferModelFormat(originalName)
      if (modelFormat === null) {
        outcome = 'failed'
        failureReason = '模拟示例仅接受 .glb 或 .ply 模型文件；正式类型规则待确认。'
      }
    } else if (!isLikelyCover(originalName, mimeType)) {
      outcome = 'failed'
      failureReason = '模拟示例仅接受图片封面；正式类型规则待确认。'
    }

    if (outcome !== 'failed') {
      const scenario = getMockScenario()
      const shouldFail =
        (scenario === 'upload-cover-failure' && kind === 'cover') ||
        (scenario === 'upload-model-failure' && kind === 'model')
      if (shouldFail) {
        outcome = 'failed'
        failureReason = '模拟服务端验证失败（仅开发演示，可重试）。'
      } else if (scenario === 'upload-validating') {
        outcome = 'hold'
      }
    }

    const upload: MockUploadRecord = {
      assetId: nextUploadId(kind),
      seeded: false,
      kind,
      originalName,
      sizeBytes,
      createdAt: Date.now(),
      outcome,
      failureReason,
      modelFormat,
    }
    getDatabase().uploads.push(upload)
    return HttpResponse.json(toUploadSimulationAsset(upload), { status: 201 })
  }),

  http.get(/\/api\/dev\/mock\/uploads\/([^/]+)$/, ({ params }) => {
    const session = requireSession()
    if (session instanceof Response) return session
    const upload = getDatabase().uploads.find((item) => item.assetId === String(params[0]))
    if (!upload) return fail(404, 'UPLOAD_NOT_FOUND', '模拟资源不存在。')
    return HttpResponse.json(toUploadSimulationAsset(upload))
  }),

  http.get(/\/api\/admin\/provinces$/, () => {
    const session = requireSession()
    if (session instanceof Response) return session
    return HttpResponse.json({ items: getDatabase().provinces })
  }),

  http.get(/\/api\/admin\/cities(?:\?.*)?$/, ({ request }) => {
    const session = requireSession()
    if (session instanceof Response) return session
    const provinceId = new URL(request.url).searchParams.get('provinceId')
    const cities = getDatabase().cities
      .filter((city) => (provinceId ? city.provinceId === provinceId : true))
      .map(({ id, name, provinceId: parent }) => ({ id, name, provinceId: parent }))
    return HttpResponse.json({ items: cities })
  }),

  http.get(/\/api\/admin\/works$/, () => {
    const session = requireSession()
    if (session instanceof Response) return session
    // 只影响管理列表；公开接口、登录与单件管理读取保持原语义。
    if (getMockScenario() === 'admin-list-failure') {
      return fail(500, 'INTERNAL_ERROR', '读取管理作品列表失败。')
    }
    if (getMockScenario() === 'admin-list-empty') {
      return HttpResponse.json({ items: [] })
    }
    return HttpResponse.json({ items: listAdminWorks() })
  }),

  http.post(/\/api\/admin\/works$/, async ({ request }) => {
    const session = requireSession()
    if (session instanceof Response) return session
    const body = (await readJson(request)) ?? {}
    const name = hasOwn(body, 'name') && typeof body.name === 'string' ? body.name : ''
    const description = hasOwn(body, 'description') && typeof body.description === 'string' ? body.description : ''
    const modelingNote = hasOwn(body, 'modelingNote') && typeof body.modelingNote === 'string' ? body.modelingNote : null
    const cityId = hasOwn(body, 'cityId') && typeof body.cityId === 'string' ? body.cityId : null

    let modelAssetId: string | null = null
    let coverAssetId: string | null = null
    let modelFormat: ModelFormat | null = null
    let coverUrl: string | null = null

    if (hasOwn(body, 'modelAssetId')) {
      if (body.modelAssetId !== null && typeof body.modelAssetId !== 'string') {
        return fail(422, 'VALIDATION_FAILED', '模型资源格式不正确。', {
          modelAssetId: '模型资源编号必须是文本或 null。',
        })
      }
      if (typeof body.modelAssetId === 'string') {
        const binding = readyUploadForBinding(body.modelAssetId, 'model')
        if ('error' in binding) {
          return fail(422, 'VALIDATION_FAILED', '模型资源不可用。', {
            modelAssetId: binding.error,
          })
        }
        modelAssetId = body.modelAssetId
        modelFormat = binding.upload.modelFormat
      }
    }

    if (hasOwn(body, 'coverAssetId')) {
      if (body.coverAssetId !== null && typeof body.coverAssetId !== 'string') {
        return fail(422, 'VALIDATION_FAILED', '封面资源格式不正确。', {
          coverAssetId: '封面资源编号必须是文本或 null。',
        })
      }
      if (typeof body.coverAssetId === 'string') {
        const binding = readyUploadForBinding(body.coverAssetId, 'cover')
        if ('error' in binding) {
          return fail(422, 'VALIDATION_FAILED', '封面资源不可用。', {
            coverAssetId: binding.error,
          })
        }
        coverAssetId = body.coverAssetId
        coverUrl = '/mock/placeholder-cover.svg'
      }
    }

    if (cityId !== null && !getDatabase().cities.some((city) => city.id === cityId)) {
      return fail(422, 'VALIDATION_FAILED', '城市不存在。', { cityId: '城市不存在或已停用。' })
    }
    const city = cityId === null ? null : (getDatabase().cities.find((item) => item.id === cityId) ?? null)
    const province = city ? getDatabase().provinces.find((item) => item.id === city.provinceId) : undefined
    const work: MockWork = {
      id: nextWorkId(),
      name,
      cityId,
      city: city && province ? { id: city.id, name: city.name, province } : null,
      coverUrl,
      modelFormat,
      description,
      modelingNote,
      status: 'draft',
      modelAssetId,
      coverAssetId,
      updatedAt: nextTimestamp(),
      publishedAt: null,
      placeholder: false,
    }
    getDatabase().works.push(work)
    return HttpResponse.json(toWriteResult(work), { status: 201 })
  }),

  http.get(/\/api\/admin\/works\/([^/]+)$/, ({ params }) => {
    const session = requireSession()
    if (session instanceof Response) return session
    const work = findAdminWork(String(params[0]))
    if (!work) return fail(404, 'WORK_NOT_FOUND', '作品不存在。')
    return HttpResponse.json(work)
  }),

  http.patch(/\/api\/admin\/works\/([^/]+)$/, async ({ params, request }) => {
    const session = requireSession()
    if (session instanceof Response) return session
    const work = getDatabase().works.find((item) => item.id === String(params[0]))
    if (!work) return fail(404, 'WORK_NOT_FOUND', '作品不存在。')
    const body = await readJson(request)
    if (!body) return fail(422, 'VALIDATION_FAILED', '请求体格式不正确。')

    if (
      work.status === 'published' &&
      (hasOwn(body, 'modelAssetId') || hasOwn(body, 'coverAssetId'))
    ) {
      const field = hasOwn(body, 'modelAssetId') ? 'modelAssetId' : 'coverAssetId'
      return fail(409, 'WORK_PUBLISHED', '已发布作品需先下架后才能替换模型或封面。', {
        [field]: '请先下架作品后再替换资源。',
      })
    }

    // 先在副本上应用字段并完成全部校验，成功后再一次性写回；
    // 否则后面的校验失败时，前面的赋值已经生效，会出现“提示保存失败但数据已变”。
    const next: MockWork = { ...work }

    if (hasOwn(body, 'name')) {
      if (typeof body.name !== 'string') return fail(422, 'VALIDATION_FAILED', '名称格式不正确。', { name: '名称必须是文本。' })
      next.name = body.name
    }
    if (hasOwn(body, 'description')) {
      if (typeof body.description !== 'string') {
        return fail(422, 'VALIDATION_FAILED', '建筑介绍格式不正确。', { description: '建筑介绍必须是文本。' })
      }
      next.description = body.description
    }
    if (hasOwn(body, 'modelingNote')) {
      if (body.modelingNote !== null && typeof body.modelingNote !== 'string') {
        return fail(422, 'VALIDATION_FAILED', '建模说明格式不正确。', { modelingNote: '建模说明必须是文本或清空。' })
      }
      next.modelingNote = body.modelingNote
    }
    if (hasOwn(body, 'cityId')) {
      const cityId = body.cityId
      if (cityId === null) {
        next.cityId = null
        next.city = null
      } else if (typeof cityId !== 'string') {
        return fail(422, 'VALIDATION_FAILED', '城市编号格式不正确。', { cityId: '城市编号必须是文本或 null。' })
      } else {
        const city = getDatabase().cities.find((item) => item.id === cityId)
        const province = city ? getDatabase().provinces.find((item) => item.id === city.provinceId) : undefined
        if (!city || !province) {
          return fail(422, 'VALIDATION_FAILED', '城市不存在。', { cityId: '城市不存在或已停用。' })
        }
        next.cityId = city.id
        next.city = { id: city.id, name: city.name, province }
      }
    }
    if (hasOwn(body, 'modelAssetId')) {
      if (getMockScenario() === 'model-in-use') {
        return fail(409, 'MODEL_IN_USE', '该模型资源正在预览会话中，请先下架并等待会话结束。')
      }
      if (body.modelAssetId !== null && typeof body.modelAssetId !== 'string') {
        return fail(422, 'VALIDATION_FAILED', '模型资源格式不正确。', { modelAssetId: '模型资源编号必须是文本或 null。' })
      }
      if (body.modelAssetId === null) {
        next.modelAssetId = null
        next.modelFormat = null
      } else {
        const binding = readyUploadForBinding(body.modelAssetId, 'model')
        if ('error' in binding) {
          return fail(422, 'VALIDATION_FAILED', '模型资源不可用。', { modelAssetId: binding.error })
        }
        next.modelAssetId = body.modelAssetId
        next.modelFormat = binding.upload.modelFormat
      }
    }
    if (hasOwn(body, 'coverAssetId')) {
      if (body.coverAssetId !== null && typeof body.coverAssetId !== 'string') {
        return fail(422, 'VALIDATION_FAILED', '封面资源格式不正确。', { coverAssetId: '封面资源编号必须是文本或 null。' })
      }
      if (body.coverAssetId === null) {
        next.coverAssetId = null
        next.coverUrl = null
      } else {
        const binding = readyUploadForBinding(body.coverAssetId, 'cover')
        if ('error' in binding) {
          return fail(422, 'VALIDATION_FAILED', '封面资源不可用。', { coverAssetId: binding.error })
        }
        next.coverAssetId = body.coverAssetId
        next.coverUrl = '/mock/placeholder-cover.svg'
      }
    }

    // 已发布作品保存后仍需满足发布条件，否则会从公开端消失而后台仍显示已发布。
    if (next.status === 'published') {
      const fields = publishFieldErrors(next)
      if (Object.keys(fields).length > 0) {
        return fail(422, 'VALIDATION_FAILED', '已发布作品必须保留名称、建筑介绍、封面与模型资源。', fields)
      }
    }

    next.updatedAt = nextTimestamp()
    Object.assign(work, next)
    return HttpResponse.json(toWriteResult(work))
  }),

  http.post(/\/api\/admin\/works\/([^/]+)\/publish$/, ({ params }) => {
    const session = requireSession()
    if (session instanceof Response) return session
    const work = getDatabase().works.find((item) => item.id === String(params[0]))
    if (!work) return fail(404, 'WORK_NOT_FOUND', '作品不存在。')
    if (work.status === 'published') {
      // 重复发布到同一状态是幂等的，不刷新发布时间或更新时间。
      return HttpResponse.json(toWriteResult(work))
    }
    if (getMockScenario() === 'validation-failure') {
      return fail(422, 'VALIDATION_FAILED', '发布前请补全必填内容。', { description: '建筑介绍不能为空。' })
    }

    const fields = publishFieldErrors(work)
    if (Object.keys(fields).length > 0) return fail(422, 'VALIDATION_FAILED', '发布前请补全必填内容。', fields)

    if (work.modelAssetId) {
      const binding = readyUploadForBinding(work.modelAssetId, 'model')
      if ('error' in binding) {
        return fail(422, 'VALIDATION_FAILED', '发布前请补全必填内容。', {
          modelAssetId: binding.error,
        })
      }
      work.modelFormat = binding.upload.modelFormat
    }
    if (work.coverAssetId) {
      const binding = readyUploadForBinding(work.coverAssetId, 'cover')
      if ('error' in binding) {
        return fail(422, 'VALIDATION_FAILED', '发布前请补全必填内容。', {
          coverAssetId: binding.error,
        })
      }
    }

    work.status = 'published'
    work.publishedAt = work.publishedAt ?? nextTimestamp()
    work.updatedAt = nextTimestamp()
    if (!work.coverUrl) work.coverUrl = '/mock/placeholder-cover.svg'
    return HttpResponse.json(toWriteResult(work))
  }),

  http.post(/\/api\/admin\/works\/([^/]+)\/unpublish$/, ({ params }) => {
    const session = requireSession()
    if (session instanceof Response) return session
    const work = getDatabase().works.find((item) => item.id === String(params[0]))
    if (!work) return fail(404, 'WORK_NOT_FOUND', '作品不存在。')
    if (work.status === 'offline') {
      // 重复下架同样幂等，不制造新的 updatedAt。
      return HttpResponse.json(toWriteResult(work))
    }
    work.status = 'offline'
    work.updatedAt = nextTimestamp()
    return HttpResponse.json(toWriteResult(work))
  }),
]
