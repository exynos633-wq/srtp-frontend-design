import type { ModelFormat, WorkStatus } from '../types/work'

const STATUS_LABELS: Record<WorkStatus, string> = {
  draft: '草稿',
  published: '已发布',
  offline: '已下架',
}

const FORMAT_LABELS: Record<ModelFormat, string> = {
  glb: 'GLB',
  'gaussian-ply': '高斯 PLY',
  'mesh-ply': '网格 PLY',
}

export function workStatusLabel(status: WorkStatus): string {
  return STATUS_LABELS[status]
}

/** 草稿允许没有格式；不把空值伪装成已确认的 glb。 */
export function modelFormatLabel(format: ModelFormat | null): string {
  return format ? FORMAT_LABELS[format] : '未设置'
}

export function workDisplayName(name: string | null): string {
  return name && name.trim() !== '' ? name : '未命名'
}
