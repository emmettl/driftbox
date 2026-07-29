import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useBox } from '../../store'
import { readLevels } from '../levels'
import { touch } from '../touch'
import { uniformsOf } from '../uniforms'

// Light cycles.
//
// The problem with a Tron scene is that Sunset already owns "glowing grid to a horizon",
// and doing it again from the same angle would just be a bluer version of a scene that
// exists. So this one is shot from ABOVE — the game-board view rather than the chase — and
// that turns out to be the right call for a second reason: the whole point of a light cycle
// is the wall it leaves behind, and you cannot read the shape of a trail from inside it.
//
// The bikes only travel on the axes and only turn ninety degrees, which is the one rule
// the film never breaks. And they turn ON THE BEAT. That is the entire idea: a grid full
// of right angles being drawn by the kick drum, so the picture is a record of what the
// music did rather than a reaction to how loud it is. Miss a beat and there is a longer
// straight; four in a row and you get a staircase.
//
// A big hit derezzes the arena — every wall flashes white and is gone, and the bikes start
// drawing again from where they stand. Without it the grid silts up into a solid mass
// after twenty seconds, and with it the visual has a structure that matches an arrangement.

// Sized against a PORTRAIT frame, which is the tight one by a long way. A phone's
// horizontal field of view is only about 0.6 of its vertical, so fitting an arena across
// it needs roughly three times its half-width in camera distance — and at the first size
// this was, that distance was past the canvas's 200-unit far plane. The arena had to come
// in rather than the camera going back.
const ARENA = 44
const GRID_STEP = 5.5
const BIKES = 5
/** Corners kept per trail. Only turns are stored — the straights between them need no
 *  points — so this is a lot more wall than the number suggests. */
const TRAIL_CORNERS = 64
const WALL_HEIGHT = 2.6

/** Cyan first, because the hero rides the blue one. */
const COLOURS = ['#5ff0ff', '#ff9d2e', '#c86bff', '#7dff6b', '#ff4d7a']

const WALL_VERTEX = /* glsl */ `
  uniform float uTime;
  uniform float uDerez;
  attribute vec3 aColour;
  attribute float aAge;
  /** 0 at the floor, 1 at the top of the wall. */
  attribute float aUp;
  varying vec3 vColour;
  varying float vUp;
  varying float vFade;

  void main() {
    vec3 pos = position;
    // The derez lifts the walls off the floor as they go, so the arena empties upward
    // instead of simply switching off.
    pos.y += uDerez * uDerez * 26.0 * aUp;

    vColour = aColour;
    vUp = aUp;
    // Older wall is dimmer, so the freshest corner is always the brightest thing on the
    // grid and the eye follows the bike rather than the mess behind it.
    vFade = clamp(1.0 - aAge * 0.11, 0.06, 1.0);

    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`

const WALL_FRAGMENT = /* glsl */ `
  precision highp float;
  uniform float uDerez;
  uniform float uBass;
  varying vec3 vColour;
  varying float vUp;
  varying float vFade;

  void main() {
    // Brightest along the top edge and at the floor line, dimmer through the middle. A
    // flat-shaded slab reads as coloured glass; a light wall is an edge with a glow
    // hanging off it, and those two bands are the whole difference.
    float edge = pow(vUp, 3.0) + pow(1.0 - vUp, 6.0) * 0.7;
    vec3 colour = mix(vColour, vec3(1.0), edge * 0.55 + uDerez);
    float alpha = (0.13 + edge * 0.75) * vFade * (1.0 - uDerez * 0.75);
    gl_FragColor = vec4(colour * (0.8 + edge * 1.7 + uBass * 0.5 + uDerez * 3.0), alpha);
  }
`

const GRID_VERTEX = /* glsl */ `
  varying vec2 vPos;
  void main() {
    // The fade has to be worked out from the fragment's own position, not handed in per
    // vertex. Every line across this grid has BOTH ends on the boundary, so an attribute
    // interpolates from "fully faded" to "fully faded" and the whole grid renders at zero
    // alpha — invisible, with no error anywhere to say so.
    vPos = position.xz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const GRID_FRAGMENT = /* glsl */ `
  precision highp float;
  uniform float uBass;
  uniform float uDerez;
  varying vec2 vPos;
  void main() {
    // Fading toward the edge of the arena, so the grid has no visible border. A hard edge
    // turns the game board into a rug on a floor.
    float out_ = length(vPos) / ${ARENA.toFixed(1)};
    float fade = 1.0 - smoothstep(0.45, 1.05, out_);
    vec3 colour = mix(vec3(0.10, 0.42, 0.62), vec3(0.4, 0.92, 1.0), uBass);
    gl_FragColor = vec4(colour * (1.0 + uBass + uDerez * 2.0), fade * (0.34 + uBass * 0.5 + uDerez * 0.7));
  }
`

interface Bike {
  x: number
  z: number
  /** 0 north, 1 east, 2 south, 3 west. Right angles only, which is the rule. */
  facing: number
  /** Corners behind it, oldest first, as x/z/time triples. */
  corners: number[]
  geometry: THREE.BufferGeometry
  position: Float32Array
  age: Float32Array
}

const STEPS = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
] as const

function useBikes(): Bike[] {
  return useMemo(() => {
    const colour = new THREE.Color()
    return Array.from({ length: BIKES }, (_, i) => {
      // Two vertices per corner — floor and top — and two triangles per segment between
      // them. Allocated once at full size and drawn with `setDrawRange`, because a trail
      // that reallocated its buffers every time it turned would allocate on the beat.
      const verts = (TRAIL_CORNERS + 1) * 2
      const position = new Float32Array(verts * 3)
      const age = new Float32Array(verts)
      const up = new Float32Array(verts)
      const colours = new Float32Array(verts * 3)
      colour.set(COLOURS[i % COLOURS.length])
      for (let v = 0; v < verts; v++) {
        up[v] = v % 2
        colours[v * 3] = colour.r
        colours[v * 3 + 1] = colour.g
        colours[v * 3 + 2] = colour.b
      }
      const index: number[] = []
      for (let s = 0; s < TRAIL_CORNERS; s++) {
        const a = s * 2
        index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
      }

      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.BufferAttribute(position, 3))
      geometry.setAttribute('aAge', new THREE.BufferAttribute(age, 1))
      geometry.setAttribute('aUp', new THREE.BufferAttribute(up, 1))
      geometry.setAttribute('aColour', new THREE.BufferAttribute(colours, 3))
      geometry.setIndex(index)
      geometry.setDrawRange(0, 0)

      // Spread around the arena, each already pointing somewhere different.
      const a = (i / BIKES) * Math.PI * 2
      return {
        x: Math.cos(a) * ARENA * 0.55,
        z: Math.sin(a) * ARENA * 0.55,
        facing: i % 4,
        corners: [],
        geometry,
        position,
        age,
      } satisfies Bike
    })
  }, [])
}

function useGrid() {
  return useMemo(() => {
    const positions: number[] = []
    const line = (ax: number, az: number, bx: number, bz: number) => {
      positions.push(ax, 0, az, bx, 0, bz)
    }
    for (let g = -ARENA; g <= ARENA; g += GRID_STEP) {
      line(g, -ARENA, g, ARENA)
      line(-ARENA, g, ARENA, g)
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    return geometry
  }, [])
}

/** Onset detection — a fast envelope crossing a slow one. Same as Stillwater and Saturn:
 *  a threshold on the level itself fires all through a loud passage and never in a quiet
 *  one, which is the opposite of a hit. */
function makeDetector(rise: number, refractory: number) {
  let fast = 0
  let slow = 0
  let wait = 0
  return (value: number, dt: number): number => {
    fast += (value - fast) * Math.min(1, dt * 28)
    slow += (value - slow) * Math.min(1, dt * 2.2)
    wait -= dt
    if (wait > 0 || fast < 0.07 || fast < slow * rise) return 0
    wait = refractory
    return Math.min(1, fast)
  }
}

export function Cycles() {
  const engine = useBox((s) => s.engine)
  const bikes = useBikes()
  const grid = useGrid()
  const wallMat = useRef<THREE.ShaderMaterial>(null)
  const gridMat = useRef<THREE.ShaderMaterial>(null)
  const riders = useRef<THREE.Points>(null)
  const { camera, size, viewport } = useThree()

  const wallUniforms = useMemo(
    () => ({ uTime: { value: 0 }, uBass: { value: 0 }, uDerez: { value: 0 } }),
    [],
  )
  const gridUniforms = useMemo(() => ({ uBass: { value: 0 }, uDerez: { value: 0 } }), [])
  const riderGeometry = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(BIKES * 3), 3))
    const colour = new THREE.Color()
    const colours = new Float32Array(BIKES * 3)
    for (let i = 0; i < BIKES; i++) {
      colour.set(COLOURS[i % COLOURS.length])
      colours.set([colour.r, colour.g, colour.b], i * 3)
    }
    g.setAttribute('color', new THREE.BufferAttribute(colours, 3))
    return g
  }, [])

  const clock = useRef(0)
  const derez = useRef(0)
  const onTurn = useMemo(() => makeDetector(1.4, 0.13), [])
  const onDerez = useMemo(() => makeDetector(2.6, 3.5), [])
  const roll = useRef(0.2718)
  const random = () => {
    roll.current = (roll.current * 9301 + 0.49297) % 1
    return roll.current
  }

  /**
   * Which of the two legal turns points more toward the middle.
   *
   * Needed because a bike that turns when it reaches a wall turns ALONG the wall — the
   * only way to face away from it is a 180, which a light cycle does not do. So left to
   * itself every bike ends up circling the perimeter and the middle of the arena stays
   * empty, which is exactly what the first version did.
   */
  const inward = (bike: Bike) => {
    const toward = (t: number) => {
      const [dx, dz] = STEPS[(bike.facing + t) % 4]
      return -(bike.x * dx + bike.z * dz)
    }
    return toward(1) > toward(3) ? 1 : 3
  }

  const turn = (bike: Bike, towards?: number) => {
    bike.corners.push(bike.x, bike.z, clock.current)
    while (bike.corners.length > TRAIL_CORNERS * 3) bike.corners.splice(0, 3)
    bike.facing = (bike.facing + (towards ?? (random() < 0.5 ? 1 : 3))) % 4
  }

  useFrame((_, dt) => {
    const w = uniformsOf(wallMat)
    const g = uniformsOf(gridMat)
    if (!w || !g) return
    const { bass, high } = readLevels(engine)

    clock.current += dt
    w.uTime.value = clock.current
    w.uBass.value += (bass - w.uBass.value) * Math.min(1, dt * 6)
    g.uBass.value = w.uBass.value

    // The derez. Rare and loud, so it lands on a crash rather than on every kick.
    if (onDerez(high, dt)) {
      derez.current = 1
      for (const bike of bikes) bike.corners.length = 0
    }
    derez.current = Math.max(0, derez.current - dt * 1.6)
    w.uDerez.value = derez.current
    g.uDerez.value = derez.current

    // One turn signal for the whole grid, so every bike corners on the same beat and the
    // arena fills with parallel right angles rather than with noise.
    const beat = onTurn(bass, dt) > 0
    const speed = 17 + w.uBass.value * 13
    const riderPos = riderGeometry.getAttribute('position') as THREE.BufferAttribute

    bikes.forEach((bike, i) => {
      const [dx, dz] = STEPS[bike.facing]
      bike.x += dx * speed * dt
      bike.z += dz * speed * dt

      // Turned back at a SOFT boundary well inside the arena, not at the wall itself.
      // Turning at the wall is too late: the only legal turn there runs along it, so a bike
      // follows the edge to a corner, turns along the next edge, and never comes back —
      // five of them drawing a square while the middle of the board stays empty. A random
      // walk on a grid drifts outward on its own, so something has to push back.
      const closing = bike.x * dx + bike.z * dz < 0
      const out = Math.hypot(bike.x, bike.z) / ARENA
      if (out > 0.66 && !closing) {
        // Kept turning until it is actually heading home, then left alone — so this costs
        // one corner most of the time, two if it started out pointing straight outward.
        turn(bike, inward(bike))
      } else if (beat && random() < 0.72) {
        turn(bike, random() < out ? inward(bike) : random() < 0.5 ? 1 : 3)
      }
      // A hard stop as well, for the frame where a bike is quick enough to clear the soft
      // ring and the wall together.
      const limit = ARENA * 0.97
      bike.x = Math.max(-limit, Math.min(limit, bike.x))
      bike.z = Math.max(-limit, Math.min(limit, bike.z))

      // Rebuild the wall: every corner behind it, plus the bike's own position as the
      // leading edge, so the newest section grows continuously between turns.
      const count = bike.corners.length / 3
      for (let c = 0; c < count; c++) {
        const x = bike.corners[c * 3]
        const z = bike.corners[c * 3 + 1]
        const at = clock.current - bike.corners[c * 3 + 2]
        for (const v of [c * 2, c * 2 + 1]) {
          bike.position[v * 3] = x
          bike.position[v * 3 + 1] = v % 2 ? WALL_HEIGHT : 0
          bike.position[v * 3 + 2] = z
          bike.age[v] = at
        }
      }
      for (const v of [count * 2, count * 2 + 1]) {
        bike.position[v * 3] = bike.x
        bike.position[v * 3 + 1] = v % 2 ? WALL_HEIGHT : 0
        bike.position[v * 3 + 2] = bike.z
        bike.age[v] = 0
      }
      bike.geometry.attributes.position.needsUpdate = true
      bike.geometry.attributes.aAge.needsUpdate = true
      bike.geometry.setDrawRange(0, count * 6)

      riderPos.setXYZ(i, bike.x, WALL_HEIGHT * 0.5, bike.z)
    })
    riderPos.needsUpdate = true
    // Sized in device pixels, so the riders are the same dot on a phone as on a desktop.
    const dots = riders.current?.material
    if (dots instanceof THREE.PointsMaterial) dots.size = viewport.dpr * 3.2

    // High and slightly off, which is the board view. A finger walks the camera round the
    // arena and drops it toward the deck, so you can go from the map to the chase.
    const portrait = size.width / size.height < 0.85
    const orbit = clock.current * 0.045 + (touch.x - 0.5) * 2.4 * touch.energy
    const height = (portrait ? 84 : 52) - touch.energy * (touch.y - 0.5) * 80
    const range = (portrait ? 82 : 62) + w.uBass.value * 3
    camera.position.set(Math.sin(orbit) * range, Math.max(9, height), Math.cos(orbit) * range)
    camera.lookAt(0, 0, 0)
    if (wallMat.current) wallMat.current.uniformsNeedUpdate = true
    if (gridMat.current) gridMat.current.uniformsNeedUpdate = true
  })

  return (
    <>
      <color attach="background" args={['#01050c']} />
      <lineSegments geometry={grid}>
        <shaderMaterial
          ref={gridMat}
          uniforms={gridUniforms}
          vertexShader={GRID_VERTEX}
          fragmentShader={GRID_FRAGMENT}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </lineSegments>

      {/* Culling off on all of these: the vertices are rewritten every frame, so the
          bounding volumes three computed describe shapes that no longer exist. */}
      {bikes.map((bike, i) => (
        <mesh key={i} geometry={bike.geometry} frustumCulled={false}>
          <shaderMaterial
            ref={i === 0 ? wallMat : undefined}
            uniforms={wallUniforms}
            vertexShader={WALL_VERTEX}
            fragmentShader={WALL_FRAGMENT}
            transparent
            depthWrite={false}
            side={THREE.DoubleSide}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
      ))}

      <points ref={riders} geometry={riderGeometry} frustumCulled={false}>
        <pointsMaterial vertexColors size={3} sizeAttenuation={false} transparent blending={THREE.AdditiveBlending} />
      </points>
    </>
  )
}
