import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { SplatFileType, SplatMesh, dyno } from '@sparkjsdev/spark'
import { ViewerError } from './errors'
import { parseGlbContainer } from './parseGlb'
import { parsePly, type ParsedPly } from './parsePly'
import { isMeshPly, parseMeshPly, type ParsedMeshPly } from './parseMeshPly'
import { assertFiniteBounds } from './viewerMath'
import type { BoundsInfo, ModelInfo } from './types'

export interface GlbLook {
  meshes: Array<{
    mesh: THREE.Mesh
    original: THREE.Material | THREE.Material[]
  }>
  toneMaterial: THREE.MeshStandardMaterial
  emissive: Array<{ material: THREE.MeshStandardMaterial; intensity: number }>
  hasEmissive: boolean
  hasMaterials: boolean
}

export interface SplatLook {
  mesh: SplatMesh
  scaleUniform: dyno.DynoFloat<string>
  toneAmount: dyno.DynoFloat<string>
  toneColor: dyno.DynoVec3<THREE.Vector3, string>
}

export interface LoadedModel {
  format: 'glb' | 'gaussian-ply' | 'mesh-ply'
  object: THREE.Object3D
  bounds: BoundsInfo
  info: ModelInfo
  glbLook: GlbLook | null
  splatLook: SplatLook | null
  dispose: () => void
  recomputeBounds: () => BoundsInfo
  setSplatScale: (value: number) => void
  setSplatTone: (amount: number) => void
  setGlbTone: (enabled: boolean) => void
  setEmissive: (enabled: boolean, intensity: number) => void
}

function countGeometry(object: THREE.Object3D): { triangles: number; materials: Set<THREE.Material> } {
  const materials = new Set<THREE.Material>()
  let triangles = 0
  object.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (!mesh.isMesh || !mesh.geometry) return
    const material = mesh.material
    if (Array.isArray(material)) material.forEach((item) => materials.add(item))
    else if (material) materials.add(material)
    const geometry = mesh.geometry
    const index = geometry.getIndex()
    const position = geometry.getAttribute('position')
    const count = index ? index.count : position ? position.count : 0
    triangles += Math.floor(count / 3)
  })
  return { triangles, materials }
}

function collectTextures(object: THREE.Object3D): number {
  const textures = new Set<THREE.Texture>()
  object.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (!mesh.isMesh || !mesh.material) return
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const material of materials) {
      for (const value of Object.values(material)) {
        if (value && (value as THREE.Texture).isTexture) textures.add(value as THREE.Texture)
      }
      const shader = material as THREE.ShaderMaterial
      if (shader.uniforms) {
        for (const uniform of Object.values(shader.uniforms)) {
          const value = uniform.value as THREE.Texture | undefined
          if (value && value.isTexture) textures.add(value)
        }
      }
    }
  })
  return textures.size
}

function disposeMaterial(material: THREE.Material, textures: Set<THREE.Texture>): void {
  for (const value of Object.values(material)) {
    if (value && (value as THREE.Texture).isTexture) textures.add(value as THREE.Texture)
  }
  const shader = material as THREE.ShaderMaterial
  if (shader.uniforms) {
    for (const uniform of Object.values(shader.uniforms)) {
      const value = uniform.value as THREE.Texture | undefined
      if (value && value.isTexture) textures.add(value)
    }
  }
}

/** 释放几何/材质/贴图；Spark 由调用方按自身 API 释放。 */
export function disposeObject3D(root: THREE.Object3D): void {
  const textures = new Set<THREE.Texture>()
  const materials = new Set<THREE.Material>()
  root.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (mesh.geometry) mesh.geometry.dispose()
    if (mesh.material) {
      const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      list.forEach((material) => {
        materials.add(material)
        disposeMaterial(material, textures)
      })
    }
  })
  const bitmaps = new Set<ImageBitmap>()
  for (const texture of textures) {
    const image = texture.image as unknown
    if (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) bitmaps.add(image)
    texture.dispose()
  }
  for (const material of materials) material.dispose()
  // ImageBitmap 不由 Texture.dispose 自动关闭；同一 bitmap 被多张 texture 共享时只关一次。
  for (const bitmap of bitmaps) bitmap.close()
  root.removeFromParent()
}

function createGlbLook(root: THREE.Object3D): GlbLook {
  const meshes: GlbLook['meshes'] = []
  const emissive: GlbLook['emissive'] = []
  root.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (!mesh.isMesh || !mesh.material) return
    meshes.push({ mesh, original: mesh.material })
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const material of materials) {
      const standard = material as THREE.MeshStandardMaterial
      if (
        standard.isMeshStandardMaterial &&
        (standard.emissiveMap || (standard.emissive && standard.emissive.getHex() !== 0))
      ) {
        emissive.push({ material: standard, intensity: standard.emissiveIntensity })
      }
    }
  })
  return {
    meshes,
    toneMaterial: new THREE.MeshStandardMaterial({
      color: 0x9fb7ba,
      roughness: 0.88,
      metalness: 0.04,
    }),
    emissive,
    hasEmissive: emissive.length > 0,
    hasMaterials: meshes.length > 0,
  }
}

function makeSplatLook(mesh: SplatMesh): SplatLook {
  const scaleUniform = dyno.dynoFloat(1, 'splatScale')
  const toneAmount = dyno.dynoFloat(0, 'toneAmount')
  const toneColor = dyno.dynoVec3(new THREE.Vector3(0.62, 0.72, 0.74), 'toneColor')
  const luminanceWeights = dyno.dynoVec3(new THREE.Vector3(0.2126, 0.7152, 0.0722))
  const modifier = dyno.dynoBlock(
    { gsplat: dyno.Gsplat },
    { gsplat: dyno.Gsplat },
    ({ gsplat }) => {
      if (!gsplat) throw new Error('缺少 gsplat 输入')
      const parts = dyno.splitGsplat(gsplat)
      const luminance = dyno.dot(parts.outputs.rgb, luminanceWeights)
      const tinted = dyno.mul(toneColor, luminance)
      const rgb = dyno.mix(parts.outputs.rgb, tinted, toneAmount)
      return {
        gsplat: dyno.combineGsplat({
          gsplat,
          scales: dyno.mul(parts.outputs.scales, scaleUniform),
          rgb,
        }),
      }
    },
  )
  mesh.objectModifier = modifier
  return { mesh, scaleUniform, toneAmount, toneColor }
}


function boundsFor(root: THREE.Object3D): BoundsInfo {
  const box = new THREE.Box3().setFromObject(root)
  if (box.isEmpty()) throw new ViewerError('EMPTY_MODEL')
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  const bounds: BoundsInfo = {
    min: [box.min.x, box.min.y, box.min.z],
    max: [box.max.x, box.max.y, box.max.z],
    size: [size.x, size.y, size.z],
    center: [center.x, center.y, center.z],
  }
  assertFiniteBounds(bounds)
  return bounds
}

function splatBounds(root: THREE.Object3D, mesh: SplatMesh): BoundsInfo {
  const box = mesh.getBoundingBox(false).applyMatrix4(root.matrixWorld)
  if (box.isEmpty()) throw new ViewerError('EMPTY_MODEL')
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  const bounds: BoundsInfo = {
    min: [box.min.x, box.min.y, box.min.z],
    max: [box.max.x, box.max.y, box.max.z],
    size: [size.x, size.y, size.z],
    center: [center.x, center.y, center.z],
  }
  assertFiniteBounds(bounds)
  return bounds
}

export interface BuildOptions {
  sourceName: string
  scale: number
  signal: AbortSignal
  onPhase: (phase: 'parse' | 'initialize') => void
}

/**
 * 解析并构建真实模型。函数内不接触 DOM/React；调用方在结果返回后
 * 用代际检查决定加入场景还是立即释放迟到结果。
 */
export async function buildModel(buffer: ArrayBuffer, options: BuildOptions): Promise<LoadedModel> {
  const { signal } = options
  const throwIfAborted = () => {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
  }

  const magic = new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 12))
  const isGlb = magic.byteLength >= 12 && String.fromCharCode(...magic.subarray(0, 4)) === 'glTF'
  const isPly =
    magic.byteLength >= 4 &&
    magic[0] === 0x70 &&
    magic[1] === 0x6c &&
    magic[2] === 0x79 &&
    (magic[3] === 0x0a || magic[3] === 0x0d)
  if (!isGlb && !isPly) throw new ViewerError('MAGIC')

  options.onPhase('parse')
  throwIfAborted()

  if (isPly && isMeshPly(buffer)) {
    let parsed: ParsedMeshPly
    try {
      parsed = parseMeshPly(buffer)
    } catch (error) {
      throw error instanceof ViewerError ? error : new ViewerError('PLY_FIELDS', undefined, error)
    }
    throwIfAborted()

    options.onPhase('initialize')
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(parsed.positions, 3))
    if (parsed.normals) geometry.setAttribute('normal', new THREE.BufferAttribute(parsed.normals, 3))
    if (parsed.colors) geometry.setAttribute('color', new THREE.BufferAttribute(parsed.colors, 3))
    geometry.setIndex(new THREE.BufferAttribute(parsed.indices, 1))
    if (!parsed.normals) geometry.computeVertexNormals()
    geometry.computeBoundingBox()
    geometry.computeBoundingSphere()

    const material = new THREE.MeshStandardMaterial({
      color: parsed.colors ? 0xffffff : 0xb7c6c8,
      vertexColors: Boolean(parsed.colors),
      roughness: 0.84,
      metalness: 0.04,
      side: THREE.DoubleSide,
    })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.name = options.sourceName

    let bounds: BoundsInfo
    let look: GlbLook
    try {
      bounds = boundsFor(mesh)
      look = createGlbLook(mesh)
    } catch (error) {
      disposeObject3D(mesh)
      if (error instanceof ViewerError) throw error
      throw new ViewerError('PARSE', error instanceof Error ? error.message : undefined, error)
    }

    const info: ModelInfo = {
      format: 'mesh-ply',
      sourceName: options.sourceName,
      bytes: buffer.byteLength,
      // PLY 没有统一方向元数据；默认按 Z-up 展示，可在查看器中手动纠正。
      sourceUp: 'z',
      orientation: { x: 0, y: 0, z: 0 },
      bounds,
      splats: null,
      triangles: parsed.triangleCount,
      materials: 1,
      textures: 0,
      shDegree: null,
      hasEmissive: false,
    }

    return {
      format: 'mesh-ply',
      object: mesh,
      bounds,
      info,
      glbLook: look,
      splatLook: null,
      dispose: () => {
        for (const entry of look.meshes) entry.mesh.material = entry.original
        look.toneMaterial.dispose()
        disposeObject3D(mesh)
      },
      recomputeBounds: () => boundsFor(mesh),
      setSplatScale: () => undefined,
      setSplatTone: () => undefined,
      setGlbTone: (enabled) => {
        for (const entry of look.meshes) {
          entry.mesh.material = enabled ? look.toneMaterial : entry.original
        }
      },
      setEmissive: () => undefined,
    }
  }

  if (isPly) {
    let parsed: ParsedPly
    try {
      parsed = parsePly(buffer)
    } catch (error) {
      throw error instanceof ViewerError ? error : new ViewerError('PLY_HEADER', undefined, error)
    }
    throwIfAborted()

    options.onPhase('initialize')
    let mesh: SplatMesh | null = null
    try {
      mesh = new SplatMesh({
        fileBytes: buffer,
        fileType: SplatFileType.PLY,
        fileName: options.sourceName,
        raycastable: false,
        editable: false,
      })
      await mesh.initialized
      throwIfAborted()
      const look = makeSplatLook(mesh)
      const bounds = splatBounds(mesh, mesh)
      const info: ModelInfo = {
        format: 'gaussian-ply',
        sourceName: options.sourceName,
        bytes: buffer.byteLength,
        // 由 ModelViewer 在识别格式后按实际内容写入最终方向。
        sourceUp: 'z',
        orientation: { x: 0, y: 0, z: 0 },
        bounds,
        splats: parsed.vertexCount,
        triangles: null,
        materials: null,
        textures: null,
        shDegree: parsed.shDegree,
        hasEmissive: null,
      }
      const localMesh = mesh
      return {
        format: 'gaussian-ply',
        object: localMesh,
        bounds: info.bounds,
        info,
        glbLook: null,
        splatLook: look,
        dispose: () => {
          localMesh.dispose()
          localMesh.removeFromParent()
        },
        recomputeBounds: () => splatBounds(localMesh, localMesh),
        setSplatScale: (value) => {
          look.scaleUniform.value = value
          look.scaleUniform.uniform.value = value
          look.mesh.updateGenerator()
        },
        setSplatTone: (amount) => {
          look.toneAmount.value = amount
          look.toneAmount.uniform.value = amount
          look.mesh.updateGenerator()
        },
        setGlbTone: () => undefined,
        setEmissive: () => undefined,
      }
    } catch (error) {
      mesh?.dispose()
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
      if (error instanceof ViewerError) throw error
      throw new ViewerError('SPARK', error instanceof Error ? error.message : undefined, error)
    }
  }

  parseGlbContainer(buffer)
  throwIfAborted()
  options.onPhase('initialize')

  const loader = new GLTFLoader()
  let gltf: Awaited<ReturnType<GLTFLoader['parseAsync']>>
  try {
    gltf = await loader.parseAsync(buffer, '')
  } catch (error) {
    throw new ViewerError('PARSE', error instanceof Error ? error.message : undefined, error)
  }
  if (signal.aborted) {
    disposeObject3D(gltf.scene)
    throw new DOMException('Aborted', 'AbortError')
  }

  const root = gltf.scene
  let bounds: BoundsInfo
  let look: GlbLook
  let info: ModelInfo
  try {
    if (root.children.length === 0) throw new ViewerError('EMPTY_MODEL')
    bounds = boundsFor(root)
    const { triangles, materials } = countGeometry(root)
    look = createGlbLook(root)
    info = {
      format: 'glb',
      sourceName: options.sourceName,
      bytes: buffer.byteLength,
      // 由 ModelViewer 在识别格式后按实际内容写入最终方向。
      sourceUp: 'z',
      orientation: { x: 0, y: 0, z: 0 },
      bounds,
      splats: null,
      triangles,
      materials: materials.size,
      textures: collectTextures(root),
      shDegree: null,
      hasEmissive: look.hasEmissive,
    }
  } catch (error) {
    disposeObject3D(root)
    if (error instanceof ViewerError) throw error
    throw new ViewerError('PARSE', error instanceof Error ? error.message : undefined, error)
  }

  return {
    format: 'glb',
    object: root,
    bounds,
    info,
    glbLook: look,
    splatLook: null,
    dispose: () => {
      for (const entry of look.meshes) entry.mesh.material = entry.original
      look.toneMaterial.dispose()
      disposeObject3D(root)
    },
    recomputeBounds: () => boundsFor(root),
    setSplatScale: () => undefined,
    setSplatTone: () => undefined,
    setGlbTone: (enabled) => {
      for (const entry of look.meshes) {
        entry.mesh.material = enabled ? look.toneMaterial : entry.original
      }
    },
    setEmissive: (enabled, intensity) => {
      for (const entry of look.emissive) {
        entry.material.emissiveIntensity = enabled ? Math.max(0.1, intensity) : entry.intensity
      }
    },
  }
}
