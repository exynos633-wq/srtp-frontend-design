import { describe, expect, it } from 'vitest'
import { canControlEmission } from '../../src/viewer/emission'

describe('发光控件与统一色调', () => {
  it('只有原材质有发光且未使用统一色调时可操作', () => {
    expect(canControlEmission(true, false)).toBe(true)
    expect(canControlEmission(true, true)).toBe(false)
    expect(canControlEmission(false, false)).toBe(false)
    expect(canControlEmission(null, false)).toBe(false)
  })
})
