import { HttpResponse, http } from 'msw'
import type { SessionUser } from '../api/auth'
import type { ApiErrorBody } from '../types/api'
import type { AdminWork, ModelFormat } from '../types/work'
import { getDatabase, nextTimestamp, nextWorkId, type MockWork } from './db'
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
 * 上传、资源就绪与预览会话仍未定稿，这里不实现，也不冒充既有协议。
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

/** 资源格式在真实后端由上传结果决定；Mock 只在已有格式缺失时按编号推断。 */
function inferFormat(assetId: string): ModelFormat {
  return /ply|gaussian/i.test(assetId) ? 'gaussian-ply' : 'glb'
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

  http.get(/\/api\/globe\/cities$/, () => {
    const scenario = getMockScenario()
    if (scenario === 'list-failure') return fail(500, 'INTERNAL_ERROR', '读取城市聚合失败。')
    if (scenario === 'empty') return HttpResponse.json({ items: [] })
    return HttpResponse.json({ items: listGlobeCities() })
  }),

  http.get(/\/api\/globe\/cities\/([^/]+)\/works$/, ({ params }) => {
    const cityId = String(params[0])
    const scenario = getMockScenario()
    if (scenario === 'list-failure') return fail(500, 'INTERNAL_ERROR', '读取城市作品失败。')
    const items = listCityWorks(cityId)
    // 城市引用由字典派生，响应里必须带可显示的名称与省份，不能只回编号。
    const city = getDatabase().cities.find((item) => item.id === cityId)
    const province = city ? getDatabase().provinces.find((item) => item.id === city.provinceId) : undefined
    if (items === null || !city || !province) return fail(404, 'CITY_NOT_FOUND', '城市不存在。')
    return HttpResponse.json({ city: { id: city.id, name: city.name, province }, items })
  }),

  http.post(/\/api\/auth\/login$/, async ({ request }) => {
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

  http.get(/\/api\/auth\/me$/, () => {
    if (getMockScenario() === 'auth-expired') return fail(401, 'UNAUTHENTICATED', '登录已失效，请重新登录。')
    const session = currentSession()
    if (!session) return fail(401, 'UNAUTHENTICATED', '未登录。')
    return HttpResponse.json({ user: session })
  }),

  http.post(/\/api\/auth\/logout$/, () => {
    getDatabase().session = null
    return new HttpResponse(null, { status: 204 })
  }),

  http.get(/\/api\/admin\/provinces$/, () => {
    const session = requireSession()
    if (session instanceof Response) return session
    return HttpResponse.json({ items: getDatabase().provinces })
  }),

  http.get(/\/api\/admin\/cities$/, ({ request }) => {
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
      coverUrl: null,
      modelFormat: null,
      description,
      modelingNote,
      status: 'draft',
      modelAssetId: null,
      coverAssetId: null,
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
        return fail(422, 'VALIDATION_FAILED', '模型资源格式不正确。', { modelAssetId: '模型资源编号必须是文本。' })
      }
      next.modelAssetId = body.modelAssetId
      if (typeof body.modelAssetId === 'string' && next.modelFormat === null) {
        next.modelFormat = inferFormat(body.modelAssetId)
      }
    }
    if (hasOwn(body, 'coverAssetId')) {
      if (body.coverAssetId !== null && typeof body.coverAssetId !== 'string') {
        return fail(422, 'VALIDATION_FAILED', '封面资源格式不正确。', { coverAssetId: '封面资源编号必须是文本。' })
      }
      next.coverAssetId = body.coverAssetId
      next.coverUrl = body.coverAssetId === null ? null : '/mock/placeholder-cover.svg'
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
    if (getMockScenario() === 'validation-failure') {
      return fail(422, 'VALIDATION_FAILED', '发布前请补全必填内容。', { description: '建筑介绍不能为空。' })
    }

    const fields = publishFieldErrors(work)
    if (Object.keys(fields).length > 0) return fail(422, 'VALIDATION_FAILED', '发布前请补全必填内容。', fields)

    work.status = 'published'
    work.publishedAt = work.publishedAt ?? nextTimestamp()
    work.updatedAt = nextTimestamp()
    if (!work.modelFormat) work.modelFormat = inferFormat(work.modelAssetId ?? '')
    if (!work.coverUrl) work.coverUrl = '/mock/placeholder-cover.svg'
    return HttpResponse.json(toWriteResult(work))
  }),

  http.post(/\/api\/admin\/works\/([^/]+)\/unpublish$/, ({ params }) => {
    const session = requireSession()
    if (session instanceof Response) return session
    const work = getDatabase().works.find((item) => item.id === String(params[0]))
    if (!work) return fail(404, 'WORK_NOT_FOUND', '作品不存在。')
    work.status = 'offline'
    work.updatedAt = nextTimestamp()
    return HttpResponse.json(toWriteResult(work))
  }),
]
