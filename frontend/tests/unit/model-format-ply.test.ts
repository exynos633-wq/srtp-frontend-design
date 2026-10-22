import { describe, expect, it } from 'vitest'
import { ViewerError } from '../../src/viewer/errors'
import { parsePly } from '../../src/viewer/parsePly'
import { detectFormatFromBytes } from '../../src/viewer/source'

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
]

interface BuildOptions {
  shCount?: 0 | 9 | 24 | 45
  normals?: boolean
  extraProperty?: string
  vertexCount?: number
  format?: string
  value?: (index: number, name: string) => number
  truncateBytes?: number
  headerOnly?: boolean
}

function buildPly(options: BuildOptions = {}) {
  const shCount = options.shCount ?? 0
  const vertexCount = options.vertexCount ?? 2
  const fields = [
    'x',
    'y',
    'z',
    ...(options.normals ? ['nx', 'ny', 'nz'] : []),
    ...BASE_FIELDS.slice(3),
    ...Array.from({ length: shCount }, (_, index) => `f_rest_${index}`),
    ...(options.extraProperty ? [options.extraProperty] : []),
  ]
  const lines = [
    'ply',
    `format ${options.format ?? 'binary_little_endian'} 1.0`,
    `comment test fixture`,
    `element vertex ${vertexCount}`,
    ...fields.map((name) => `property float ${name}`),
    'end_header',
    '',
  ]
  const header = new TextEncoder().encode(lines.join('\n'))
  const data = new Float32Array(vertexCount * fields.length)
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    fields.forEach((name, index) => {
      const value = options.value
        ? options.value(vertex, name)
        : name === 'rot_0'
          ? 1
          : name === 'x'
            ? vertex
            : name === 'y'
              ? vertex * 2
              : name === 'z'
                ? 3
                : name === 'scale_0' || name === 'scale_1' || name === 'scale_2'
                  ? -2
                  : 0.25
      data[vertex * fields.length + index] = value
    })
  }
  const dataBytes = new Uint8Array(data.buffer)
  const total = header.length + dataBytes.length
  const merged = new Uint8Array(total)
  merged.set(header, 0)
  merged.set(dataBytes, header.length)
  const trimmed = options.truncateBytes ? merged.slice(0, Math.max(0, total - options.truncateBytes)) : merged
  return trimmed.buffer
}

function expectViewerError(fn: () => unknown, code: string): void {
  try {
    fn()
  } catch (error) {
    expect(error).toBeInstanceOf(ViewerError)
    expect((error as ViewerError).code).toBe(code)
    return
  }
  throw new Error(`期望抛出 ${code}`)
}

describe('3DGS PLY 内容识别与字段校验', () => {
  it('按文件头识别 PLY，而不是后缀', () => {
    const bytes = new Uint8Array(buildPly())
    expect(detectFormatFromBytes(bytes.subarray(0, 64))).toBe('ply')
    expect(detectFormatFromBytes(new TextEncoder().encode('not a model'))).toBeNull()
    expect(detectFormatFromBytes(new TextEncoder().encode('glTF'))).toBeNull()
  })

  it('接受标准球谐 0/9/24/45 组合', () => {
    for (const shCount of [0, 9, 24, 45] as const) {
      const parsed = parsePly(buildPly({ shCount, normals: true }))
      expect(parsed.vertexCount).toBe(2)
      expect(parsed.shDegree).toBe(shCount === 0 ? 0 : shCount === 9 ? 1 : shCount === 24 ? 2 : 3)
      expect(parsed.hasNormals).toBe(true)
      expect(parsed.bounds.min[0]).toBe(0)
      expect(parsed.bounds.max[0]).toBe(1)
    }
  })

  it('拒绝 ASCII / 大端 PLY', () => {
    expectViewerError(() => parsePly(buildPly({ format: 'ascii' })), 'PLY_FORMAT')
    expectViewerError(() => parsePly(buildPly({ format: 'binary_big_endian' })), 'PLY_FORMAT')
  })

  it('拒绝普通点云与缺字段', () => {
    const header = new TextEncoder().encode(
      'ply\nformat binary_little_endian 1.0\nelement vertex 1\nproperty float x\nproperty float y\nproperty float z\nproperty uchar red\nend_header\n',
    )
    const data = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    const merged = new Uint8Array(header.length + data.length)
    merged.set(header)
    merged.set(data, header.length)
    expectViewerError(() => parsePly(merged.buffer), 'PLY_FORMAT')
  })

  it('拒绝非 0/9/24/45 的 f_rest 数量', () => {
    const buffer = buildPly({ shCount: 9 })
    const text = new TextDecoder('latin1').decode(new Uint8Array(buffer, 0, Math.min(2048, buffer.byteLength)))
    const headerEnd = text.indexOf('end_header')
    const brokenHeader = text
      .slice(0, headerEnd)
      .replace('property float f_rest_8', 'property float extra_rest')
    const newHeader = new TextEncoder().encode(`${brokenHeader}end_header\n`)
    const dataStart = text.indexOf('end_header') + 'end_header\n'.length
    const data = new Uint8Array(buffer, dataStart)
    const merged = new Uint8Array(newHeader.length + data.length)
    merged.set(newHeader)
    merged.set(data, newHeader.length)
    expectViewerError(() => parsePly(merged.buffer), 'PLY_FIELDS')
  })

  it('拒绝未知属性与不完整法线组', () => {
    expectViewerError(() => parsePly(buildPly({ extraProperty: 'temperature' })), 'PLY_FIELDS')
    const buffer = buildPly({ normals: false })
    const text = new TextDecoder('latin1').decode(new Uint8Array(buffer, 0, Math.min(2048, buffer.byteLength)))
    const broken = text.replace('property float z', 'property float z\nproperty float nx')
    const headerEnd = text.indexOf('end_header') + 'end_header\n'.length
    const data = new Uint8Array(buffer, headerEnd)
    const header = new TextEncoder().encode(broken.slice(0, broken.indexOf('end_header')) + 'end_header\n')
    const merged = new Uint8Array(header.length + data.length)
    merged.set(header)
    merged.set(data, header.length)
    expectViewerError(() => parsePly(merged.buffer), 'PLY_FIELDS')
  })

  it('拒绝截断长度与 NaN/Infinity', () => {
    expectViewerError(() => parsePly(buildPly({ truncateBytes: 8 })), 'PLY_LENGTH')
    expectViewerError(
      () => parsePly(buildPly({ value: (_i, name) => (name === 'x' ? Number.NaN : 0.5) })),
      'PLY_VALUES',
    )
    expectViewerError(
      () => parsePly(buildPly({ value: (_i, name) => (name === 'opacity' ? Number.POSITIVE_INFINITY : 0.5) })),
      'PLY_VALUES',
    )
  })

  it('拒绝零四元数', () => {
    expectViewerError(
      () =>
        parsePly(
          buildPly({
            value: (_i, name) =>
              name === 'rot_0' || name === 'rot_1' || name === 'rot_2' || name === 'rot_3' ? 0 : 0.5,
          }),
        ),
      'PLY_VALUES',
    )
  })
})
