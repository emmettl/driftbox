import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { sceneAudio } from '../audio'
import { ease, readLevels } from '../levels'
import { touch } from '../touch'
import { fitDistance } from '../fit'

// Endless Convoy.
//
// Side-on like an early cabinet game, but not pixel art and not a battle. A procession of
// heavy machines crosses a road that never arrives anywhere, carrying increasingly absurd
// cargo: a tank, a house, a tree and — at the back — smaller copies of itself. The image is
// solid low-poly silhouettes with bright vector edges, rather than another room made only
// of glowing lines.
//
// The convoy does not scroll. It holds its ground while the road and dust run under it,
// because the song's whole character is obstinacy: the same phrase continuing while the
// world changes around it. Bass compresses each vehicle's suspension in sequence, highs
// throw dust, and a touch tilts the road into an impossible incline while the Kaoss filter
// makes the motor audibly labour.

interface VehicleGeometry {
  fill: THREE.ShapeGeometry
  body: THREE.BufferGeometry
  cargo: THREE.BufferGeometry
}

type Point = readonly [number, number]

function vehicleGeometry(kind: number): VehicleGeometry {
  const shapes: THREE.Shape[] = []
  const body: number[] = []
  const cargo: number[] = []

  const shape = (points: Point[]) => {
    const out = new THREE.Shape()
    out.moveTo(points[0][0], points[0][1])
    for (let i = 1; i < points.length; i++) out.lineTo(points[i][0], points[i][1])
    out.closePath()
    shapes.push(out)
  }
  const line = (out: number[], a: Point, b: Point) => out.push(a[0], a[1], 0, b[0], b[1], 0)
  const poly = (out: number[], points: Point[], closed = true) => {
    for (let i = 0; i < points.length - 1; i++) line(out, points[i], points[i + 1])
    if (closed) line(out, points[points.length - 1], points[0])
  }
  const circle = (out: number[], cx: number, cy: number, radius: number, segments = 18) => {
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2
      const b = ((i + 1) / segments) * Math.PI * 2
      line(out, [cx + Math.cos(a) * radius, cy + Math.sin(a) * radius], [cx + Math.cos(b) * radius, cy + Math.sin(b) * radius])
    }
  }

  const track: Point[] = [
    [-2.5, 0.15],
    [-2.15, -0.35],
    [1.95, -0.35],
    [2.5, 0.15],
    [2.1, 0.75],
    [-2.05, 0.75],
  ]
  const hull: Point[] = [
    [-2.2, 0.78],
    [-1.7, 1.55],
    [1.7, 1.55],
    [2.15, 0.78],
  ]
  shape(track)
  shape(hull)
  poly(body, track)
  poly(body, hull)

  for (const x of [-1.55, -0.52, 0.52, 1.55]) {
    const wheel = new THREE.Shape()
    wheel.absarc(x, 0.2, 0.42, 0, Math.PI * 2)
    shapes.push(wheel)
    circle(body, x, 0.2, 0.42)
    circle(body, x, 0.2, 0.13, 10)
    line(body, [x - 0.32, -0.04], [x + 0.32, 0.44])
    line(body, [x - 0.32, 0.44], [x + 0.32, -0.04])
  }

  if (kind === 0) {
    const turret: Point[] = [
      [-1.0, 1.58],
      [-0.62, 2.18],
      [0.8, 2.18],
      [1.25, 1.58],
    ]
    shape(turret)
    poly(body, turret)
    line(body, [0.55, 2.18], [3.1, 2.78])
    line(body, [0.62, 2.03], [3.14, 2.63])
    line(body, [3.1, 2.78], [3.14, 2.63])
  } else if (kind === 1) {
    // A small house on the flatbed. It is literal enough to read at phone size and absurd
    // enough to say this convoy is transporting a life, not ammunition.
    const house: Point[] = [
      [-1.2, 1.58],
      [-1.2, 3.1],
      [0, 4.05],
      [1.25, 3.1],
      [1.25, 1.58],
    ]
    poly(cargo, house)
    poly(cargo, [
      [-0.55, 1.58],
      [-0.55, 2.45],
      [0.15, 2.45],
      [0.15, 1.58],
    ])
    poly(cargo, [
      [0.45, 2.7],
      [0.45, 3.2],
      [0.9, 3.2],
      [0.9, 2.7],
    ])
  } else if (kind === 2) {
    // A tree, balanced upright despite whatever angle the road is pulled onto.
    line(cargo, [-0.05, 1.55], [-0.05, 4.0])
    line(cargo, [0.1, 1.55], [0.1, 4.0])
    for (const [x, y, r] of [
      [-0.85, 3.85, 0.78],
      [0.0, 4.45, 0.92],
      [0.9, 3.85, 0.74],
    ] as const) {
      circle(cargo, x, y, r, 12)
    }
  } else if (kind === 3) {
    // A cylindrical machine or sleeper — kept deliberately unresolved. The eye can read
    // it as a generator, an animal or a person in a capsule, which is more useful than a
    // tiny label explaining the joke.
    poly(cargo, [
      [-1.55, 1.65],
      [-1.2, 3.25],
      [1.2, 3.25],
      [1.55, 1.65],
    ])
    circle(cargo, -1.18, 2.44, 0.8, 14)
    circle(cargo, 1.18, 2.44, 0.8, 14)
    line(cargo, [-0.65, 2.3], [0.7, 2.3])
  } else {
    // The Boss Machine thought folded into the convoy: one carrier stacked with smaller
    // versions of itself. At a glance it is cargo; on inspection it is recursion.
    for (let row = 0; row < 3; row++) {
      const scale = 0.58 - row * 0.11
      const y = 1.7 + row * 0.82
      const x = row * 0.15
      poly(cargo, [
        [x - 1.8 * scale, y],
        [x - 1.4 * scale, y + 0.55 * scale],
        [x + 1.4 * scale, y + 0.55 * scale],
        [x + 1.8 * scale, y],
      ])
      circle(cargo, x - 0.85 * scale, y, 0.28 * scale, 9)
      circle(cargo, x + 0.85 * scale, y, 0.28 * scale, 9)
      line(cargo, [x, y + 0.55 * scale], [x + 1.6 * scale, y + 1.05 * scale])
    }
  }

  const bodyGeometry = new THREE.BufferGeometry()
  bodyGeometry.setAttribute('position', new THREE.Float32BufferAttribute(body, 3))
  const cargoGeometry = new THREE.BufferGeometry()
  cargoGeometry.setAttribute('position', new THREE.Float32BufferAttribute(cargo, 3))
  return { fill: new THREE.ShapeGeometry(shapes), body: bodyGeometry, cargo: cargoGeometry }
}

const ROAD_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const ROAD_FRAGMENT = /* glsl */ `
  precision highp float;
  uniform float uTime;
  uniform float uBass;
  uniform float uHigh;
  varying vec2 vUv;

  void main() {
    vec3 ground = vec3(0.035, 0.075, 0.09);
    vec3 lineColour = vec3(0.13, 0.72, 0.68);

    // Uneven spacing compresses toward the horizon, giving the flat side view just enough
    // depth to feel like a cabinet landscape rather than a diagram.
    float depth = pow(vUv.y, 1.65);
    float horizontal = 1.0 - smoothstep(0.035, 0.09, abs(fract(depth * 8.0) - 0.5));
    float scroll = vUv.x * 22.0 + uTime * (1.7 + uBass * 2.2);
    float vertical = 1.0 - smoothstep(0.035, 0.085, abs(fract(scroll) - 0.5));
    float grid = max(horizontal * 0.6, vertical * (0.25 + depth * 0.7));

    vec3 colour = ground + lineColour * grid * (0.34 + uHigh * 0.75);
    gl_FragColor = vec4(colour, 1.0);
  }
`

const DUST_VERTEX = /* glsl */ `
  uniform float uTime;
  uniform float uHigh;
  attribute float aSpeed;
  varying float vLife;

  void main() {
    vec3 pos = position;
    float travel = uTime * (2.0 + aSpeed * 4.0);
    pos.x = mod(pos.x - travel + 22.0, 44.0) - 22.0;
    pos.y += sin(pos.x * 1.7 + aSpeed * 12.0) * 0.12;
    vLife = 0.25 + uHigh * 0.75;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
    gl_PointSize = 1.0 + uHigh * 3.5;
  }
`

const DUST_FRAGMENT = /* glsl */ `
  precision highp float;
  varying float vLife;
  void main() {
    vec2 p = gl_PointCoord - 0.5;
    if (dot(p, p) > 0.25) discard;
    gl_FragColor = vec4(0.95, 0.72, 0.36, vLife);
  }
`

function useDust() {
  return useMemo(() => {
    const random = (() => {
      let seed = 7319
      return () => {
        seed = (seed * 1664525 + 1013904223) % 4294967296
        return seed / 4294967296
      }
    })()
    const positions = new Float32Array(150 * 3)
    const speeds = new Float32Array(150)
    for (let i = 0; i < 150; i++) {
      positions[i * 3] = (random() - 0.5) * 44
      positions[i * 3 + 1] = 0.45 + Math.pow(random(), 2) * 2.4
      positions[i * 3 + 2] = 0.1
      speeds[i] = random()
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1))
    return geometry
  }, [])
}

export function Convoy() {
  const vehicles = useMemo(() => Array.from({ length: 5 }, (_, kind) => vehicleGeometry(kind)), [])
  const vehicleRefs = useRef<Array<THREE.Group | null>>([])
  const convoy = useRef<THREE.Group>(null)
  const road = useRef<THREE.Group>(null)
  const roadMaterial = useRef<THREE.ShaderMaterial>(null)
  const dustMaterial = useRef<THREE.ShaderMaterial>(null)
  const dust = useDust()
  const { camera, size } = useThree()
  const elapsed = useRef(0)
  const bass = useRef(0)
  const high = useRef(0)

  const roadUniforms = useMemo(() => ({ uTime: { value: 0 }, uBass: { value: 0 }, uHigh: { value: 0 } }), [])
  const dustUniforms = useMemo(() => ({ uTime: { value: 0 }, uHigh: { value: 0 } }), [])

  useFrame((_, dt) => {
    const levels = readLevels(sceneAudio.analyser)
    bass.current = ease(bass.current, levels.bass, dt, 3.6)
    high.current = ease(high.current, levels.high, dt, 5.2)
    if (sceneAudio.running) elapsed.current += dt * (0.75 + bass.current * 1.2)

    if (roadMaterial.current) {
      roadMaterial.current.uniforms.uTime.value = elapsed.current
      roadMaterial.current.uniforms.uBass.value = bass.current
      roadMaterial.current.uniforms.uHigh.value = high.current
    }
    if (dustMaterial.current) {
      dustMaterial.current.uniforms.uTime.value = elapsed.current
      dustMaterial.current.uniforms.uHigh.value = high.current
    }

    const slope = (touch.y - 0.5) * touch.energy * 0.32
    if (road.current) road.current.rotation.z += (slope - road.current.rotation.z) * Math.min(1, dt * 3.4)
    if (convoy.current) {
      convoy.current.rotation.z += (slope - convoy.current.rotation.z) * Math.min(1, dt * 3.4)
      // Compress the lineup in portrait, but still crop its ends rather than backing far
      // enough to show every vehicle. A convoy continuing past both edges reads as larger;
      // five complete tiny tanks in the middle of a phone read as a diagram.
      const targetScale = size.width / size.height < 0.72 ? 0.5 : 1
      convoy.current.scale.x += (targetScale - convoy.current.scale.x) * Math.min(1, dt * 5)
    }
    for (let i = 0; i < vehicleRefs.current.length; i++) {
      const vehicle = vehicleRefs.current[i]
      if (!vehicle) continue
      const tread = Math.sin(elapsed.current * 9.5 - i * 1.35)
      vehicle.position.y = 0.8 + tread * (0.025 + bass.current * 0.16)
      vehicle.rotation.z = tread * bass.current * 0.018
    }

    if (camera instanceof THREE.PerspectiveCamera) {
      camera.fov = 42
      camera.far = 120
      camera.aspect = size.width / size.height
      const portrait = size.width / size.height < 0.72
      // Landscape frames the whole column. Portrait deliberately frames its middle three
      // carriers; touch can pan toward the head or tail, and the road proves it continues.
      const distance = fitDistance(camera, portrait ? 4.4 : 17, portrait ? 6.2 : 7.6, 0.9)
      const targetX = (touch.x - 0.5) * touch.energy * 3
      const targetY = (portrait ? 2.8 : 4.35) + (touch.y - 0.5) * touch.energy * 1.4
      camera.position.x += (targetX - camera.position.x) * Math.min(1, dt * 2.4)
      camera.position.y += (targetY - camera.position.y) * Math.min(1, dt * 2.4)
      camera.position.z += (distance - camera.position.z) * Math.min(1, dt * 3.2)
      camera.lookAt(targetX * 0.2, portrait ? 2.1 : 3.35, 0)
      camera.updateProjectionMatrix()
    }
  })

  const positions = [-13.2, -6.6, 0, 6.6, 13.2]
  const scales = [1.12, 0.92, 1, 0.88, 0.82]

  return (
    <>
      <color attach="background" args={['#071017']} />

      <group ref={road}>
        <mesh position={[0, -1.85, -2]}>
          <planeGeometry args={[72, 7]} />
          <shaderMaterial ref={roadMaterial} uniforms={roadUniforms} vertexShader={ROAD_VERTEX} fragmentShader={ROAD_FRAGMENT} />
        </mesh>
        <lineSegments position={[0, 0.48, -0.5]}>
          <bufferGeometry>
            <bufferAttribute
              attach="attributes-position"
              args={[
                new Float32Array([
                  -40, 0, 0, 40, 0, 0,
                  -40, 0.12, 0, 40, 0.12, 0,
                ]),
                3,
              ]}
            />
          </bufferGeometry>
          <lineBasicMaterial color="#4be0cf" transparent opacity={0.75} />
        </lineSegments>
      </group>

      <mesh position={[-10.5, 8.4, -4]}>
        <circleGeometry args={[4.8, 48]} />
        <meshBasicMaterial color="#b84936" transparent opacity={0.72} />
      </mesh>

      <lineSegments position={[0, 0, -3]}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[
              new Float32Array([
                -38, 4.4, 0, -31, 8.2, 0, -31, 8.2, 0, -25, 5.2, 0,
                -25, 5.2, 0, -18, 9.4, 0, -18, 9.4, 0, -9, 4.7, 0,
                -9, 4.7, 0, -2, 7.4, 0, -2, 7.4, 0, 7, 4.5, 0,
                7, 4.5, 0, 15, 8.8, 0, 15, 8.8, 0, 23, 5.1, 0,
                23, 5.1, 0, 31, 7.2, 0, 31, 7.2, 0, 39, 4.6, 0,
              ]),
              3,
            ]}
          />
        </bufferGeometry>
        <lineBasicMaterial color="#214f5a" transparent opacity={0.7} />
      </lineSegments>

      <group ref={convoy}>
        {vehicles.map((geometry, i) => (
          <group
            key={i}
            ref={(node) => {
              vehicleRefs.current[i] = node
            }}
            position={[positions[i], 0.8, 0]}
            scale={scales[i]}
          >
            <mesh geometry={geometry.fill} position={[0, 0, -0.08]}>
              <meshBasicMaterial color="#102b32" />
            </mesh>
            <lineSegments geometry={geometry.body}>
              <lineBasicMaterial color="#72f0d8" />
            </lineSegments>
            <lineSegments geometry={geometry.cargo}>
              <lineBasicMaterial color="#ffb04a" />
            </lineSegments>
          </group>
        ))}
      </group>

      <points geometry={dust} position={[0, 0, 0.4]}>
        <shaderMaterial
          ref={dustMaterial}
          uniforms={dustUniforms}
          vertexShader={DUST_VERTEX}
          fragmentShader={DUST_FRAGMENT}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </points>
    </>
  )
}
