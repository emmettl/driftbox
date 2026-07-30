import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { sceneAudio } from '../audio'
import { readLevels } from '../levels'
import { touch } from '../touch'
import { uniformsOf } from '../uniforms'

// Still water, for the darkwave one.
//
// Undertow is 82bpm with no snare anywhere, a rimshot, and more reverb than anything else
// in the set — a record that is mostly the space around the hits. Every other scene reads
// the mix as a LEVEL and moves continuously with it, which suits music that is continuous
// and does nothing at all for music that is a few sounds in a large room.
//
// So this one reads EVENTS. A hit drops a ring on a black water plane and the ring travels
// outward and dies; between hits, nothing moves but the drift. The reverb you can hear is
// the picture: something small happening in something very big.
//
// It is also the only scene built from points rather than lines. Five line scenes in a row
// start to look like one artist, and a plane of points at a low angle is the one thing a
// grid of lines cannot be — Sunset already owns the wireframe floor, and this had to not
// be that.

/** Points across the water, per side. 160² is 25,600 — one draw call, and dense enough
 *  that a ring reads as a ring rather than as a dotted line. */
const SIDE = 160
const EXTENT = 90
/** Rings alive at once. Past about a dozen they overlap into noise anyway, and every one
 *  of them costs a loop iteration per vertex per frame. */
const RIPPLES = 12

const WATER_VERTEX = /* glsl */ `
  uniform float uTime;
  uniform float uBass;
  uniform vec4 uRipples[${RIPPLES}];
  uniform vec2 uTouch;
  uniform float uWarp;
  uniform float uPixel;
  varying float vLift;
  varying float vFade;

  void main() {
    vec3 pos = position;

    // The idle surface. Two long, slow swells crossing — barely visible, but a dead flat
    // plane of points reads as a texture rather than as water, and the rings landing on
    // something that is already alive is most of what sells them.
    float swell =
      sin(pos.x * 0.055 + uTime * 0.28) * 0.34 +
      sin(pos.z * 0.041 - uTime * 0.19) * 0.28;
    pos.y += swell * (0.6 + uBass * 1.4);

    // The rings. Each is (x, z, age, strength); a dead one has strength 0 and contributes
    // nothing, so expiry needs no branching.
    float lift = 0.0;
    for (int i = 0; i < ${RIPPLES}; i++) {
      vec4 r = uRipples[i];
      if (r.w <= 0.0) continue;
      float d = distance(pos.xz, r.xy);
      // Where the front has reached by now, and a narrow band around it. Outside the band
      // the water has not been touched yet or has already settled — which is what makes
      // this a travelling ring and not the whole pond bobbing.
      float front = r.z * 15.0;
      float band = exp(-(d - front) * (d - front) * 0.05);
      lift += sin((d - front) * 1.1) * band * r.w * exp(-r.z * 0.55);
    }
    pos.y += lift;

    // A finger drags a standing swell around with it, so touching the water does the same
    // kind of thing a hit does rather than warping the whole plane.
    vec2 finger = vec2((uTouch.x - 0.5) * ${EXTENT.toFixed(1)}, (0.5 - uTouch.y) * ${EXTENT.toFixed(1)} - 20.0);
    float fd = distance(pos.xz, finger);
    pos.y += exp(-fd * fd * 0.004) * uWarp * 3.2 * (0.6 + sin(fd * 0.5 - uTime * 5.0) * 0.4);

    vec4 view = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * view;

    // Points shrink with distance like anything else would, and the far edge of the plane
    // has to fade out or the horizon is a hard line of dots.
    float dist = -view.z;
    gl_PointSize = clamp(${'90.0'} / dist, 1.0, 5.0) * uPixel;
    vLift = lift;
    vFade = 1.0 - smoothstep(45.0, 130.0, dist);
  }
`

const WATER_FRAGMENT = /* glsl */ `
  precision highp float;
  uniform float uHigh;
  varying float vLift;
  varying float vFade;

  void main() {
    // Round points. Without this every "drop" is a square, which at 5px is obvious.
    vec2 d = gl_PointCoord - 0.5;
    if (dot(d, d) > 0.25) discard;
    if (vFade < 0.01) discard;

    // Still water is almost black. A ring passing lifts a point into cold blue-white, so
    // the only bright thing on screen is the thing that just happened.
    vec3 still = vec3(0.10, 0.16, 0.30);
    vec3 crest = vec3(0.70, 0.88, 1.0);
    float energy = clamp(abs(vLift) * 1.5, 0.0, 1.0);
    vec3 colour = mix(still, crest, energy);
    gl_FragColor = vec4(colour * (0.55 + energy * 1.6 + uHigh * 0.25), vFade * (0.35 + energy * 0.65));
  }
`

function useWater() {
  return useMemo(() => {
    const positions = new Float32Array(SIDE * SIDE * 3)
    // Deterministic scatter, so the surface is the same water every time it is opened.
    let seed = 20857
    const jitter = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296
      return seed / 4294967296 - 0.5
    }
    let i = 0
    for (let a = 0; a < SIDE; a++) {
      for (let b = 0; b < SIDE; b++) {
        const t = b / (SIDE - 1)
        // Biased away from the camera: the near rows are stretched across most of the
        // screen and the far ones are crowded into the horizon, so an even grid spends
        // most of its points where they cannot be told apart.
        //
        // Scattered off the lattice too, and that is not a nicety. Seen at this angle a
        // regular grid collapses into radial spokes converging on the vanishing point —
        // the rows line up and read as a stripey fan rather than as a surface. A jitter of
        // roughly one cell is enough to break it, and water is not on a grid anyway.
        const step = EXTENT / (SIDE - 1)
        positions[i++] = (a / (SIDE - 1) - 0.5) * EXTENT + jitter() * step * 2.2
        positions[i++] = 0
        positions[i++] = -Math.pow(t, 1.55) * EXTENT * 1.35 + 8 + jitter() * step * 2.6
      }
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    return geometry
  }, [])
}

/**
 * Onset detection, so rings land on hits rather than on loudness.
 *
 * A fast envelope against a slow one: when the fast crosses the slow by a clear margin
 * the mix just did something it was not already doing. Thresholding the level itself
 * instead would fire continuously through a loud passage and never during a quiet one,
 * which is the opposite of what a hit is.
 */
function makeDetector(rise: number, refractory: number) {
  let fast = 0
  let slow = 0
  let wait = 0
  return (value: number, dt: number): number => {
    fast += (value - fast) * Math.min(1, dt * 30)
    slow += (value - slow) * Math.min(1, dt * 2.5)
    wait -= dt
    if (wait > 0 || fast < 0.06 || fast < slow * rise) return 0
    wait = refractory
    return Math.min(1, fast)
  }
}

const HAZE_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const HAZE_FRAGMENT = /* glsl */ `
  precision highp float;
  uniform float uBass;
  varying vec2 vUv;
  void main() {
    // Brightest at the waterline and gone well before the top of the plane, so it is a
    // band of haze sitting on the horizon rather than a wash over the whole sky.
    float band = pow(1.0 - smoothstep(0.0, 0.55, vUv.y), 2.0);
    // A little wider across the middle, which stops it reading as a drawn rectangle.
    band *= 0.55 + 0.45 * sin(vUv.x * 3.14159);
    vec3 colour = vec3(0.08, 0.16, 0.34);
    gl_FragColor = vec4(colour * band * (1.0 + uBass * 0.9), band * 0.55);
  }
`

export function Stillwater() {
  const geometry = useWater()
  const material = useRef<THREE.ShaderMaterial>(null)
  const haze = useRef<THREE.ShaderMaterial>(null)
  const { camera, size, viewport } = useThree()
  const drift = useRef(0)

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uBass: { value: 0 },
      uHigh: { value: 0 },
      uWarp: { value: 0 },
      uPixel: { value: 1 },
      uTouch: { value: new THREE.Vector2(0.5, 0.5) },
      uRipples: { value: Array.from({ length: RIPPLES }, () => new THREE.Vector4(0, 0, 0, 0)) },
    }),
    [],
  )

  const hazeUniforms = useMemo(() => ({ uBass: { value: 0 } }), [])

  // Ring bookkeeping lives in JS: ages advance here and the shader only ever reads.
  const next = useRef(0)
  const onBass = useMemo(() => makeDetector(1.5, 0.16), [])
  const onHigh = useMemo(() => makeDetector(1.7, 0.1), [])
  // Deterministic placement, so the same track drops rings in the same places twice.
  const roll = useRef(0.371)
  const random = () => {
    roll.current = (roll.current * 9301 + 0.49297) % 1
    return roll.current
  }

  useFrame((_, dt) => {
    const u = uniformsOf(material)
    if (!u) return
    const { bass, high } = readLevels(sceneAudio.analyser)

    u.uTime.value += dt
    // Not eased: the surface swell follows the low end loosely and the RINGS carry the
    // transients, so smoothing here costs nothing and keeps the water from jittering.
    u.uBass.value += (bass - u.uBass.value) * Math.min(1, dt * 3)
    u.uHigh.value += (high - u.uHigh.value) * Math.min(1, dt * 4)
    u.uWarp.value = touch.energy
    u.uTouch.value.set(touch.x, touch.y)
    u.uPixel.value = viewport.dpr

    const ripples = u.uRipples.value as THREE.Vector4[]
    for (const r of ripples) {
      if (r.w <= 0) continue
      r.z += dt
      // Dead once the ring has travelled past the far edge or faded out.
      if (r.z > 6) r.w = 0
    }

    const spawn = (strength: number, spread: number) => {
      const r = ripples[next.current]
      next.current = (next.current + 1) % RIPPLES
      // Kept in the near half. A ring dropped at the far edge is a bright smudge on the
      // horizon by the time it has expanded — the space to actually see one is up close.
      r.set((random() - 0.5) * EXTENT * spread * 0.7, -random() * 42 * spread - 5, 0, strength)
    }

    // Kicks land wide and heavy; the rimshot and the top end drop smaller rings nearer.
    const kick = onBass(bass, dt)
    if (kick) spawn(1.5 + kick * 2.2, 0.8)
    const tick = onHigh(high, dt)
    if (tick) spawn(0.5 + tick * 0.9, 0.55)

    // Low and slow. The camera sits just above the surface so the plane is seen almost
    // edge on, which is what makes it read as water going to a horizon rather than as a
    // field of dots seen from above.
    drift.current += dt * 0.05
    const portrait = size.width / size.height < 0.85
    camera.position.set(
      Math.sin(drift.current) * 2.2 + (touch.x - 0.5) * 3 * touch.energy,
      (portrait ? 5.2 : 4.0) + u.uBass.value * 0.6,
      12,
    )
    // Pitched down enough to put the horizon in the upper third. Level with the surface
    // is the truer water shot and leaves half the frame empty sky, which on a phone is
    // most of the screen doing nothing.
    camera.rotation.set(portrait ? -0.26 : -0.18, 0, Math.sin(drift.current * 0.6) * 0.012)
    const hz = uniformsOf(haze)
    if (hz) hz.uBass.value = u.uBass.value
    if (material.current) material.current.uniformsNeedUpdate = true
  })

  return (
    <>
      <color attach="background" args={['#01040c']} />
      {/* Haze over the water. Without it the top third of a phone screen is pure black,
          which reads as the scene having stopped rather than as a night sky — and this is
          the one scene with a horizon high enough for that to be most of the frame. */}
      {/* Sat ON the waterline: the plane runs from y=0 upward, so the bright end of the
          gradient is exactly where the water ends. Centred on the origin instead, its
          lower half hangs below the surface and the hard bottom edge shows up as a bar
          across the middle of the picture. */}
      <mesh position={[0, 30, -118]} renderOrder={-1}>
        <planeGeometry args={[420, 60]} />
        <shaderMaterial
          ref={haze}
          uniforms={hazeUniforms}
          vertexShader={HAZE_VERTEX}
          fragmentShader={HAZE_FRAGMENT}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
      {/* The geometry is a flat plane until the shader lifts it, so its bounding sphere
          describes something the camera never sees. */}
      <points geometry={geometry} frustumCulled={false}>
        <shaderMaterial
          ref={material}
          uniforms={uniforms}
          vertexShader={WATER_VERTEX}
          fragmentShader={WATER_FRAGMENT}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </points>
    </>
  )
}
