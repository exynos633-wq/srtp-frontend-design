import { ViewerError } from './errors'

export interface ParsedGlb {
  kind: 'glb'
  json: Record<string, unknown>
  chunks: number
  byteLength: number
}

const GLB_MAGIC = 0x46546c67
const JSON_CHUNK = 0x4e4f534a
const BIN_CHUNK = 0x004e4942

const DECODER_EXTENSIONS = new Set([
  'KHR_draco_mesh_compression',
  'EXT_meshopt_compression',
  'KHR_texture_basisu',
])

const KNOWN_REQUIRED_EXTENSIONS = new Set([
  'KHR_materials_unlit',
  'KHR_materials_emissive_strength',
  'KHR_materials_transmission',
  'KHR_materials_volume',
  'KHR_materials_ior',
  'KHR_materials_specular',
  'KHR_materials_clearcoat',
  'KHR_materials_sheen',
  'KHR_materials_iridescence',
  'KHR_materials_anisotropy',
  'KHR_materials_dispersion',
  'KHR_texture_transform',
  'KHR_lights_punctual',
  'KHR_mesh_quantization',
  'EXT_texture_webp',
  'EXT_texture_avif',
])

function fail(code: 'GLB_HEADER' | 'GLB_JSON' | 'GLB_EXTERNAL' | 'GLB_EXTENSION' | 'DECODER_REQUIRED', detail?: string): never {
  throw new ViewerError(code, detail)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function arrayOfRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : []
}

/** 校验 GLB 2.0 容器、JSON、内嵌资源和 required 扩展；不做网络外部请求。 */
export function parseGlbContainer(buffer: ArrayBuffer): ParsedGlb {
  if (buffer.byteLength < 20) fail('GLB_HEADER', '文件过短。')
  const view = new DataView(buffer)
  const magic = view.getUint32(0, true)
  const version = view.getUint32(4, true)
  const declaredLength = view.getUint32(8, true)
  const magicText = String.fromCharCode(
    view.getUint8(0),
    view.getUint8(1),
    view.getUint8(2),
    view.getUint8(3),
  )
  if (magicText !== 'glTF' || magic !== GLB_MAGIC) fail('GLB_HEADER', 'magic 不是 glTF。')
  if (version !== 2) fail('GLB_HEADER', `glTF 版本为 ${version}，首期只支持 2。`)
  if (declaredLength !== buffer.byteLength) {
    fail('GLB_HEADER', `声明长度 ${declaredLength}，实际 ${buffer.byteLength}。`)
  }

  let offset = 12
  let json: Record<string, unknown> | null = null
  let chunks = 0
  while (offset < buffer.byteLength) {
    if (offset + 8 > buffer.byteLength) fail('GLB_HEADER', 'chunk 头被截断。')
    const chunkLength = view.getUint32(offset, true)
    const chunkType = view.getUint32(offset + 4, true)
    offset += 8
    if (chunkLength % 4 !== 0) fail('GLB_HEADER', 'chunk 长度不是 4 字节对齐。')
    if (offset + chunkLength > buffer.byteLength) fail('GLB_HEADER', 'chunk 数据超出文件长度。')
    const chunk = new Uint8Array(buffer, offset, chunkLength)
    chunks += 1
    if (chunks === 1) {
      if (chunkType !== JSON_CHUNK) fail('GLB_HEADER', '第一个 chunk 不是 JSON。')
      let text = new TextDecoder('utf-8').decode(chunk)
      while (text.endsWith('\u0000')) text = text.slice(0, -1)
      text = text.trim()
      try {
        const parsed: unknown = JSON.parse(text)
        if (!isRecord(parsed)) fail('GLB_JSON', 'JSON 根不是对象。')
        json = parsed
      } catch (error) {
        if (error instanceof ViewerError) throw error
        fail('GLB_JSON', error instanceof Error ? error.message : undefined)
      }
    } else if (chunkType !== BIN_CHUNK && chunkType !== JSON_CHUNK) {
      // 允许未知 chunk 被跳过；glTF 只要求理解 JSON/BIN。
    }
    offset += chunkLength
  }
  if (!json) fail('GLB_JSON', '缺少 JSON chunk。')

  const asset = isRecord(json.asset) ? json.asset : null
  if (!asset || typeof asset.version !== 'string' || !asset.version.startsWith('2')) {
    fail('GLB_JSON', 'asset.version 不是 2.x。')
  }

  for (const entry of arrayOfRecords(json.buffers)) {
    if (typeof entry.uri === 'string' && !entry.uri.startsWith('data:')) {
      fail('GLB_EXTERNAL', 'buffers 含外部 URI。')
    }
  }
  for (const entry of arrayOfRecords(json.images)) {
    if (typeof entry.uri === 'string' && !entry.uri.startsWith('data:')) {
      fail('GLB_EXTERNAL', 'images 含外部 URI。')
    }
  }

  const required = Array.isArray(json.extensionsRequired)
    ? json.extensionsRequired.filter((item): item is string => typeof item === 'string')
    : []
  for (const extension of required) {
    if (DECODER_EXTENSIONS.has(extension)) {
      fail('DECODER_REQUIRED', `required 扩展 ${extension} 需要额外解码器。`)
    }
    if (!KNOWN_REQUIRED_EXTENSIONS.has(extension)) {
      fail('GLB_EXTENSION', `未知 required 扩展 ${extension}。`)
    }
  }

  return { kind: 'glb', json, chunks, byteLength: buffer.byteLength }
}
