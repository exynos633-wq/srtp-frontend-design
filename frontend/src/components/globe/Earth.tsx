import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useLoader, useThree } from '@react-three/fiber'
import {
  AdditiveBlending,
  BackSide,
  BufferGeometry,
  Color,
  SRGBColorSpace,
  ShaderMaterial,
  TextureLoader,
  Vector3,
  type DirectionalLight,
} from 'three'
import earthTextureUrl from '../../assets/earth-demo.png'
import { ATMOSPHERE_SCALE, latLonToVector3 } from '../../lib/globeMath'

const ATMO = '#54C8C1'
const GRID = '#395962'

/**
 * 演示地球：低对比陆地纹理 + 局部经纬弧 + 冷青边缘光。
 * 纹理来自公共领域 Natural Earth 数据的重绘，见 src/assets/README.md。
 */
export function Earth() {
  const source = useLoader(TextureLoader, earthTextureUrl)
  const texture = useMemo(() => {
    const next = source.clone()
    next.colorSpace = SRGBColorSpace
    next.anisotropy = 4
    next.needsUpdate = true
    return next
  }, [source])

  useEffect(() => () => texture.dispose(), [texture])

  return (
    <group>
      <ambientLight intensity={0.42} />
      <FollowLight />
      <mesh>
        <sphereGeometry args={[1, 96, 64]} />
        <meshStandardMaterial map={texture} roughness={0.92} metalness={0.04} />
      </mesh>
      <Graticule />
      <Atmosphere />
    </group>
  )
}

/** 主光跟随相机，旋转到任何经度时可见面都有稳定明暗。 */
function FollowLight() {
  const light = useRef<DirectionalLight>(null)
  const camera = useThree((state) => state.camera)

  useFrame(() => {
    if (!light.current) return
    light.current.position.copy(camera.position).multiplyScalar(1.25)
    light.current.position.y += 3.2
    light.current.position.x -= 2
  })

  return <directionalLight ref={light} intensity={2.8} color="#f2e7d3" />
}

function Atmosphere() {
  const material = useMemo(() => {
    return new ShaderMaterial({
      uniforms: {
        uColor: { value: new Color(ATMO) },
      },
      vertexShader: `
        varying vec3 vViewNormal;
        void main() {
          vViewNormal = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        varying vec3 vViewNormal;
        void main() {
          float rim = pow(1.0 - abs(vViewNormal.z), 3.0);
          gl_FragColor = vec4(uColor, rim * 0.26);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: BackSide,
      toneMapped: false,
    })
  }, [])

  useEffect(() => () => material.dispose(), [material])

  return (
    <mesh scale={ATMOSPHERE_SCALE}>
      <sphereGeometry args={[1, 64, 48]} />
      <primitive object={material} attach="material" />
    </mesh>
  )
}

/** 只在东亚附近画少量经线/纬线，避免整颗球变成网格球。 */
function Graticule() {
  const geometry = useMemo(() => {
    const points: Vector3[] = []
    const pushSegment = (
      lat1: number,
      lon1: number,
      lat2: number,
      lon2: number,
    ) => {
      points.push(
        latLonToVector3(lat1, lon1, 1.003),
        latLonToVector3(lat2, lon2, 1.003),
      )
    }

    for (const latitude of [20, 40]) {
      for (let longitude = 60; longitude < 150; longitude += 2) {
        pushSegment(latitude, longitude, latitude, longitude + 2)
      }
    }
    for (const longitude of [75, 105, 135]) {
      for (let latitude = -10; latitude < 60; latitude += 2) {
        pushSegment(latitude, longitude, latitude + 2, longitude)
      }
    }

    return new BufferGeometry().setFromPoints(points)
  }, [])

  useEffect(() => () => geometry.dispose(), [geometry])

  return (
    <lineSegments geometry={geometry} renderOrder={1}>
      <lineBasicMaterial
        color={GRID}
        transparent
        opacity={0.28}
        depthWrite={false}
      />
    </lineSegments>
  )
}
