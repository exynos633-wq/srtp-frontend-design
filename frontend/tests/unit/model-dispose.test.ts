import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { disposeObject3D } from '../../src/viewer/loadModel'

class FakeImageBitmap {
  static closeCount = 0
  close() {
    FakeImageBitmap.closeCount += 1
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  FakeImageBitmap.closeCount = 0
})

describe('模型释放与无效边界', () => {
  it('共享 ImageBitmap 只 close 一次，几何/材质/贴图都释放', () => {
    vi.stubGlobal('ImageBitmap', FakeImageBitmap)
    const bitmap = new FakeImageBitmap() as unknown as ImageBitmap
    const firstTexture = new THREE.Texture(bitmap as unknown as TexImageSource)
    const secondTexture = new THREE.Texture(bitmap as unknown as TexImageSource)
    const firstGeometry = new THREE.BoxGeometry()
    const secondGeometry = new THREE.BoxGeometry()
    const firstMaterial = new THREE.MeshBasicMaterial({ map: firstTexture })
    const secondMaterial = new THREE.MeshBasicMaterial({ map: secondTexture })
    const root = new THREE.Group()
    root.add(new THREE.Mesh(firstGeometry, firstMaterial), new THREE.Mesh(secondGeometry, secondMaterial))

    const geometryDispose = vi.spyOn(firstGeometry, 'dispose')
    const materialDispose = vi.spyOn(firstMaterial, 'dispose')
    const textureDispose = vi.spyOn(firstTexture, 'dispose')

    disposeObject3D(root)

    expect(FakeImageBitmap.closeCount).toBe(1)
    expect(geometryDispose).toHaveBeenCalledTimes(1)
    expect(materialDispose).toHaveBeenCalledTimes(1)
    expect(textureDispose).toHaveBeenCalledTimes(1)
    expect(root.parent).toBeNull()
  })
})
