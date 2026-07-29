import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useBox } from '../../store'
import { readLevels } from '../levels'
import { touch } from '../touch'
import { uniformsOf } from '../uniforms'

// Jump Man. An 80s platformer, run on hardware that would have been a supercomputer then.
//
// The homage is the sprite work: everything on screen is drawn on a grid at one colour per
// cell, animated on twos, with a two-frame run cycle and a landscape that scrolls in
// parallax layers. None of that has changed since 1985 and none of it should.
//
// The twist is that a pixel here is not a pixel. Every cell is a POINT IN SPACE with its
// own depth, lit with a bevel, and the whole sprite is a particle system that happens to be
// standing in formation — so when the character dies it does not blink out, it comes apart
// into a few hundred cubes that tumble, fall and are gathered back up on the respawn. A
// 6502 could draw the sprite; it could not throw it in the air.
//
// And it runs on the RECORD. He jumps on the kick and his legs change frame on the hat, so
// the run cycle is the drum pattern rather than a timer that happens to be nearby. Stop the
// transport and he stands still, which is the honest version of the joke.

/** One cell of the sprite grid, in world units. */
const CELL = 1
/**
 * How much of the world is on screen, in cells.
 *
 * A side-scroller is a wide composition and a phone is a tall screen, so this is the number
 * that has to give — showing seventy-six cells across a 0.46-aspect frame means backing off
 * until the runner is a thumbnail with two-thirds of the screen empty sky above him. Fewer
 * cells on a phone is the same call the Defcon board and the Lifeforms bodies both make:
 * reshape the subject, not the lens.
 */
const VIEW_WIDE = 76
const VIEW_TALL = 34
const GROUND_Y = -9
/** Where the runner stands, as a fraction of the visible width. Left of centre, because a
 *  platformer needs to show what is coming rather than what you have passed — and a
 *  fraction rather than a number of cells, or he walks off the edge of a phone the moment
 *  the view narrows. */
const RUNNER_AT = -0.28
const MAX_POINTS = 4000

const PIXEL_VERTEX = /* glsl */ `
  uniform float uPixelRatio;
  attribute vec3 aColour;
  attribute float aSize;
  attribute float aGlow;
  varying vec3 vColour;
  varying float vGlow;

  void main() {
    vColour = aColour;
    vGlow = aGlow;
    vec4 view = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * view;
    gl_PointSize = aSize * uPixelRatio * (${'520.0'} / max(1.0, -view.z));
  }
`

const PIXEL_FRAGMENT = /* glsl */ `
  precision highp float;
  varying vec3 vColour;
  varying float vGlow;

  void main() {
    // Square, not round: this is a pixel. The bevel is the modern part — a light top-left
    // edge and a dark bottom-right one, so each cell reads as a little block with a
    // thickness rather than as a flat swatch. That is the whole "extruded sprite" idea in
    // four lines of shader.
    vec2 p = gl_PointCoord;
    float lit = smoothstep(0.42, 0.06, max(p.x, p.y));
    float shade = smoothstep(0.58, 0.94, max(1.0 - p.x, 1.0 - p.y));
    vec3 colour = vColour * (0.82 + lit * 0.5 - shade * 0.28) + vColour * vGlow;
    gl_FragColor = vec4(colour, 1.0);
  }
`

/** The palette. Deliberately few and deliberately flat — a sprite reads by its silhouette
 *  and its two or three colours, and every extra shade costs more than it gives. */
const PALETTE: Record<string, string> = {
  H: '#ff4d5a', // helmet
  V: '#241a33', // visor
  W: '#ffffff', // glint
  S: '#ffc38a', // skin
  G: '#3ba7ff', // suit
  B: '#2b3a6b', // boots
  M: '#7bdc52', // monster
  E: '#161022', // monster eye
  F: '#3f8f26', // monster foot
  P: '#ffe14d', // pick-up
  K: '#8b5a2b', // brick
  k: '#6b4420', // brick shadow
  C: '#cfe8ff', // cloud
  L: '#2a5f8f', // far hills
}

/** Sprite art, top row first. A dot is a hole. */
type Art = readonly string[]

const RUN_A: Art = [
  '..HHHH....',
  '.HHHHHH...',
  '.HVVVVH...',
  '.HVWWVH...',
  '..SSSS....',
  '.GGGGGG...',
  'GGGGGGGG..',
  'GG.GG.GG..',
  '..GGGG....',
  '..B..B....',
  '.BB..BB...',
]

const RUN_B: Art = [
  '..HHHH....',
  '.HHHHHH...',
  '.HVVVVH...',
  '.HVWWVH...',
  '..SSSS....',
  '.GGGGGG...',
  'GGGGGGGG..',
  'GG.GG.GG..',
  '..GGGG....',
  '...B..B...',
  '..BB...BB.',
]

const JUMP: Art = [
  '..HHHH....',
  '.HHHHHH...',
  '.HVVVVH...',
  '.HVWWVH...',
  'S.SSSS.S..',
  'SGGGGGGS..',
  '.GGGGGG...',
  '..GGGG....',
  '..BB.BB...',
  '.BB...BB..',
]

const MONSTER: Art = [
  '..MMMM..',
  '.MMMMMM.',
  'MMEMMEMM',
  'MMEMMEMM',
  'MMMMMMMM',
  '.MMMMMM.',
  '..F..F..',
]

const PICKUP: Art = [
  '...P....',
  '..PPP...',
  '.PPPPP..',
  'PPPPPPP.',
  '.PPPPP..',
  '..P.P...',
  '.P...P..',
]

interface Cell {
  x: number
  y: number
  colour: THREE.Color
}

/** Turn art into cells, with the origin at the bottom-left of the sprite. */
function cellsOf(art: Art): Cell[] {
  const out: Cell[] = []
  const height = art.length
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < art[row].length; col++) {
      const ch = art[row][col]
      if (ch === '.') continue
      out.push({ x: col, y: height - 1 - row, colour: new THREE.Color(PALETTE[ch] ?? '#ffffff') })
    }
  }
  return out
}

interface Monster {
  x: number
  alive: boolean
}
interface Pickup {
  x: number
  taken: boolean
}
interface Shard {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  colour: THREE.Color
}

/** Onset detection — a fast envelope crossing a slow one, as in the other event-driven
 *  scenes. A level threshold fires all through a loud passage and never in a quiet one. */
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

function lcg(seed: number) {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
}

export function Jumpman() {
  const engine = useBox((s) => s.engine)
  const running = useBox((s) => s.running)
  const material = useRef<THREE.ShaderMaterial>(null)
  const { camera, size, viewport } = useThree()

  const art = useMemo(
    () => ({
      runA: cellsOf(RUN_A),
      runB: cellsOf(RUN_B),
      jump: cellsOf(JUMP),
      monster: cellsOf(MONSTER),
      pickup: cellsOf(PICKUP),
    }),
    [],
  )

  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_POINTS * 3), 3))
    g.setAttribute('aColour', new THREE.BufferAttribute(new Float32Array(MAX_POINTS * 3), 3))
    g.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(MAX_POINTS), 1))
    g.setAttribute('aGlow', new THREE.BufferAttribute(new Float32Array(MAX_POINTS), 1))
    return g
  }, [])

  const uniforms = useMemo(() => ({ uPixelRatio: { value: 1 } }), [])

  // --- The game.
  const world = useRef({
    scroll: 0,
    /** Height above the ground, in cells. */
    hop: 0,
    hopVel: 0,
    frame: 0,
    /** Seconds left of being dead. Zero means alive. */
    dead: 0,
    powered: 0,
    monsters: [] as Monster[],
    pickups: [] as Pickup[],
    shards: [] as Shard[],
    spawnedTo: 0,
  })
  const onKick = useMemo(() => makeDetector(1.35, 0.14), [])
  const onHat = useMemo(() => makeDetector(1.5, 0.08), [])
  const random = useMemo(() => lcg(1985), [])
  const scratch = useMemo(() => ({ colour: new THREE.Color() }), [])

  useFrame((_, dt) => {
    const u = uniformsOf(material)
    if (!u) return
    const { bass, high } = readLevels(engine)
    u.uPixelRatio.value = viewport.dpr

    const w = world.current
    const step = Math.min(0.05, dt)

    // Scrolling, and everything else, only happens while the record does. Standing still
    // when the music stops is the point rather than an oversight.
    const pace = running ? 15 + bass * 10 : 0
    w.scroll += step * pace

    // He jumps on the kick and changes leg on the hat. The run cycle IS the drum pattern.
    if (onKick(bass, step) && w.dead <= 0 && w.hop <= 0.01) w.hopVel = 26
    if (onHat(high, step)) w.frame = 1 - w.frame

    // A hop, with gravity. Ends flat on the ground rather than drifting under it.
    w.hopVel -= step * 74
    w.hop = Math.max(0, w.hop + step * w.hopVel)
    if (w.hop <= 0) w.hopVel = 0

    if (w.dead > 0) {
      w.dead -= step
      if (w.dead <= 0) {
        // Respawn: clear the road ahead so he does not land on the thing that killed him.
        w.monsters = w.monsters.filter((m) => m.x - w.scroll > 26)
        w.hop = 0
        w.hopVel = 0
      }
    }
    if (w.powered > 0) w.powered -= step

    // Populate the road ahead. Deterministic, so the same run happens every time — which
    // matters more than variety here, because a scene that is different every mount is one
    // you cannot compare screenshots of.
    while (w.spawnedTo < w.scroll + VIEW_WIDE * 1.5) {
      w.spawnedTo += 12 + random() * 22
      if (random() < 0.62) w.monsters.push({ x: w.spawnedTo, alive: true })
      else w.pickups.push({ x: w.spawnedTo, taken: false })
    }
    w.monsters = w.monsters.filter((m) => m.x - w.scroll > -VIEW_WIDE)
    w.pickups = w.pickups.filter((p) => p.x - w.scroll > -VIEW_WIDE)

    const portrait = size.width / size.height < 0.85
    const across = portrait ? VIEW_TALL : VIEW_WIDE
    const runnerX = across * RUNNER_AT
    const runnerWorldX = w.scroll + runnerX + across / 2

    // Collisions. Being in the air clears a monster; being on the ground does not.
    for (const m of w.monsters) {
      if (!m.alive) continue
      if (Math.abs(m.x - runnerWorldX) < 4 && w.dead <= 0) {
        if (w.hop > 5 || w.powered > 0) {
          m.alive = false
          // Stamped: the monster comes apart instead of vanishing.
          for (const c of art.monster) {
            w.shards.push({
              x: m.x - w.scroll + c.x - 4,
              y: GROUND_Y + c.y,
              vx: (random() - 0.5) * 26,
              vy: 8 + random() * 26,
              life: 1.1,
              colour: c.colour,
            })
          }
        } else {
          // Death. Every cell of him becomes a shard — the sprite was always a particle
          // system, this is just the frame where it stops pretending otherwise.
          w.dead = 1.5
          for (const c of art.runA) {
            w.shards.push({
              x: runnerX + c.x,
              y: GROUND_Y + w.hop + c.y,
              vx: (random() - 0.5) * 30 - 6,
              vy: 18 + random() * 30,
              life: 1.5,
              colour: c.colour,
            })
          }
        }
      }
    }
    for (const p of w.pickups) {
      if (!p.taken && Math.abs(p.x - runnerWorldX) < 4 && w.dead <= 0) {
        p.taken = true
        w.powered = 6
        for (const c of art.pickup) {
          w.shards.push({
            x: p.x - w.scroll + c.x - 4,
            y: GROUND_Y + 8 + c.y,
            vx: (random() - 0.5) * 20,
            vy: 14 + random() * 22,
            life: 0.9,
            colour: c.colour,
          })
        }
      }
    }

    // Shards fall and fade.
    for (const sh of w.shards) {
      sh.life -= step
      sh.vy -= step * 62
      sh.x += sh.vx * step - step * pace
      sh.y += sh.vy * step
    }
    w.shards = w.shards.filter((sh) => sh.life > 0)

    // --- Draw. Everything on screen is one buffer of points.
    const pos = geometry.getAttribute('position') as THREE.BufferAttribute
    const col = geometry.getAttribute('aColour') as THREE.BufferAttribute
    const siz = geometry.getAttribute('aSize') as THREE.BufferAttribute
    const glo = geometry.getAttribute('aGlow') as THREE.BufferAttribute
    let n = 0
    const put = (x: number, y: number, z: number, c: THREE.Color, sizePx: number, glow: number) => {
      if (n >= MAX_POINTS) return
      pos.setXYZ(n, x, y, z)
      col.setXYZ(n, c.r, c.g, c.b)
      siz.setX(n, sizePx)
      glo.setX(n, glow)
      n++
    }
    const stamp = (cells: Cell[], ox: number, oy: number, z: number, glow: number) => {
      for (const c of cells) put(ox + c.x * CELL, oy + c.y * CELL, z, c.colour, CELL, glow)
    }
    const { colour } = scratch

    // Far hills, then clouds: two parallax layers at different depths and different rates,
    // which is the oldest trick there is and still the one that makes a flat world deep.
    colour.set(PALETTE.L)
    for (let i = 0; i < 90; i++) {
      const x = ((i * 7 - w.scroll * 0.12) % (across * 1.9)) - across * 0.95
      const h = 5 + Math.abs(Math.sin(i * 1.7)) * 9
      for (let y = 0; y < h; y += 1) put(x, GROUND_Y + 2 + y, -16, colour, CELL * 1.6, 0)
    }
    colour.set(PALETTE.C)
    for (let i = 0; i < 26; i++) {
      const x = ((i * 23 - w.scroll * 0.3) % (across * 2.1)) - across * 1.05
      const y = GROUND_Y + 22 + ((i * 5) % 9)
      for (let k = 0; k < 5; k++) put(x + k, y + (k === 2 ? 1 : 0), -9, colour, CELL * 1.3, 0)
    }

    // The ground. Bricks, with a darker course under them.
    for (let i = -2; i < across + 4; i++) {
      const x = i - across / 2 - (w.scroll % 4)
      const brick = Math.floor(i + Math.floor(w.scroll / 4)) % 4 === 0
      colour.set(brick ? PALETTE.k : PALETTE.K)
      put(x, GROUND_Y - 1, 0, colour, CELL, 0)
      put(x, GROUND_Y - 2, 0, colour, CELL, 0)
    }

    // Monsters and pick-ups.
    for (const m of w.monsters) {
      if (!m.alive) continue
      stamp(art.monster, m.x - w.scroll - across / 2 - 4, GROUND_Y, 0, 0)
    }
    for (const p of w.pickups) {
      if (p.taken) continue
      const bob = Math.sin(w.scroll * 0.2 + p.x) * 1.2
      stamp(art.pickup, p.x - w.scroll - across / 2 - 4, GROUND_Y + 9 + bob, 0, 0.5 + high)
    }

    // The runner, unless he is currently in pieces.
    if (w.dead <= 0) {
      const cells = w.hop > 0.6 ? art.jump : w.frame === 0 ? art.runA : art.runB
      stamp(cells, runnerX, GROUND_Y + w.hop, 1, w.powered > 0 ? 0.6 + Math.sin(w.powered * 22) * 0.4 : 0.12)
    }

    // Shards.
    for (const sh of w.shards) {
      put(sh.x, sh.y, 1, sh.colour, CELL * (0.7 + sh.life * 0.5), sh.life * 0.7)
    }

    pos.needsUpdate = true
    col.needsUpdate = true
    siz.needsUpdate = true
    glo.needsUpdate = true
    geometry.setDrawRange(0, n)

    // A flat, side-on camera. The scene is authored in cells, so the framing is a matter of
    // fitting VIEW_WIDTH of them across — which on a tall phone means backing off, and on a
    // wide window means the height binds instead.
    const cam = camera as THREE.PerspectiveCamera
    const halfFov = Math.tan((cam.fov * Math.PI) / 360)
    const forWidth = across / 2 / (halfFov * cam.aspect)
    const forHeight = 17 / halfFov
    camera.position.set((touch.x - 0.5) * 6 * touch.energy, GROUND_Y + 11, Math.max(forWidth, forHeight))
    camera.lookAt((touch.x - 0.5) * 6 * touch.energy, GROUND_Y + 11, 0)
    if (material.current) material.current.uniformsNeedUpdate = true
  })

  return (
    <>
      <color attach="background" args={['#0a0f2a']} />
      {/* Not additive and depth-written: these are opaque blocks stacked in layers, and the
          whole point of the bevel is that a nearer cell covers the one behind it. */}
      <points geometry={geometry} frustumCulled={false}>
        <shaderMaterial
          ref={material}
          uniforms={uniforms}
          vertexShader={PIXEL_VERTEX}
          fragmentShader={PIXEL_FRAGMENT}
        />
      </points>
    </>
  )
}
