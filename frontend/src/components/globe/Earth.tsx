import { useEffect, useMemo, useRef, type RefObject } from 'react'
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
  type Mesh,
  type Texture,
} from 'three'
import earthDesktopUrl from '../../assets/earth-color.webp'
import earthMobileUrl from '../../assets/earth-color-mobile.webp'
import earthCloudsUrl from '../../assets/earth-clouds.webp'
import { ATMOSPHERE_SCALE, latLonToVector3 } from '../../lib/globeMath'

const ATMO = '#85bde5'
const GRID = '#395962'
// Slightly exaggerate cloud altitude so the separation reads at homepage scale.
const CLOUD_RADIUS = 1.022

/**
 * 彩色地球：NASA Blue Marble 纹理 + 局部经纬弧 + 冷青边缘光。
 * 纹理来源与使用说明见 src/assets/README.md。
 */
export function Earth({ reducedMotion }: { reducedMotion: boolean }) {
  const cloudRef = useRef<Mesh>(null)
  const earthTextureUrl = window.matchMedia('(max-width: 767px)').matches ? earthMobileUrl : earthDesktopUrl
  const [source, clouds] = useLoader(TextureLoader, [earthTextureUrl, earthCloudsUrl])
  const sunDirection = useMemo(() => new Vector3(), [])
  const texture = useMemo(() => {
    const next = source.clone()
    next.colorSpace = SRGBColorSpace
    next.anisotropy = 4
    next.needsUpdate = true
    return next
  }, [source])

  useEffect(() => () => texture.dispose(), [texture])

  useFrame((_, delta) => {
    if (!reducedMotion && cloudRef.current) {
      cloudRef.current.rotation.y = (cloudRef.current.rotation.y + Math.min(delta, 0.1) * 0.003) % (Math.PI * 2)
    }
  })

  return (
    <group>
      <ambientLight intensity={0.5} />
      <FollowLight sunDirection={sunDirection} />
      <mesh onAfterRender={(renderer) => { renderer.domElement.setAttribute('data-earth-ready', 'true') }}>
        <sphereGeometry args={[1, 96, 64]} />
        <meshStandardMaterial map={texture} roughness={0.92} metalness={0.04} />
      </mesh>
      <CloudShadow clouds={clouds} sunDirection={sunDirection} cloudRef={cloudRef} />
      <mesh ref={cloudRef} scale={CLOUD_RADIUS}>
        <sphereGeometry args={[1, 128, 64]} />
        <meshStandardMaterial color="#ffffff" alphaMap={clouds} displacementMap={clouds} displacementScale={0.006} bumpMap={clouds} bumpScale={0.018} transparent opacity={0.9} depthWrite={false} roughness={1} />
      </mesh>
      <Graticule />
      <Atmosphere />
    </group>
  )
}

/** 主光跟随相机，旋转到任何经度时可见面都有稳定明暗。 */
function FollowLight({ sunDirection }: { sunDirection: Vector3 }) {
  const light = useRef<DirectionalLight>(null)
  const camera = useThree((state) => state.camera)
  const right = useMemo(() => new Vector3(), [])

  useFrame(() => {
    if (!light.current) return
    right.setFromMatrixColumn(camera.matrixWorld, 0)
    light.current.position.copy(camera.position).normalize().multiplyScalar(3)
    light.current.position.addScaledVector(right, 2.8)
    light.current.position.y += 2
    sunDirection.copy(light.current.position).normalize()
  })

  return <directionalLight ref={light} intensity={3} color="#fff3df" />
}

/** Project the cloud mask toward the sun, onto a shell just above the ground. */
function CloudShadow({ clouds, sunDirection, cloudRef }: { clouds: Texture; sunDirection: Vector3; cloudRef: RefObject<Mesh | null> }) {
  const materialRef = useRef<ShaderMaterial>(null)
  const material = useMemo(() => new ShaderMaterial({
    uniforms: {
      uClouds: { value: clouds },
      uSunDirection: { value: sunDirection },
      uCloudRadius: { value: CLOUD_RADIUS + 0.003 },
      uCloudRotation: { value: 0 },
    },
    vertexShader: `
      varying vec3 vSurface;
      void main() {
        vSurface = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D uClouds;
      uniform vec3 uSunDirection;
      uniform float uCloudRadius;
      uniform float uCloudRotation;
      varying vec3 vSurface;
      void main() {
        vec3 surface = normalize(vSurface);
        float sunAngle = dot(surface, uSunDirection);
        float distanceToCloud = -sunAngle + sqrt(sunAngle * sunAngle + uCloudRadius * uCloudRadius - 1.0);
        vec3 cloudPoint = normalize(surface + uSunDirection * distanceToCloud);
        vec2 cloudUv = vec2(0.5 - atan(cloudPoint.z, cloudPoint.x) / 6.2831853, 0.5 + asin(cloudPoint.y) / 3.1415927);
        cloudUv.x = fract(cloudUv.x + uCloudRotation / 6.2831853);
        float density = texture2D(uClouds, cloudUv).g;
        float daylight = smoothstep(0.0, 0.25, sunAngle);
        gl_FragColor = vec4(0.015, 0.025, 0.04, density * daylight * 0.32);
      }
    `,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  }), [clouds, sunDirection])

  useEffect(() => () => material.dispose(), [material])

  useFrame(() => {
    if (materialRef.current) materialRef.current.uniforms.uCloudRotation.value = cloudRef.current?.rotation.y ?? 0
  })

  return (
    <mesh scale={1.001}>
      <sphereGeometry args={[1, 96, 64]} />
      <primitive ref={materialRef} object={material} attach="material" />
    </mesh>
  )
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
          float rim = pow(1.0 - abs(vViewNormal.z), 2.5);
          gl_FragColor = vec4(uColor, rim * smoothstep(0.0, 0.35, abs(vViewNormal.z)) * 0.48);
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
        opacity={0.12}
        depthWrite={false}
      />
    </lineSegments>
  )
}
