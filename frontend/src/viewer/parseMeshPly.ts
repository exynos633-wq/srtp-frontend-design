import { ViewerError } from './errors'

export interface ParsedMeshPly {
  kind: 'mesh-ply'
  vertexCount: number
  faceCount: number
  triangleCount: number
  positions: Float32Array
  normals: Float32Array | null
  colors: Float32Array | null
  indices: Uint32Array
  hasTextureCoordinates: boolean
  bounds: {
    min: [number, number, number]
    max: [number, number, number]
  }
}

type PlyFormat = 'ascii' | 'binary_little_endian' | 'binary_big_endian'
type ScalarType =
  | 'int8'
  | 'uint8'
  | 'int16'
  | 'uint16'
  | 'int32'
  | 'uint32'
  | 'float32'
  | 'float64'

interface ScalarProperty {
  kind: 'scalar'
  name: string
  type: ScalarType
}

interface ListProperty {
  kind: 'list'
  name: string
  countType: ScalarType
  itemType: ScalarType
}

type PlyProperty = ScalarProperty | ListProperty

interface PlyElement {
  name: string
  count: number
  properties: PlyProperty[]
}

interface PlyHeader {
  format: PlyFormat
  elements: PlyElement[]
  dataStart: number
}

interface Reader {
  scalar: (type: ScalarType) => number
  skip: (type: ScalarType) => void
  done: () => boolean
}

const MAX_HEADER_BYTES = 512 * 1024
const MAX_VERTICES = 20_000_000
const MAX_TRIANGLES = 50_000_000
const MAX_ELEMENT_ROWS = MAX_VERTICES + MAX_TRIANGLES
const MAX_LIST_ITEMS = 10_000_000

const TYPE_ALIASES: Record<string, ScalarType> = {
  char: 'int8',
  int8: 'int8',
  uchar: 'uint8',
  uint8: 'uint8',
  short: 'int16',
  int16: 'int16',
  ushort: 'uint16',
  uint16: 'uint16',
  int: 'int32',
  int32: 'int32',
  uint: 'uint32',
  uint32: 'uint32',
  float: 'float32',
  float32: 'float32',
  double: 'float64',
  float64: 'float64',
}

const TYPE_BYTES: Record<ScalarType, number> = {
  int8: 1,
  uint8: 1,
  int16: 2,
  uint16: 2,
  int32: 4,
  uint32: 4,
  float32: 4,
  float64: 8,
}

function fail(code: 'PLY_HEADER' | 'PLY_FORMAT' | 'PLY_FIELDS' | 'PLY_LENGTH' | 'PLY_VALUES', detail?: string): never {
  throw new ViewerError(code, detail)
}

function scalarType(raw: string): ScalarType {
  const type = TYPE_ALIASES[raw]
  if (!type) fail('PLY_FORMAT', `未知数值类型 ${raw}。`)
  return type
}

function readHeader(buffer: ArrayBuffer): PlyHeader {
  const bytes = new Uint8Array(buffer)
  const probeLength = Math.min(bytes.byteLength, MAX_HEADER_BYTES)
  const text = new TextDecoder('latin1').decode(bytes.subarray(0, probeLength))
  const endMatch = /(?:^|\n)end_header\r?\n/.exec(text)
  if (!endMatch) fail('PLY_HEADER', '未找到 end_header。')
  const dataStart = endMatch.index + endMatch[0].length
  const headerText = text.slice(0, endMatch.index)
  const lines = headerText.split(/\r?\n/).map((line) => line.trim())
  if (lines[0] !== 'ply') fail('PLY_HEADER', '首行不是 ply。')

  const formatLines = lines.filter((line) => line.startsWith('format '))
  if (formatLines.length !== 1) fail('PLY_FORMAT', '缺少唯一的 format 行。')
  const formatParts = formatLines[0]!.split(/\s+/)
  if (formatParts.length !== 3 || formatParts[2] !== '1.0') {
    fail('PLY_FORMAT', `收到 ${formatLines[0]}。`)
  }
  const format = formatParts[1]
  if (format !== 'ascii' && format !== 'binary_little_endian' && format !== 'binary_big_endian') {
    fail('PLY_FORMAT', `不支持 ${formatLines[0]}。`)
  }

  const elements: PlyElement[] = []
  let current: PlyElement | null = null
  for (const line of lines.slice(1)) {
    if (
      line === '' ||
      line.startsWith('comment ') ||
      line.startsWith('obj_info ') ||
      line.startsWith('format ') ||
      line === 'end_header'
    ) {
      continue
    }
    if (line.startsWith('element ')) {
      const parts = line.split(/\s+/)
      if (parts.length !== 3) fail('PLY_HEADER', `element 行不完整：${line}`)
      const count = Number(parts[2])
      if (!Number.isSafeInteger(count) || count < 0) fail('PLY_HEADER', `element 数量无效：${line}`)
      current = { name: parts[1]!, count, properties: [] }
      elements.push(current)
      continue
    }
    if (line.startsWith('property ')) {
      if (!current) fail('PLY_HEADER', 'property 出现在 element 之前。')
      const parts = line.split(/\s+/)
      if (parts.length === 3) {
        current.properties.push({ kind: 'scalar', name: parts[2]!, type: scalarType(parts[1]!) })
      } else if (parts.length === 5 && parts[1] === 'list') {
        current.properties.push({
          kind: 'list',
          name: parts[4]!,
          countType: scalarType(parts[2]!),
          itemType: scalarType(parts[3]!),
        })
      } else {
        fail('PLY_HEADER', `property 行不完整：${line}`)
      }
      continue
    }
    fail('PLY_HEADER', `无法识别头部行：${line}`)
  }

  const vertices = elements.filter((element) => element.name === 'vertex')
  if (vertices.length !== 1) fail('PLY_HEADER', '必须且只能有一个 vertex 元素。')
  if (vertices[0]!.count <= 0) fail('PLY_FIELDS', 'vertex 数量必须大于 0。')
  if (vertices[0]!.count > MAX_VERTICES) fail('PLY_FIELDS', '网格顶点数超过查看器上限。')

  const names = new Set<string>()
  let totalRows = 0
  for (const element of elements) {
    totalRows += element.count
    if (totalRows > MAX_ELEMENT_ROWS) fail('PLY_FIELDS', 'PLY 元素总记录数超过查看器上限。')
    if (element.count > 0 && element.properties.length === 0) {
      fail('PLY_FIELDS', `元素 ${element.name} 有记录但没有属性。`)
    }
    const seen = new Set<string>()
    for (const property of element.properties) {
      if (seen.has(property.name)) fail('PLY_FIELDS', `元素 ${element.name} 存在重名属性 ${property.name}。`)
      seen.add(property.name)
    }
    names.add(element.name)
  }
  if (names.size !== elements.length) fail('PLY_HEADER', '存在重复 element。')

  return { format, elements, dataStart }
}

function makeAsciiReader(buffer: ArrayBuffer, dataStart: number): Reader {
  const text = new TextDecoder('latin1').decode(new Uint8Array(buffer, dataStart))
  let index = 0
  const nextToken = (): string => {
    while (index < text.length && /\s/.test(text[index]!)) index += 1
    if (index >= text.length) fail('PLY_LENGTH', 'ASCII 数据提前结束。')
    const start = index
    while (index < text.length && !/\s/.test(text[index]!)) index += 1
    return text.slice(start, index)
  }
  return {
    scalar(type) {
      const value = Number(nextToken())
      if (!Number.isFinite(value)) fail('PLY_VALUES', `ASCII 数值无效：${type}。`)
      return value
    },
    skip(type) {
      this.scalar(type)
    },
    done() {
      while (index < text.length && /\s/.test(text[index]!)) index += 1
      return index >= text.length
    },
  }
}

function makeBinaryReader(buffer: ArrayBuffer, dataStart: number, littleEndian: boolean): Reader {
  const view = new DataView(buffer)
  let offset = dataStart
  const ensure = (size: number) => {
    if (offset + size > buffer.byteLength) fail('PLY_LENGTH', '二进制数据提前结束。')
  }
  return {
    scalar(type) {
      const size = TYPE_BYTES[type]
      ensure(size)
      let value: number
      switch (type) {
        case 'int8':
          value = view.getInt8(offset)
          break
        case 'uint8':
          value = view.getUint8(offset)
          break
        case 'int16':
          value = view.getInt16(offset, littleEndian)
          break
        case 'uint16':
          value = view.getUint16(offset, littleEndian)
          break
        case 'int32':
          value = view.getInt32(offset, littleEndian)
          break
        case 'uint32':
          value = view.getUint32(offset, littleEndian)
          break
        case 'float32':
          value = view.getFloat32(offset, littleEndian)
          break
        case 'float64':
          value = view.getFloat64(offset, littleEndian)
          break
      }
      offset += size
      return value
    },
    skip(type) {
      ensure(TYPE_BYTES[type])
      offset += TYPE_BYTES[type]
    },
    done() {
      return offset === buffer.byteLength
    },
  }
}

function skipElement(element: PlyElement, reader: Reader): void {
  for (let row = 0; row < element.count; row += 1) {
    for (const property of element.properties) {
      if (property.kind === 'scalar') {
        reader.skip(property.type)
        continue
      }
      const count = reader.scalar(property.countType)
      if (!Number.isInteger(count) || count < 0 || count > MAX_LIST_ITEMS) {
        fail('PLY_VALUES', `${element.name} 的列表长度无效。`)
      }
      for (let item = 0; item < count; item += 1) reader.skip(property.itemType)
    }
  }
}

/** 只根据 PLY 头部判断是否为带面片的网格文件；不读取顶点数据。 */
export function isMeshPly(buffer: ArrayBuffer): boolean {
  try {
    return readHeader(buffer).elements.some((element) => element.name === 'face')
  } catch {
    return false
  }
}

/**
 * 解析常见网格 PLY：ASCII、二进制小端/大端，顶点 x/y/z，可选法线与
 * uchar/float 颜色，face 的 vertex_indices 多边形会三角化。
 * 不猜测缺失的面片，也不把点云当作网格。
 */
export function parseMeshPly(buffer: ArrayBuffer): ParsedMeshPly {
  const header = readHeader(buffer)
  const vertexElement = header.elements.find((element) => element.name === 'vertex')!
  const faceIndex = header.elements.findIndex((element) => element.name === 'face')
  if (faceIndex < 0) fail('PLY_FIELDS', '网格 PLY 缺少 face 元素。')
  const vertexIndex = header.elements.indexOf(vertexElement)
  if (faceIndex < vertexIndex) fail('PLY_HEADER', 'face 元素必须位于 vertex 之后。')

  const vertexProps = new Map(vertexElement.properties.map((property) => [property.name, property]))
  for (const name of ['x', 'y', 'z']) {
    const property = vertexProps.get(name)
    if (!property || property.kind !== 'scalar') fail('PLY_FIELDS', `顶点缺少标量属性 ${name}。`)
  }
  const normalNames = ['nx', 'ny', 'nz']
  const colorNames = ['red', 'green', 'blue']
  const presentNormals = normalNames.filter((name) => vertexProps.has(name))
  if (presentNormals.length !== 0 && presentNormals.length !== 3) fail('PLY_FIELDS', '法线属性必须成组出现。')
  const presentColors = colorNames.filter((name) => vertexProps.has(name))
  if (presentColors.length !== 0 && presentColors.length !== 3) fail('PLY_FIELDS', '颜色属性必须包含 red/green/blue。')
  for (const name of [...normalNames, ...colorNames]) {
    const property = vertexProps.get(name)
    if (property && property.kind !== 'scalar') fail('PLY_FIELDS', `属性 ${name} 必须是标量。`)
  }

  const faceElement = header.elements[faceIndex]!
  const faceProperties = faceElement.properties
  const indexProperty = faceProperties.find(
    (property) =>
      property.kind === 'list' &&
      (property.name === 'vertex_indices' || property.name === 'vertex_index'),
  ) as ListProperty | undefined
  if (!indexProperty) fail('PLY_FIELDS', 'face 缺少 vertex_indices 列表。')
  if (indexProperty.countType === 'float32' || indexProperty.countType === 'float64') {
    fail('PLY_FORMAT', 'face 的列表计数不能是浮点数。')
  }
  if (indexProperty.itemType === 'float32' || indexProperty.itemType === 'float64') {
    fail('PLY_FORMAT', 'face 的顶点索引不能是浮点数。')
  }

  const reader =
    header.format === 'ascii'
      ? makeAsciiReader(buffer, header.dataStart)
      : makeBinaryReader(buffer, header.dataStart, header.format === 'binary_little_endian')

  const vertexCount = vertexElement.count
  const positions = new Float32Array(vertexCount * 3)
  const normals = presentNormals.length === 3 ? new Float32Array(vertexCount * 3) : null
  const rawColors = presentColors.length === 3 ? new Float32Array(vertexCount * 3) : null
  let minX = Infinity
  let minY = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let maxZ = -Infinity
  const triangleIndices: number[] = []

  for (let elementIndex = 0; elementIndex < header.elements.length; elementIndex += 1) {
    const element = header.elements[elementIndex]!
    if (element.name === 'vertex') {
      for (let vertex = 0; vertex < vertexCount; vertex += 1) {
        for (const property of element.properties) {
          if (property.kind === 'list') {
            const count = reader.scalar(property.countType)
            if (!Number.isInteger(count) || count < 0 || count > MAX_LIST_ITEMS) {
              fail('PLY_VALUES', `顶点 ${vertex} 的列表长度无效。`)
            }
            for (let item = 0; item < count; item += 1) reader.skip(property.itemType)
            continue
          }
          const value = reader.scalar(property.type)
          if (!Number.isFinite(value)) fail('PLY_VALUES', `顶点 ${vertex} 的 ${property.name} 不是有限数。`)
          const base = vertex * 3
          if (property.name === 'x') {
            positions[base] = value
            if (value < minX) minX = value
            if (value > maxX) maxX = value
          } else if (property.name === 'y') {
            positions[base + 1] = value
            if (value < minY) minY = value
            if (value > maxY) maxY = value
          } else if (property.name === 'z') {
            positions[base + 2] = value
            if (value < minZ) minZ = value
            if (value > maxZ) maxZ = value
          } else if (property.name === 'nx' && normals) {
            normals[base] = value
          } else if (property.name === 'ny' && normals) {
            normals[base + 1] = value
          } else if (property.name === 'nz' && normals) {
            normals[base + 2] = value
          } else if (property.name === 'red' && rawColors) {
            rawColors[base] = value
          } else if (property.name === 'green' && rawColors) {
            rawColors[base + 1] = value
          } else if (property.name === 'blue' && rawColors) {
            rawColors[base + 2] = value
          }
        }
      }
      continue
    }

    if (element.name !== 'face') {
      skipElement(element, reader)
      continue
    }

    for (let face = 0; face < element.count; face += 1) {
      let indices: number[] | null = null
      for (const property of faceProperties) {
        if (property.kind === 'scalar') {
          reader.skip(property.type)
          continue
        }
        const count = reader.scalar(property.countType)
        if (!Number.isInteger(count) || count < 0 || count > MAX_LIST_ITEMS) {
          fail('PLY_VALUES', `面 ${face} 的列表长度无效。`)
        }
        if (property.name === 'vertex_indices' || property.name === 'vertex_index') {
          indices = []
          for (let item = 0; item < count; item += 1) {
            const index = reader.scalar(property.itemType)
            if (!Number.isInteger(index) || index < 0 || index >= vertexCount) {
              fail('PLY_VALUES', `面 ${face} 引用了无效顶点 ${index}。`)
            }
            indices.push(index)
          }
        } else {
          for (let item = 0; item < count; item += 1) reader.skip(property.itemType)
        }
      }
      if (!indices || indices.length < 3) fail('PLY_VALUES', `面 ${face} 少于 3 个顶点。`)
      for (let corner = 1; corner < indices.length - 1; corner += 1) {
        triangleIndices.push(indices[0]!, indices[corner]!, indices[corner + 1]!)
        if (triangleIndices.length / 3 > MAX_TRIANGLES) fail('PLY_FIELDS', '网格三角面数超过查看器上限。')
      }
    }
  }

  if (!reader.done()) fail('PLY_LENGTH', 'PLY 数据后仍有未消费的字节。')
  if (triangleIndices.length === 0) fail('PLY_FIELDS', '网格没有可显示的三角面。')

  let colors: Float32Array | null = null
  if (rawColors) {
    colors = new Float32Array(rawColors.length)
    const divisors = colorNames.map((name) => {
      const property = vertexProps.get(name) as ScalarProperty
      return property.type === 'uint8' ? 255 : 1
    })
    for (let index = 0; index < rawColors.length; index += 1) {
      colors[index] = Math.min(1, Math.max(0, rawColors[index]! / divisors[index % 3]!))
    }
  }

  return {
    kind: 'mesh-ply',
    vertexCount,
    faceCount: faceElement.count,
    triangleCount: triangleIndices.length / 3,
    positions,
    normals,
    colors,
    indices: new Uint32Array(triangleIndices),
    hasTextureCoordinates: ['s', 't', 'u', 'v', 'texture_u', 'texture_v'].some((name) =>
      vertexProps.has(name),
    ),
    bounds: {
      min: [minX, minY, minZ],
      max: [maxX, maxY, maxZ],
    },
  }
}
