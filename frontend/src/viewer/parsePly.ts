import { ViewerError } from './errors'

export interface PlyField {
  name: string
  offset: number
}

export interface ParsedPly {
  kind: 'ply'
  vertexCount: number
  rowBytes: number
  headerBytes: number
  shDegree: number
  hasNormals: boolean
  fields: Map<string, PlyField>
  bounds: {
    min: [number, number, number]
    max: [number, number, number]
  }
}

const BASE_FIELDS = [
  'x',
  'y',
  'z',
  'f_dc_0',
  'f_dc_1',
  'f_dc_2',
  'opacity',
  'scale_0',
  'scale_1',
  'scale_2',
  'rot_0',
  'rot_1',
  'rot_2',
  'rot_3',
] as const

const SH_COUNTS = new Set([0, 9, 24, 45])
const MAX_HEADER_BYTES = 256 * 1024

function fail(code: 'PLY_HEADER' | 'PLY_FORMAT' | 'PLY_FIELDS' | 'PLY_LENGTH' | 'PLY_VALUES', detail?: string): never {
  throw new ViewerError(code, detail)
}

function textHeader(buffer: ArrayBuffer): { text: string; dataStart: number } {
  const bytes = new Uint8Array(buffer)
  const probeLength = Math.min(bytes.byteLength, MAX_HEADER_BYTES)
  const text = new TextDecoder('latin1').decode(bytes.subarray(0, probeLength))
  const endMatch = /(?:^|\n)end_header\r?\n/.exec(text)
  if (!endMatch) fail('PLY_HEADER', '未找到 end_header。')
  const headerEnd = endMatch.index + endMatch[0].length
  return { text: text.slice(0, endMatch.index + endMatch[0].length), dataStart: headerEnd }
}

/** 解析并校验标准 3DGS PLY；普通点云、压缩/未知格式不会被当成高斯。 */
export function parsePly(buffer: ArrayBuffer): ParsedPly {
  const { text, dataStart } = textHeader(buffer)
  const lines = text.split(/\r?\n/).map((line) => line.trim())
  if (lines[0] !== 'ply') fail('PLY_HEADER', '首行不是 ply。')

  const formatLines = lines.filter((line) => line.startsWith('format '))
  if (formatLines.length !== 1) fail('PLY_FORMAT', '缺少唯一的 format 行。')
  const format = formatLines[0]!.split(/\s+/)
  if (format.length !== 3 || format[1] !== 'binary_little_endian' || format[2] !== '1.0') {
    fail('PLY_FORMAT', `收到 ${formatLines[0]}。`)
  }

  let vertexCount: number | null = null
  let currentElement: string | null = null
  const properties: string[] = []

  for (const line of lines) {
    if (line === '' || line === 'ply' || line.startsWith('format ') || line.startsWith('comment ') || line.startsWith('obj_info ') || line === 'end_header') {
      continue
    }
    if (line.startsWith('element ')) {
      const parts = line.split(/\s+/)
      if (parts.length !== 3) fail('PLY_HEADER', `element 行不完整：${line}`)
      currentElement = parts[1]!
      const count = Number(parts[2])
      if (!Number.isInteger(count) || count < 0) fail('PLY_HEADER', `element 数量无效：${line}`)
      if (currentElement === 'vertex') {
        if (vertexCount !== null) fail('PLY_HEADER', '存在多个 vertex 元素。')
        vertexCount = count
      } else {
        fail('PLY_FIELDS', `首期只接受 vertex 元素，收到 ${currentElement}。`)
      }
      continue
    }
    if (line.startsWith('property ')) {
      if (currentElement !== 'vertex') fail('PLY_HEADER', 'property 出现在 vertex 之前。')
      const parts = line.split(/\s+/)
      if (parts.length !== 3 || parts[1] !== 'float') {
        fail('PLY_FORMAT', `首期只接受 float 标量属性：${line}`)
      }
      properties.push(parts[2]!)
      continue
    }
    fail('PLY_HEADER', `无法识别头部行：${line}`)
  }

  if (vertexCount === null) fail('PLY_HEADER', '缺少 vertex 元素。')
  if (vertexCount <= 0) fail('PLY_FIELDS', 'vertex 数量必须大于 0。')
  if (properties.length === 0) fail('PLY_FIELDS', 'vertex 没有属性。')

  const unique = new Set(properties)
  if (unique.size !== properties.length) fail('PLY_FIELDS', '存在重名属性。')

  for (const name of BASE_FIELDS) {
    if (!unique.has(name)) fail('PLY_FIELDS', `缺少必需属性 ${name}。`)
  }

  const restIndices: number[] = []
  for (const name of properties) {
    if (name.startsWith('f_rest_')) {
      const index = name.slice('f_rest_'.length)
      if (!/^\d+$/.test(index)) fail('PLY_FIELDS', `未知球谐属性 ${name}。`)
      restIndices.push(Number(index))
    }
  }
  restIndices.sort((a, b) => a - b)
  for (let i = 0; i < restIndices.length; i += 1) {
    if (restIndices[i] !== i) fail('PLY_FIELDS', 'f_rest 编号不连续。')
  }
  if (!SH_COUNTS.has(restIndices.length)) {
    fail('PLY_FIELDS', `f_rest 数量为 ${restIndices.length}，只接受 0/9/24/45。`)
  }
  const shCount = restIndices.length
  const shDegree = shCount === 0 ? 0 : shCount === 9 ? 1 : shCount === 24 ? 2 : 3

  const normals = ['nx', 'ny', 'nz'].filter((name) => unique.has(name))
  if (normals.length !== 0 && normals.length !== 3) fail('PLY_FIELDS', '法线属性必须成组出现。')
  const hasNormals = normals.length === 3

  const allowed = new Set<string>(BASE_FIELDS)
  for (let i = 0; i < shCount; i += 1) allowed.add(`f_rest_${i}`)
  if (hasNormals) {
    allowed.add('nx')
    allowed.add('ny')
    allowed.add('nz')
  }
  for (const name of properties) {
    if (!allowed.has(name)) fail('PLY_FIELDS', `不接受未知属性 ${name}。`)
  }

  const fields = new Map<string, PlyField>()
  properties.forEach((name, index) => {
    fields.set(name, { name, offset: index * 4 })
  })

  const rowBytes = properties.length * 4
  const dataBytes = buffer.byteLength - dataStart
  const expected = vertexCount * rowBytes
  if (dataBytes !== expected) {
    fail('PLY_LENGTH', `数据 ${dataBytes} 字节，期望 ${expected} 字节。`)
  }

  const view = new DataView(buffer, dataStart, dataBytes)
  const xOffset = fields.get('x')!.offset
  const yOffset = fields.get('y')!.offset
  const zOffset = fields.get('z')!.offset
  const opacityOffset = fields.get('opacity')!.offset
  const scaleOffsets = [0, 1, 2].map((i) => fields.get(`scale_${i}`)!.offset)
  const rotOffsets = [0, 1, 2, 3].map((i) => fields.get(`rot_${i}`)!.offset)
  const dcOffsets = [0, 1, 2].map((i) => fields.get(`f_dc_${i}`)!.offset)
  const restOffsets = Array.from({ length: shCount }, (_, i) => fields.get(`f_rest_${i}`)!.offset)
  const normalOffsets = hasNormals ? ['nx', 'ny', 'nz'].map((name) => fields.get(name)!.offset) : []

  let minX = Infinity
  let minY = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let maxZ = -Infinity

  const finite = (offset: number, vertex: number, name: string): number => {
    const value = view.getFloat32(offset, true)
    if (!Number.isFinite(value)) {
      fail('PLY_VALUES', `第 ${vertex} 个顶点的 ${name} 不是有限数。`)
    }
    return value
  }

  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const base = vertex * rowBytes
    const x = finite(base + xOffset, vertex, 'x')
    const y = finite(base + yOffset, vertex, 'y')
    const z = finite(base + zOffset, vertex, 'z')
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (z < minZ) minZ = z
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
    if (z > maxZ) maxZ = z

    finite(base + opacityOffset, vertex, 'opacity')
    for (const offset of scaleOffsets) finite(base + offset, vertex, 'scale')
    for (const offset of dcOffsets) finite(base + offset, vertex, 'f_dc')
    for (const offset of restOffsets) finite(base + offset, vertex, 'f_rest')
    for (const offset of normalOffsets) finite(base + offset, vertex, 'normal')

    let qx = 0
    let qy = 0
    let qz = 0
    let qw = 0
    rotOffsets.forEach((offset, index) => {
      const value = finite(base + offset, vertex, `rot_${index}`)
      if (index === 0) qw = value
      else if (index === 1) qx = value
      else if (index === 2) qy = value
      else qz = value
    })
    if (qw * qw + qx * qx + qy * qy + qz * qz <= 1e-20) {
      fail('PLY_VALUES', `第 ${vertex} 个顶点的四元数为 0。`)
    }
  }

  return {
    kind: 'ply',
    vertexCount,
    rowBytes,
    headerBytes: dataStart,
    shDegree,
    hasNormals,
    fields,
    bounds: {
      min: [minX, minY, minZ],
      max: [maxX, maxY, maxZ],
    },
  }
}
