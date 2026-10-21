import type { AdminWork, WorkWriteInput } from '../types/work'

/**
 * 新建／编辑表单的纯数据转换。
 *
 * `cityId` 的 PATCH 语义是“省略 = 不修改，null = 清空”，因此这里只把
 * 与最近服务端确认快照不同的字段放进 PATCH；模型与封面资源不在此处生成，
 * 避免保存文字时误清已有绑定。
 */
export interface WorkFormDraft {
  name: string
  description: string
  modelingNote: string
  cityId: string | null
  /** 仅用于城市筛选，不是作品归属，也不单独保存。 */
  provinceId: string | null
}

/** 最近一次服务端确认的可写字段快照，用于判断 dirty 与生成 PATCH。 */
export interface WorkFormBaseline {
  name: string
  description: string
  modelingNote: string | null
  cityId: string | null
}

export const EMPTY_WORK_DRAFT: WorkFormDraft = {
  name: '',
  description: '',
  modelingNote: '',
  cityId: null,
  provinceId: null,
}

export const EMPTY_WORK_BASELINE: WorkFormBaseline = {
  name: '',
  description: '',
  modelingNote: null,
  cityId: null,
}

/** 空文本按未填处理；名称与介绍在草稿中允许空字符串。 */
function nullableNote(value: string): string | null {
  return value === '' ? null : value
}

export function draftFromAdminWork(work: AdminWork): WorkFormDraft {
  return {
    name: work.name ?? '',
    description: work.description ?? '',
    modelingNote: work.modelingNote ?? '',
    cityId: work.cityId,
    provinceId: work.city?.province.id ?? null,
  }
}

export function baselineFromAdminWork(work: AdminWork): WorkFormBaseline {
  return {
    name: work.name ?? '',
    description: work.description ?? '',
    modelingNote: nullableNote(work.modelingNote ?? ''),
    cityId: work.cityId,
  }
}

/** 改回最近确认值即恢复 clean，不保留“输入过就永久 dirty”。 */
export function isDraftDirty(draft: WorkFormDraft, baseline: WorkFormBaseline): boolean {
  return (
    draft.name !== baseline.name ||
    draft.description !== baseline.description ||
    nullableNote(draft.modelingNote) !== baseline.modelingNote ||
    draft.cityId !== baseline.cityId
  )
}

/** 新建草稿没有基线，提交当前字段；资源字段留空，不伪造 assetId。 */
export function toCreateInput(draft: WorkFormDraft): WorkWriteInput {
  return {
    name: draft.name,
    description: draft.description,
    modelingNote: nullableNote(draft.modelingNote),
    cityId: draft.cityId,
  }
}

/** 只发送实际修改的字段；未改 cityId 时省略，主动清空时显式 null。 */
export function toPatchInput(draft: WorkFormDraft, baseline: WorkFormBaseline): WorkWriteInput {
  const input: WorkWriteInput = {}
  if (draft.name !== baseline.name) input.name = draft.name
  if (draft.description !== baseline.description) input.description = draft.description
  const note = nullableNote(draft.modelingNote)
  if (note !== baseline.modelingNote) input.modelingNote = note
  if (draft.cityId !== baseline.cityId) input.cityId = draft.cityId
  return input
}
