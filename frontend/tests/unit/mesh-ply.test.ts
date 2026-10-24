import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { ViewerError } from '../../src/viewer/errors'
import { buildModel } from '../../src/viewer/loadModel'
import { isMeshPly, parseMeshPly } from '../../src/viewer/parseMeshPly'

const ASCII_HEADER = [
  'ply',
  'format ascii 1.0',
  'comment mesh fixture',
  'element vertex 4',
  'property float x',
  'property float y',
  'property float z',
  'property float nx',
  'property float ny',
  'property float nz',
  'property uchar red',
  'property uchar green',
  'property uchar blue',
  'element face 1',
  'property list uchar uint vertex_indices',
  'end_header',
].join('\n')

const ASCII_BODY = [
  '0 0 0 0 0 1 255 0 0',
  '1 0 0 0 0 1 0 255 0',
  '1 1 0 0 0 1 0 0 255',
  '0 1 0 0 0 1 255 255 255',
  '4 0 1 2 3',
].join('\n')

function asciiBuffer(body = ASCII_BODY, header = ASCII_HEADER): ArrayBuffer {
  return new TextEncoder().encode(`${header}\n${body}\n`).buffer
}

function binaryBuffer(bigEndian = false): ArrayBuffer {
  const header = new TextEncoder().encode(
    [
      'ply',
      `format binary_${bigEndian ? 'big' : 'little'}_endian 1.0`,
      'element vertex 3',
      'property float x',
      'property float y',
      'property float z',
      'property uchar red',
      'property uchar green',
      'property uchar blue',
      'element face 1',
      'property list uchar uint vertex_indices',
      'end_header',
      '',
    ].join('\n'),
  )
  const littleEndian = !bigEndian
  const vertexBytes = 3 * (12 + 3)
  const faceBytes = 1 + 3 * 4
  const buffer = new ArrayBuffer(header.byteLength + vertexBytes + faceBytes)
  new Uint8Array(buffer).set(header)
  const view = new DataView(buffer)
  let offset = header.byteLength
  const vertices = [
    [0, 0, 0, 255, 0, 0],
    [1, 0, 0, 0, 255, 0],
    [0, 1, 0, 0, 0, 255],
  ]
  for (const [x, y, z, r, g, b] of vertices) {
    view.setFloat32(offset, x!, littleEndian)
    view.setFloat32(offset + 4, y!, littleEndian)
    view.setFloat32(offset + 8, z!, littleEndian)
    offset += 12
    view.setUint8(offset, r!)
    view.setUint8(offset + 1, g!)
    view.setUint8(offset + 2, b!)
    offset += 3
  }
  view.setUint8(offset, 3)
  offset += 1
  for (const index of [0, 1, 2]) {
    view.setUint32(offset, index, littleEndian)
    offset += 4
  }
  return buffer
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

describe('网格 PLY 解析', () => {
  it('解析 ASCII 顶点、颜色与四边形面，并按扇形三角化', () => {
    const buffer = asciiBuffer()
    expect(isMeshPly(buffer)).toBe(true)
    const parsed = parseMeshPly(buffer)
    expect(parsed.vertexCount).toBe(4)
    expect(parsed.faceCount).toBe(1)
    expect(parsed.triangleCount).toBe(2)
    expect(Array.from(parsed.indices)).toEqual([0, 1, 2, 0, 2, 3])
    expect(Array.from(parsed.positions.slice(0, 6))).toEqual([0, 0, 0, 1, 0, 0])
    expect(parsed.normals).not.toBeNull()
    expect(parsed.colors).not.toBeNull()
    expect(parsed.colors![0]).toBe(1)
    expect(parsed.colors![1]).toBe(0)
    expect(parsed.colors![3]).toBe(0)
    expect(parsed.colors![4]).toBe(1)
    expect(parsed.bounds.min).toEqual([0, 0, 0])
    expect(parsed.bounds.max).toEqual([1, 1, 0])
  })

  it('解析二进制小端与二进制大端', () => {
    for (const bigEndian of [false, true]) {
      const parsed = parseMeshPly(binaryBuffer(bigEndian))
      expect(parsed.triangleCount).toBe(1)
      expect(Array.from(parsed.positions.slice(0, 3))).toEqual([0, 0, 0])
      expect(Array.from(parsed.indices)).toEqual([0, 1, 2])
      expect(parsed.colors![0]).toBe(1)
    }
  })

  it('构建可渲染的 Three.js 网格，并保留格式与三角面统计', async () => {
    const phases: string[] = []
    const model = await buildModel(asciiBuffer(), {
      sourceName: 'mesh-quad.ply',
      scale: 1,
      signal: new AbortController().signal,
      onPhase: (phase) => phases.push(phase),
    })
    expect(phases).toEqual(['parse', 'initialize'])
    expect(model.format).toBe('mesh-ply')
    expect(model.info.format).toBe('mesh-ply')
    expect(model.info.triangles).toBe(2)
    expect(model.info.sourceUp).toBe('z')
    expect(model.splatLook).toBeNull()
    expect(model.glbLook).not.toBeNull()
    const mesh = model.object as THREE.Mesh
    expect(mesh.geometry.getAttribute('position').count).toBe(4)
    expect(mesh.geometry.getIndex()?.count).toBe(6)
    expect(mesh.geometry.getAttribute('color')).toBeTruthy()
    expect((mesh.material as THREE.MeshStandardMaterial).side).toBe(THREE.DoubleSide)
    model.dispose()
  })

  it('拒绝没有 face 的普通点云', () => {
    const header = ASCII_HEADER.slice(0, ASCII_HEADER.indexOf('element face'))
    expectViewerError(() => parseMeshPly(asciiBuffer('0 0 0 0 0 1 255 0 0', `${header}end_header`)), 'PLY_FIELDS')
  })

  it('拒绝越界索引、截断数据和未知格式', () => {
    expectViewerError(
      () => parseMeshPly(asciiBuffer(ASCII_BODY.replace('4 0 1 2 3', '4 0 1 2 9'))),
      'PLY_VALUES',
    )
    const truncated = binaryBuffer().slice(0, -2)
    expectViewerError(() => parseMeshPly(truncated), 'PLY_LENGTH')
    const invalidFormat = ASCII_HEADER.replace('format ascii 1.0', 'format binary_little_endian 2.0')
    expectViewerError(() => parseMeshPly(asciiBuffer(ASCII_BODY, invalidFormat)), 'PLY_FORMAT')
  })

  it('少于三个顶点的面不被当作可显示网格', () => {
    expectViewerError(
      () => parseMeshPly(asciiBuffer(ASCII_BODY.replace('4 0 1 2 3', '2 0 1'))),
      'PLY_VALUES',
    )
  })
})
