/**
 * 目录 → 详情的一次性来源信息。
 *
 * 只保存 DOM 位置和作品身份，不保存卡片、图片或模型对象；
 * 新标签页、刷新、直接打开详情时天然没有来源，走独立路径即可。
 */

export interface CoverRect {
  left: number
  top: number
  width: number
  height: number
}

export interface CoverSource {
  workId: string
  coverUrl: string
  rect: CoverRect
  at: number
}

export interface DirectoryReturn {
  scrollY: number
  workId: string
  at: number
}

const COVER_SOURCE_MAX_AGE = 10_000
const DIRECTORY_RETURN_MAX_AGE = 60_000

let coverSource: CoverSource | null = null
let directoryReturn: DirectoryReturn | null = null

export function rememberCoverSource(input: Omit<CoverSource, 'at'>): void {
  coverSource = { ...input, at: Date.now() }
}

/** 取走来源：只允许一次，避免返回详情时重复播放。 */
export function takeCoverSource(workId: string, coverUrl: string): CoverSource | null {
  const source = coverSource
  coverSource = null
  if (!source) return null
  if (source.workId !== workId || source.coverUrl !== coverUrl) return null
  if (Date.now() - source.at > COVER_SOURCE_MAX_AGE) return null
  return source
}

export function clearCoverSource(): void {
  coverSource = null
}

export function rememberDirectoryReturn(input: Omit<DirectoryReturn, 'at'>): void {
  directoryReturn = { ...input, at: Date.now() }
}

/** 回到目录时取走滚动位置与入口作品；过期后不再恢复。 */
export function takeDirectoryReturn(): DirectoryReturn | null {
  const saved = directoryReturn
  directoryReturn = null
  if (!saved) return null
  if (Date.now() - saved.at > DIRECTORY_RETURN_MAX_AGE) return null
  return saved
}

export function clearDirectoryReturn(): void {
  directoryReturn = null
}
