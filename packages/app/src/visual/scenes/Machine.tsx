import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { sceneAudio } from '../audio'
import { ease, readBands, readLevels } from '../levels'
import { touch } from '../touch'

// A production line seen from close enough to feel its weight.
//
// The set already has landscapes, bodies, boards, journeys and isolated objects. What it
// did not have was a PROCESS: parts visibly causing other parts to move. The kick drives
// the press, the low mids turn the flywheel and interlocked gears, hats run the rollers,
// and stamped billets keep travelling after the hit that made them. The picture therefore
// has the same argument as the techno record written for it — repetition is not stasis
// when every repetition advances the line.
//
// Solid metal under sodium light, deliberately. Another cyan wireframe machine would be
// the old visual language wearing a new subject.

const STEEL = '#393733'
const DARK_STEEL = '#171716'
const EDGE = '#777066'
const HOT = '#ff8a24'
const PAPER = '#c9b9a0'
const WORKPIECES = 8
const ROLLERS = 7
const SPARKS = 42
const BANDS = 6

function makeDetector(rise: number, refractory: number) {
  let fast = 0
  let slow = 0
  let wait = 0
  return (value: number, dt: number): number => {
    fast += (value - fast) * Math.min(1, dt * 30)
    slow += (value - slow) * Math.min(1, dt * 2.1)
    wait -= dt
    if (wait > 0 || fast < 0.065 || fast < slow * rise) return 0
    wait = refractory
    return Math.min(1, fast)
  }
}

function Gear({
  radius,
  teeth,
  colour = STEEL,
}: {
  radius: number
  teeth: number
  colour?: string
}) {
  return (
    <>
      <mesh>
        <torusGeometry args={[radius, radius * 0.18, 8, 32]} />
        <meshStandardMaterial color={colour} roughness={0.72} metalness={0.76} />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[radius * 0.24, radius * 0.24, 0.32, 18]} />
        <meshStandardMaterial color={EDGE} roughness={0.58} metalness={0.82} />
      </mesh>
      {Array.from({ length: teeth }, (_, i) => {
        const angle = (i / teeth) * Math.PI * 2
        return (
          <mesh
            key={i}
            position={[Math.cos(angle) * radius, Math.sin(angle) * radius, 0]}
            rotation={[0, 0, angle]}
          >
            <boxGeometry args={[radius * 0.34, radius * 0.2, 0.38]} />
            <meshStandardMaterial color={colour} roughness={0.72} metalness={0.76} />
          </mesh>
        )
      })}
      {[0, Math.PI / 2].map((angle) => (
        <mesh key={angle} rotation={[0, 0, angle]}>
          <boxGeometry args={[radius * 1.55, radius * 0.12, 0.18]} />
          <meshStandardMaterial color={EDGE} roughness={0.62} metalness={0.82} />
        </mesh>
      ))}
    </>
  )
}

export function Machine() {
  const machine = useRef<THREE.Group>(null)
  const flywheel = useRef<THREE.Group>(null)
  const smallGear = useRef<THREE.Group>(null)
  const largeGear = useRef<THREE.Group>(null)
  const ram = useRef<THREE.Group>(null)
  const rollers = useRef<Array<THREE.Mesh | null>>([])
  const workpieces = useRef<Array<THREE.Mesh | null>>([])
  const inspection = useRef<THREE.PointLight>(null)
  const sparkPoints = useRef<THREE.Points>(null)
  const { camera, size } = useThree()

  const rawBands = useRef(new Float32Array(BANDS))
  const bands = useRef(new Float32Array(BANDS))
  const elapsed = useRef(0)
  const belt = useRef(0)
  const strike = useRef(0)
  const shake = useRef(0)
  const onKick = useMemo(() => makeDetector(1.48, 0.2), [])

  const sparkState = useMemo(
    () => ({
      position: new Float32Array(SPARKS * 3),
      velocity: Array.from({ length: SPARKS }, () => new THREE.Vector3()),
      life: new Float32Array(SPARKS),
      seed: 0x51a7,
    }),
    [],
  )
  const sparkGeometry = useMemo(() => {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(sparkState.position, 3))
    return geometry
  }, [sparkState])

  const random = () => {
    sparkState.seed = (sparkState.seed * 1664525 + 1013904223) >>> 0
    return sparkState.seed / 0x100000000
  }

  useFrame((_, dt) => {
    const levels = readLevels(sceneAudio.analyser)
    readBands(sceneAudio.analyser, rawBands.current)
    elapsed.current += dt
    for (let i = 0; i < BANDS; i++) {
      bands.current[i] = ease(bands.current[i], rawBands.current[i], dt, 5.5)
    }

    const hit = onKick(levels.bass, dt)
    if (hit) {
      strike.current = 1
      shake.current = Math.max(shake.current, hit)
      for (let i = 0; i < SPARKS; i++) {
        sparkState.position[i * 3] = 1.58 + (random() - 0.5) * 0.45
        sparkState.position[i * 3 + 1] = 0.72 + random() * 0.28
        sparkState.position[i * 3 + 2] = 0.78 + (random() - 0.5) * 0.26
        sparkState.velocity[i].set(
          (random() - 0.58) * 3.4,
          1.2 + random() * 3.2,
          (random() - 0.5) * 2.4,
        )
        sparkState.life[i] = 0.18 + random() * 0.34
      }
    }

    strike.current = Math.max(0, strike.current - dt * 5.8)
    shake.current = Math.max(0, shake.current - dt * 7)
    const speed = 0.55 + bands.current[4] * 2.5 + levels.high * 1.4
    belt.current += dt * speed

    if (flywheel.current) flywheel.current.rotation.z -= dt * (1.2 + bands.current[1] * 6)
    if (smallGear.current) smallGear.current.rotation.z += dt * (1.8 + bands.current[2] * 7)
    if (largeGear.current) largeGear.current.rotation.z -= dt * (1.1 + bands.current[2] * 4.4)
    for (const roller of rollers.current) {
      if (roller) roller.rotation.z -= dt * speed * 2.4
    }
    for (let i = 0; i < workpieces.current.length; i++) {
      const piece = workpieces.current[i]
      if (!piece) continue
      const lane = ((i * 1.45 + belt.current) % 11.6) - 5.8
      piece.position.x = lane
      const underPress = Math.max(0, 1 - Math.abs(lane - 1.55) * 3)
      piece.scale.y = 0.72 - underPress * strike.current * 0.26
      const material = piece.material as THREE.MeshStandardMaterial
      material.emissiveIntensity = underPress * strike.current * 1.8
    }
    if (ram.current) {
      // A cam-like stroke: fast down on the onset, slower return.
      ram.current.position.y = 2.74 - Math.sin(strike.current * Math.PI) * 1.34
    }

    const positions = sparkState.position
    for (let i = 0; i < SPARKS; i++) {
      if (sparkState.life[i] <= 0) {
        positions[i * 3 + 1] = -20
        continue
      }
      sparkState.life[i] -= dt
      sparkState.velocity[i].y -= dt * 5.5
      positions[i * 3] += sparkState.velocity[i].x * dt
      positions[i * 3 + 1] += sparkState.velocity[i].y * dt
      positions[i * 3 + 2] += sparkState.velocity[i].z * dt
    }
    sparkGeometry.attributes.position.needsUpdate = true
    if (sparkPoints.current) {
      ;(sparkPoints.current.material as THREE.PointsMaterial).opacity =
        Math.min(1, strike.current * 2.2)
    }

    if (inspection.current) {
      inspection.current.position.x = (touch.x - 0.5) * 7
      inspection.current.position.y = 2.8 + touch.y * 2.4
      inspection.current.intensity = 24 + touch.energy * 42 + levels.high * 12
    }
    if (machine.current) {
      machine.current.rotation.y +=
        ((touch.x - 0.5) * touch.energy * 0.16 - machine.current.rotation.y) *
        Math.min(1, dt * 2.5)
    }

    const narrow = size.width / Math.max(1, size.height) < 0.85
    // Portrait is a detail shot, not the desktop view moved backwards until all twelve
    // metres of belt fit. The latter technically frames the subject and turns it into a
    // model on a shelf. Crop the ends and keep the press and drive train large.
    const targetX = narrow ? 6.4 : 8.6
    const targetY = narrow ? 5.1 : 5.5
    const targetZ = narrow ? 8.2 : 10.5
    const jitter = shake.current * 0.055
    camera.position.x += (targetX + (touch.x - 0.5) * touch.energy * 1.8 - camera.position.x) * Math.min(1, dt * 2)
    camera.position.y += (targetY + (touch.y - 0.5) * touch.energy * 1.2 - camera.position.y) * Math.min(1, dt * 2)
    camera.position.z += (targetZ - camera.position.z) * Math.min(1, dt * 2)
    camera.position.x += Math.sin(elapsed.current * 83) * jitter
    camera.position.y += Math.cos(elapsed.current * 71) * jitter
    camera.lookAt(0.2, 1.35, 0)
    if (camera instanceof THREE.PerspectiveCamera) {
      camera.fov = narrow ? 48 : 44
      camera.far = 70
      camera.updateProjectionMatrix()
    }
  })

  return (
    <>
      <color attach="background" args={['#100e0b']} />
      <fog attach="fog" args={['#100e0b', 14, 31]} />
      <ambientLight intensity={0.42} color="#9c9181" />
      <directionalLight position={[4, 9, 7]} intensity={2.8} color="#e1ceb1" />
      <pointLight ref={inspection} position={[0, 5, 3]} intensity={34} distance={12} color={HOT} />

      <group ref={machine}>
        <mesh position={[0, -0.48, 0]} receiveShadow>
          <boxGeometry args={[16, 0.5, 8]} />
          <meshStandardMaterial color="#12110f" roughness={0.88} metalness={0.24} />
        </mesh>

        {/* The belt runs across the frame. Rollers remain visible below it, so motion has
            a source rather than workpieces mysteriously sliding over a slab. */}
        <mesh position={[0, 0.2, 0]}>
          <boxGeometry args={[12.6, 0.18, 2.15]} />
          <meshStandardMaterial color={DARK_STEEL} roughness={0.82} metalness={0.52} />
        </mesh>
        {[-1.14, 1.14].map((z) => (
          <mesh key={z} position={[0, 0.42, z]}>
            <boxGeometry args={[12.9, 0.18, 0.13]} />
            <meshStandardMaterial color={EDGE} roughness={0.58} metalness={0.78} />
          </mesh>
        ))}
        {Array.from({ length: ROLLERS }, (_, i) => (
          <mesh
            key={i}
            ref={(node) => {
              rollers.current[i] = node
            }}
            position={[-5.2 + i * 1.74, 0.05, 0]}
            rotation={[Math.PI / 2, 0, 0]}
          >
            <cylinderGeometry args={[0.32, 0.32, 2.35, 16]} />
            <meshStandardMaterial color={STEEL} roughness={0.68} metalness={0.78} />
          </mesh>
        ))}
        {Array.from({ length: WORKPIECES }, (_, i) => (
          <mesh
            key={i}
            ref={(node) => {
              workpieces.current[i] = node
            }}
            position={[-5.8 + i * 1.45, 0.58, 0]}
          >
            <boxGeometry args={[0.78, 0.48, 1.28]} />
            <meshStandardMaterial
              color={PAPER}
              emissive={HOT}
              emissiveIntensity={0}
              roughness={0.48}
              metalness={0.66}
            />
          </mesh>
        ))}

        {/* Press frame and descending ram. */}
        {[-0.05, 3.2].map((x) => (
          <mesh key={x} position={[x, 2.25, 0]}>
            <boxGeometry args={[0.42, 4.35, 2.75]} />
            <meshStandardMaterial color={STEEL} roughness={0.74} metalness={0.7} />
          </mesh>
        ))}
        <mesh position={[1.58, 4.28, 0]}>
          <boxGeometry args={[3.7, 0.6, 2.9]} />
          <meshStandardMaterial color={STEEL} roughness={0.72} metalness={0.72} />
        </mesh>
        <group ref={ram} position={[1.58, 2.74, 0]}>
          <mesh>
            <boxGeometry args={[1.22, 2.55, 1.62]} />
            <meshStandardMaterial color="#4a4741" roughness={0.62} metalness={0.8} />
          </mesh>
          <mesh position={[0, -1.38, 0]}>
            <boxGeometry args={[1.72, 0.28, 1.9]} />
            <meshStandardMaterial color={EDGE} roughness={0.54} metalness={0.84} />
          </mesh>
        </group>

        {/* An exposed drive train on the left: unlike decoration, every wheel turns at a
            related speed and direction, so it reads as one mechanism. */}
        <group ref={flywheel} position={[-3.35, 2.55, 0.72]}>
          <Gear radius={1.38} teeth={16} colour="#49453e" />
        </group>
        <group ref={smallGear} position={[-1.36, 2.02, 0.76]}>
          <Gear radius={0.63} teeth={10} colour="#696158" />
        </group>
        <group ref={largeGear} position={[-0.55, 3.15, 0.72]}>
          <Gear radius={0.9} teeth={12} colour="#34322f" />
        </group>
        <mesh position={[-3.35, 2.55, 0.08]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.18, 0.18, 2.2, 14]} />
          <meshStandardMaterial color={EDGE} roughness={0.54} metalness={0.86} />
        </mesh>

        <points ref={sparkPoints} geometry={sparkGeometry} frustumCulled={false}>
          <pointsMaterial
            color="#ffb14a"
            size={0.075}
            sizeAttenuation
            transparent
            opacity={0}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </points>
      </group>
    </>
  )
}
