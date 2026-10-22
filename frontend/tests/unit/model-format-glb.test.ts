import { describe, expect, it } from 'vitest'
import { ViewerError } from '../../src/viewer/errors'
import { parseGlbContainer } from '../../src/viewer/parseGlb'
import { detectFormatFromBytes } from '../../src/viewer/source'

function buildGlb(
  json: Record<string, unknown>,
  options: { version?: number; declaredLength?: number; firstChunkType?: number; invalidJson?: boolean } = {},
): ArrayBuffer {
  const jsonText = options.invalidJson ? '{not json' : JSON.stringify({ asset: { version: '2.0' }, ...json })
  const encoder = new TextEncoder()
  const jsonBytes = encoder.encode(jsonText)
  const paddedLength = Math.ceil(jsonBytes.length / 4) * 4
  const total = 12 + 8 + paddedLength
  const buffer = new ArrayBuffer(total)
  const view = new DataView(buffer)
  view.setUint32(0, 0x46546c67, true)
  view.setUint32(4, options.version ?? 2, true)
  view.setUint32(8, options.declaredLength ?? total, true)
  view.setUint32(12, paddedLength, true)
  view.setUint32(16, options.firstChunkType ?? 0x4e4f534a, true)
  const bytes = new Uint8Array(buffer)
  bytes.set(jsonBytes, 20)
  for (let index = 20 + jsonBytes.length; index < total; index += 1) bytes[index] = 0x20
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

describe('GLB 容器、外部资源与 required 扩展校验', () => {
  it('按 magic 识别 GLB 容器', () => {
    const bytes = new Uint8Array(buildGlb({}))
    expect(detectFormatFromBytes(bytes.subarray(0, 64))).toBe('glb')
  })

  it('接受内嵌 buffer 与 data URI 图片', () => {
    const parsed = parseGlbContainer(
      buildGlb({
        buffers: [{ byteLength: 4 }, { byteLength: 3, uri: 'data:application/octet-stream;base64,AAAA' }],
        images: [{ uri: 'data:image/png;base64,AAAA' }],
        extensionsRequired: ['KHR_materials_unlit'],
      }),
    )
    expect(parsed.kind).toBe('glb')
    expect(parsed.json.asset).toEqual({ version: '2.0' })
  })

  it('拒绝非 2 版本、长度不符与错误首个 chunk', () => {
    expectViewerError(() => parseGlbContainer(buildGlb({}, { version: 1 })), 'GLB_HEADER')
    expectViewerError(() => parseGlbContainer(buildGlb({}, { declaredLength: 999 })), 'GLB_HEADER')
    expectViewerError(
      () => parseGlbContainer(buildGlb({}, { firstChunkType: 0x004e4942 })),
      'GLB_HEADER',
    )
    expectViewerError(() => parseGlbContainer(buildGlb({}, { invalidJson: true })), 'GLB_JSON')
  })

  it('拒绝外部 buffer 与图片 URI，不自动联网', () => {
    expectViewerError(
      () => parseGlbContainer(buildGlb({ buffers: [{ byteLength: 4, uri: 'model.bin' }] })),
      'GLB_EXTERNAL',
    )
    expectViewerError(
      () => parseGlbContainer(buildGlb({ images: [{ uri: 'texture.png' }] })),
      'GLB_EXTERNAL',
    )
  })

  it('需要解码器的扩展明确拒绝', () => {
    for (const extension of ['KHR_draco_mesh_compression', 'EXT_meshopt_compression', 'KHR_texture_basisu']) {
      expectViewerError(
        () => parseGlbContainer(buildGlb({ extensionsRequired: [extension] })),
        'DECODER_REQUIRED',
      )
    }
  })

  it('未知必要扩展拒绝，已知材质扩展放行', () => {
    expectViewerError(
      () => parseGlbContainer(buildGlb({ extensionsRequired: ['VENDOR_future_magic'] })),
      'GLB_EXTENSION',
    )
    expect(() =>
      parseGlbContainer(buildGlb({ extensionsRequired: ['KHR_materials_emissive_strength'] })),
    ).not.toThrow()
  })
})
