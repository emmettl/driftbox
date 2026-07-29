import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useBox } from '../../store'
import { readLevels } from '../levels'
import { touch } from '../touch'
import { fitDistance } from '../fit'
import { uniformsOf } from '../uniforms'

// Wireframe dancers.
//
// The first scene with a FIGURE in it. Everything else here is a place, a body or a board;
// this is people, and people are the one subject where the eye knows immediately whether
// you got it right — a tunnel can be any width and nobody argues, but a forearm that is
// too long reads as wrong before you have worked out why.
//
// So the interesting problem is not drawing them, it is moving them. Nothing here is
// keyframed. Every joint is a few sinusoids of the beat phase with a per-dancer offset,
// which is cheap and, more importantly, means they are dancing to the actual transport
// rather than to a loop that happens to be running alongside it. Miss a beat and they wait.
//
// They watch the cursor. A dancer turns to face wherever your finger is and reaches toward
// it when it comes close, so a drag across the floor pulls the room round with it. That is
// the whole interaction and it is worth more than any amount of extra articulation.

const DANCERS = 5
/** Points around the head ring. Eight is enough to read as a head and few enough to stay
 *  angular, which is the same call the Rez corridor makes about its ribs. */
const HEAD_POINTS = 8
const BEAMS = 4

const FIGURE_VERTEX = /* glsl */ `
  attribute vec3 aColour;
  attribute float aGlow;
  varying vec3 vColour;
  varying float vGlow;
  void main() {
    vColour = aColour;
    vGlow = aGlow;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const FIGURE_FRAGMENT = /* glsl */ `
  precision highp float;
  uniform float uBass;
  varying vec3 vColour;
  varying float vGlow;
  void main() {
    gl_FragColor = vec4(vColour * (0.8 + vGlow * 1.6 + uBass * 0.5), 0.55 + vGlow * 0.45);
  }
`

const BEAM_VERTEX = /* glsl */ `
  attribute vec3 aColour;
  attribute float aDrop;
  varying vec3 vColour;
  varying float vDrop;
  void main() {
    vColour = aColour;
    vDrop = aDrop;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const BEAM_FRAGMENT = /* glsl */ `
  precision highp float;
  uniform float uHigh;
  varying vec3 vColour;
  varying float vDrop;
  void main() {
    // Brightest at the lamp and gone by the floor, which is what a beam in a smoky room
    // does — and without the falloff a triangle of flat colour reads as a wedge of card.
    float fade = pow(1.0 - vDrop, 2.2);
    gl_FragColor = vec4(vColour * fade * (0.5 + uHigh * 1.2), fade * 0.24);
  }
`

/** Limb lengths, in the same units the camera is framed against. Kept to real-ish human
 *  proportions: the forearm slightly shorter than the upper arm, the shin the same as the
 *  thigh, and the head about an eighth of the total. Getting these wrong is the fastest way
 *  to make a figure look like a stick insect. */
const BODY = {
  hipWidth: 0.19,
  shoulderWidth: 0.36,
  spine: 0.78,
  neck: 0.17,
  head: 0.15,
  upperArm: 0.34,
  foreArm: 0.31,
  thigh: 0.44,
  shin: 0.44,
}

const PALETTE = ['#ff2e93', '#5ff0ff', '#ffd23b', '#7dff6b', '#c86bff']

function lcg(seed: number) {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
}

interface Dancer {
  /** Where in the line this one stands, -1 to 1. Turned into a position each frame, since
   *  how far apart they should be depends on the shape of the window. */
  across: number
  x: number
  z: number
  /** Where in the bar this one is, so five bodies are not one body drawn five times. */
  phase: number
  /** How big its movements are. */
  gusto: number
  facing: number
  colour: THREE.Color
}

function useDancers(): Dancer[] {
  return useMemo(() => {
    const random = lcg(1989)
    const colour = new THREE.Color()
    return Array.from({ length: DANCERS }, (_, i) => {
      // An arc rather than a line, so the ones at the ends turn inward and the group reads
      // as a group rather than as a row of separate people.
      const across = (i / (DANCERS - 1) - 0.5) * 2
      colour.set(PALETTE[i % PALETTE.length])
      return {
        across,
        x: 0,
        z: -Math.abs(across) * 0.9 + random() * 0.3,
        phase: random(),
        gusto: 0.75 + random() * 0.5,
        facing: 0,
        colour: colour.clone(),
      }
    })
  }, [])
}

/** Segments in one figure: spine, neck, shoulders, hips, four limb bones, and the head. */
const SEGMENTS_PER_FIGURE = 4 + 8 + HEAD_POINTS

export function Dancers() {
  const engine = useBox((s) => s.engine)
  const dancers = useDancers()
  const figureMat = useRef<THREE.ShaderMaterial>(null)
  const beamMat = useRef<THREE.ShaderMaterial>(null)
  const { camera, size } = useThree()

  const figureUniforms = useMemo(() => ({ uBass: { value: 0 } }), [])
  const beamUniforms = useMemo(() => ({ uHigh: { value: 0 } }), [])

  const figures = useMemo(() => {
    const verts = DANCERS * SEGMENTS_PER_FIGURE * 2
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts * 3), 3))
    g.setAttribute('aColour', new THREE.BufferAttribute(new Float32Array(verts * 3), 3))
    g.setAttribute('aGlow', new THREE.BufferAttribute(new Float32Array(verts), 1))
    return g
  }, [])

  const beams = useMemo(() => {
    const g = new THREE.BufferGeometry()
    const verts = BEAMS * 3
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts * 3), 3))
    const colour = new THREE.Color()
    const cols = new Float32Array(verts * 3)
    const drop = new Float32Array(verts)
    for (let i = 0; i < BEAMS; i++) {
      colour.set(PALETTE[(i + 1) % PALETTE.length])
      for (let v = 0; v < 3; v++) {
        cols.set([colour.r, colour.g, colour.b], (i * 3 + v) * 3)
        // The apex is at the lamp; the two base corners are on the floor.
        drop[i * 3 + v] = v === 0 ? 0 : 1
      }
    }
    g.setAttribute('aColour', new THREE.BufferAttribute(cols, 3))
    g.setAttribute('aDrop', new THREE.BufferAttribute(drop, 1))
    return g
  }, [])

  const beat = useRef(0)
  const clock = useRef(0)
  const scratch = useMemo(() => ({ a: new THREE.Vector3(), b: new THREE.Vector3() }), [])

  useFrame((_, dt) => {
    const f = uniformsOf(figureMat)
    const bm = uniformsOf(beamMat)
    if (!f || !bm) return
    const { bass, high } = readLevels(engine)

    clock.current += dt
    f.uBass.value += (bass - f.uBass.value) * Math.min(1, dt * 6)
    bm.uHigh.value += (high - bm.uHigh.value) * Math.min(1, dt * 7)

    // The beat clock. Advanced by the transport's own tempo rather than by a fixed rate, so
    // the dancing is ON the record instead of merely near it.
    const bpm = useBox.getState().song.bpm
    beat.current = (beat.current + dt * (bpm / 60)) % 4

    // Where the finger is, on the floor.
    const cam = camera as THREE.PerspectiveCamera
    const reach = new THREE.Vector3(touch.x * 2 - 1, touch.y * 2 - 1, 0.5).unproject(cam)
    reach.sub(cam.position)
    const hit = reach.y === 0 ? 0 : -cam.position.y / reach.y
    reach.multiplyScalar(Math.max(0, hit)).add(cam.position)

    // How far apart they stand. A line of five is a wide, shallow subject, and on a phone
    // the width is what the frame runs out of first — so they close up rather than the
    // camera backing off until they are ants. Reshape the subject, not the lens; the same
    // call the Lifeforms bodies and the Defcon board both make.
    const portrait = size.width / size.height < 0.85
    const spread = portrait ? 1.2 : 2.5
    for (const d of dancers) d.x = d.across * spread

    const pos = figures.getAttribute('position') as THREE.BufferAttribute
    const col = figures.getAttribute('aColour') as THREE.BufferAttribute
    const glow = figures.getAttribute('aGlow') as THREE.BufferAttribute
    const { a, b } = scratch
    let v = 0

    for (const d of dancers) {
      // Turn to face the finger, easing round rather than snapping — a head that tracks
      // instantly reads as a turret.
      const want = Math.atan2(reach.x - d.x, reach.z - d.z)
      let delta = ((want - d.facing + Math.PI * 3) % (Math.PI * 2)) - Math.PI
      d.facing += delta * Math.min(1, dt * 2.5 * (0.3 + touch.energy))
      const near = Math.exp(-((reach.x - d.x) ** 2 + (reach.z - d.z) ** 2) * 0.12) * touch.energy

      const t = (beat.current + d.phase * 4) % 4
      const swing = Math.sin(t * Math.PI)
      const punch = Math.abs(Math.sin(t * Math.PI))
      const lift = d.gusto * (0.6 + f.uBass.value * 1.4)

      // Hips: a bounce on every beat and a sway across every two.
      const hipY = 0.86 - punch * 0.07 * lift
      const hipX = Math.sin(t * Math.PI * 0.5) * 0.06 * lift
      const lean = near * 0.35

      const cos = Math.cos(d.facing)
      const sin = Math.sin(d.facing)
      /** Local (x = across, y = up, z = forward) into world. */
      const put = (lx: number, ly: number, lz: number, out: THREE.Vector3) =>
        out.set(d.x + lx * cos + lz * sin, ly, d.z - lx * sin + lz * cos)

      const chestY = hipY + BODY.spine
      const chestZ = lean * 0.5
      const headY = chestY + BODY.neck + BODY.head

      const line = (
        ax: number, ay: number, az: number,
        bx: number, by: number, bz: number,
        heat: number,
      ) => {
        put(ax, ay, az, a)
        put(bx, by, bz, b)
        pos.setXYZ(v, a.x, a.y, a.z)
        pos.setXYZ(v + 1, b.x, b.y, b.z)
        for (const at of [v, v + 1]) {
          col.setXYZ(at, d.colour.r, d.colour.g, d.colour.b)
          glow.setX(at, heat)
        }
        v += 2
      }

      const beatGlow = punch * 0.5 + near * 0.5

      // Spine, neck, and the two bars that make a torso rather than a stick.
      line(hipX, hipY, 0, hipX * 0.4, chestY, chestZ, beatGlow)
      line(hipX * 0.4, chestY, chestZ, 0, chestY + BODY.neck, chestZ, beatGlow)
      line(-BODY.shoulderWidth, chestY, chestZ, BODY.shoulderWidth, chestY, chestZ, beatGlow)
      line(hipX - BODY.hipWidth, hipY, 0, hipX + BODY.hipWidth, hipY, 0, beatGlow)

      // Arms. Up on the beat, and reaching toward the finger when it is close — which is
      // the whole point of the scene, so it gets the biggest number in here.
      for (const side of [-1, 1]) {
        const raise = swing * side * 0.9 * lift + near * 1.5
        const shoulderX = side * BODY.shoulderWidth
        const elbowX = shoulderX + side * BODY.upperArm * Math.cos(raise * 0.8)
        const elbowY = chestY + BODY.upperArm * Math.sin(raise * 0.9) * 0.8
        const elbowZ = chestZ + near * 0.4
        const handX = elbowX + side * BODY.foreArm * Math.cos(raise * 1.4) * 0.7
        const handY = elbowY + BODY.foreArm * Math.sin(raise * 1.5 + 0.4)
        const handZ = elbowZ + near * 0.7
        line(shoulderX, chestY, chestZ, elbowX, elbowY, elbowZ, beatGlow)
        line(elbowX, elbowY, elbowZ, handX, handY, handZ, beatGlow + near * 0.6)
      }

      // Legs. Alternating step, and the knees bend on the bounce.
      for (const side of [-1, 1]) {
        const step = Math.sin((t + (side < 0 ? 0 : 1)) * Math.PI) * 0.32 * lift
        const hipJointX = hipX + side * BODY.hipWidth
        // The knee leads the foot and lifts on the step, which is the difference between a
        // leg and a pair of sticks hinged at the hip.
        const bend = 0.72 + Math.abs(step) * 0.5 - punch * 0.12
        const kneeX = hipJointX + side * 0.04 + step * 0.12
        const kneeY = hipY - BODY.thigh * bend
        const kneeZ = step * 0.55
        const footX = kneeX + side * 0.03
        const footY = Math.max(0.02, kneeY - BODY.shin * (0.92 - Math.abs(step) * 0.35))
        const footZ = step * 1.15
        line(hipJointX, hipY, 0, kneeX, kneeY, kneeZ, beatGlow)
        line(kneeX, kneeY, kneeZ, footX, footY, footZ, beatGlow)
      }

      // The head, as a ring facing the way the dancer is.
      for (let i = 0; i < HEAD_POINTS; i++) {
        const a0 = (i / HEAD_POINTS) * Math.PI * 2
        const a1 = ((i + 1) / HEAD_POINTS) * Math.PI * 2
        line(
          Math.cos(a0) * BODY.head, headY + Math.sin(a0) * BODY.head, chestZ,
          Math.cos(a1) * BODY.head, headY + Math.sin(a1) * BODY.head, chestZ,
          beatGlow + 0.2,
        )
      }
    }
    pos.needsUpdate = true
    col.needsUpdate = true
    glow.needsUpdate = true

    // The lights: four beams from above, sweeping, splayed wider on the loud bits.
    const bpos = beams.getAttribute('position') as THREE.BufferAttribute
    for (let i = 0; i < BEAMS; i++) {
      const sweep = Math.sin(clock.current * (0.5 + i * 0.13) + i * 1.7) * 4.5
      const spread = 0.7 + bm.uHigh.value * 1.1
      bpos.setXYZ(i * 3, (i / (BEAMS - 1) - 0.5) * 7, 5.2, -2.6)
      bpos.setXYZ(i * 3 + 1, sweep - spread, 0, 1.5)
      bpos.setXYZ(i * 3 + 2, sweep + spread, 0, 1.5)
    }
    bpos.needsUpdate = true

    // Framed on the group rather than at a fixed distance, so a wide window comes in
    // instead of leaving a band of empty stage above their heads.
    // The group's extent on screen: the outermost dancer plus an arm's reach across, and
    // from the feet to the top of a raised hand vertically.
    const distance = fitDistance(cam, spread + 1.0, 1.35, 0.86)
    camera.position.set(
      (touch.x - 0.5) * 1.2 * touch.energy,
      1.15 + f.uBass.value * 0.12,
      distance,
    )
    camera.lookAt(0, 1.05, 0)
    if (figureMat.current) figureMat.current.uniformsNeedUpdate = true
    if (beamMat.current) beamMat.current.uniformsNeedUpdate = true
  })

  return (
    <>
      <color attach="background" args={['#07030d']} />
      {/* Beams first and additive, so the figures are drawn over the light rather than
          being washed out by it. */}
      <mesh geometry={beams} frustumCulled={false}>
        <shaderMaterial
          ref={beamMat}
          uniforms={beamUniforms}
          vertexShader={BEAM_VERTEX}
          fragmentShader={BEAM_FRAGMENT}
          transparent
          depthWrite={false}
          side={THREE.DoubleSide}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
      {/* Culling off: every vertex is rewritten each frame, so the bounds three worked out
          once describe a pose that no longer exists. */}
      <lineSegments geometry={figures} frustumCulled={false}>
        <shaderMaterial
          ref={figureMat}
          uniforms={figureUniforms}
          vertexShader={FIGURE_VERTEX}
          fragmentShader={FIGURE_FRAGMENT}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </lineSegments>
    </>
  )
}
