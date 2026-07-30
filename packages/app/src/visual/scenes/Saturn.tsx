import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { sceneAudio } from '../audio'
import { readLevels } from '../levels'
import { touch } from '../touch'
import { fitDistance } from '../fit'
import { uniformsOf } from '../uniforms'

// Rings of Saturn.
//
// The first scene that is an OBJECT rather than a place. Every other one puts you inside
// something — a corridor, a well, a canyon, a plane of water — and this one puts a body in
// front of you and leaves you outside it. That is most of why it feels different before
// anything moves.
//
// The break drives two things. The rings shimmer on the sixteenths, which suits a record
// whose hats and ghost notes never stop. And the big hits punch holes in the planet: a
// white flash on impact, then a dark scar that stays for a long time afterwards and slowly
// fades. That is the Shoemaker-Levy 9 reference — those impacts were on Jupiter rather
// than Saturn, and in 1994 the scars outlived the flashes by months, which is the detail
// worth stealing. A flash alone is a strobe; a flash that leaves a mark is an event.
//
// Two point clouds and no lines anywhere. Six of the seven scenes are made of lines, and
// a gas giant drawn in wireframe looks like a diagram of a gas giant.

/** Points on the planet. A Fibonacci sphere, so they are evenly spread rather than piled
 *  up at the poles the way a lat/long grid does. */
const PLANET_POINTS = 14000
const PLANET_RADIUS = 9
/** Points in the rings. */
const RING_POINTS = 26000
const RING_INNER = 12
const RING_OUTER = 22
/** Impacts kept at once. Scars outlast flashes by a long way, so this needs to hold more
 *  than there are hits in a bar. */
const IMPACTS = 10

const PLANET_VERTEX = /* glsl */ `
  uniform float uTime;
  uniform float uBass;
  uniform vec4 uImpacts[${IMPACTS}];
  uniform float uPixelRatio;
  varying vec3 vNormal;
  varying float vFlash;
  varying float vScar;

  void main() {
    vec3 dir = normalize(position);
    float lift = 0.0;
    float flash = 0.0;
    float scar = 0.0;

    for (int i = 0; i < ${IMPACTS}; i++) {
      vec4 hit = uImpacts[i];
      if (hit.w < 0.0) continue;
      // Angular distance from the impact point. Cheaper than acos and monotonic in it,
      // which is all this needs — the falloff constants are tuned against it, not degrees.
      float sep = 1.0 - dot(dir, normalize(hit.xyz));
      float age = hit.w;

      // The flash: bright, brief, and spreading outward as a shock front for the first
      // moments so it reads as something arriving rather than a lamp switching on.
      float front = 0.02 + age * 0.35;
      flash += exp(-(sep - front) * (sep - front) * 900.0) * exp(-age * 5.0);
      // The scar: a fixed blot that decays over many seconds. Named "blot" and not the
      // obvious word because "patch" is reserved in GLSL ES, and the only sign of that is
      // a shader that silently fails to compile.
      float blot = exp(-sep * sep * 260.0);
      scar += blot * exp(-age * 0.18);
      // And the surface itself is thrown up a little where it was hit.
      lift += blot * exp(-age * 1.2) * 0.5;
    }

    vec3 pos = position * (1.0 + uBass * 0.02 + lift * 0.06);

    vNormal = dir;
    vFlash = flash;
    vScar = min(scar, 1.0);

    vec4 view = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * view;
    gl_PointSize = clamp(140.0 / -view.z, 1.0, 3.4) * uPixelRatio;
  }
`

const PLANET_FRAGMENT = /* glsl */ `
  precision highp float;
  uniform float uHigh;
  varying vec3 vNormal;
  varying float vFlash;
  varying float vScar;

  void main() {
    vec2 d = gl_PointCoord - 0.5;
    if (dot(d, d) > 0.25) discard;

    // Banded like a gas giant, by latitude. Bands rather than a smooth gradient because
    // that is the one cue that says "gas giant" and not "moon".
    float lat = vNormal.y;
    float band = 0.5 + 0.5 * sin(lat * 22.0);
    vec3 warm = vec3(0.82, 0.68, 0.44);
    vec3 pale = vec3(0.94, 0.86, 0.66);
    vec3 colour = mix(warm, pale, band);

    // A terminator, so it is lit from somewhere and reads as a sphere. Without this a
    // point cloud on a ball is a flat disc.
    float light = clamp(dot(vNormal, normalize(vec3(-0.55, 0.35, 0.75))), 0.0, 1.0);
    float shade = 0.06 + pow(light, 0.8) * 0.94;

    // Scars are dark and reddish — a bruise in the cloud tops, not a hole.
    colour = mix(colour, vec3(0.30, 0.10, 0.07), vScar * 0.85);
    // And the flash goes straight past white.
    colour += vec3(1.0, 0.95, 0.85) * vFlash * 2.6;

    float alpha = clamp(shade * 0.85 + vFlash + vScar * 0.3, 0.0, 1.0);
    gl_FragColor = vec4(colour * (shade + uHigh * 0.12) + vec3(vFlash), alpha);
  }
`

const RING_VERTEX = /* glsl */ `
  uniform float uTime;
  uniform float uBass;
  uniform float uHat;
  uniform float uWarp;
  uniform float uPixelRatio;
  attribute float aRadius;
  attribute float aPhase;
  attribute float aGrit;
  varying float vShine;
  varying float vRadius;

  void main() {
    // Keplerian: the inner ring goes round faster than the outer one. This is the single
    // thing that stops the rings looking like a painted disc — after a few seconds they
    // have visibly sheared against each other.
    float speed = 26.0 / pow(aRadius, 1.5);
    float angle = aPhase + uTime * speed;
    float r = aRadius * (1.0 + uBass * 0.012);

    // The sixteenths make the ring particles jitter in and out. A break this busy needs
    // somewhere to go that is not brightness, or the whole thing just flashes.
    r += sin(aPhase * 40.0 + uTime * 9.0) * uHat * 0.5 * aGrit;
    // A finger fans the rings out and thickens them, so dragging disturbs the ice as well
    // as swinging the camera round.
    r += uWarp * aGrit * 1.6;

    vec3 pos = vec3(cos(angle) * r, aGrit * 0.18 * (1.0 + uHat * 2.0 + uWarp * 6.0), sin(angle) * r);

    vShine = 0.35 + uHat * 0.9;
    vRadius = (aRadius - ${RING_INNER.toFixed(1)}) / ${(RING_OUTER - RING_INNER).toFixed(1)};

    vec4 view = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * view;
    gl_PointSize = clamp(90.0 / -view.z, 1.0, 2.6) * uPixelRatio;
  }
`

const RING_FRAGMENT = /* glsl */ `
  precision highp float;
  varying float vShine;
  varying float vRadius;

  void main() {
    vec2 d = gl_PointCoord - 0.5;
    if (dot(d, d) > 0.25) discard;
    // Icier than the planet, and paler further out.
    vec3 colour = mix(vec3(0.72, 0.66, 0.55), vec3(0.86, 0.90, 1.0), vRadius);
    gl_FragColor = vec4(colour * vShine, vShine * 0.85);
  }
`

function usePlanet() {
  return useMemo(() => {
    const positions = new Float32Array(PLANET_POINTS * 3)
    // The golden-angle spiral. Evenly spaced without any clustering at the poles, which a
    // lat/long grid cannot do and which is very obvious on a rotating sphere.
    const golden = Math.PI * (3 - Math.sqrt(5))
    let seed = 40503
    const jitter = (scale: number) => {
      seed = (seed * 1664525 + 1013904223) % 4294967296
      return (seed / 4294967296 - 0.5) * scale
    }
    for (let i = 0; i < PLANET_POINTS; i++) {
      // Nudged off the spiral. The golden angle spaces points evenly, which is what makes
      // it the right generator — and evenly spaced is exactly what produces a moire, so
      // the sphere reads as woven fabric rather than as cloud tops. A jitter of a fraction
      // of the spacing kills the interference without clumping the points.
      const y = Math.min(1, Math.max(-1, 1 - (i / (PLANET_POINTS - 1)) * 2 + jitter(0.02)))
      const radius = Math.sqrt(Math.max(0, 1 - y * y))
      const theta = golden * i + jitter(0.06)
      positions[i * 3] = Math.cos(theta) * radius * PLANET_RADIUS
      positions[i * 3 + 1] = y * PLANET_RADIUS
      positions[i * 3 + 2] = Math.sin(theta) * radius * PLANET_RADIUS
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    return geometry
  }, [])
}

function useRings() {
  return useMemo(() => {
    const positions = new Float32Array(RING_POINTS * 3)
    const radii = new Float32Array(RING_POINTS)
    const phases = new Float32Array(RING_POINTS)
    const grit = new Float32Array(RING_POINTS)

    let seed = 88172
    const random = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296
      return seed / 4294967296
    }

    // Gaps, at fixed fractions of the way out. A solid annulus reads as a plate; the
    // divisions are what make it read as rings, plural.
    const gaps = [
      [0.28, 0.33],
      [0.62, 0.66],
      [0.88, 0.91],
    ]
    for (let i = 0; i < RING_POINTS; i++) {
      let t = random()
      for (const [from, to] of gaps) {
        if (t > from && t < to) t = t < (from + to) / 2 ? from : to
      }
      radii[i] = RING_INNER + t * (RING_OUTER - RING_INNER)
      phases[i] = random() * Math.PI * 2
      grit[i] = random() * 2 - 1
    }

    const geometry = new THREE.BufferGeometry()
    // Position is written by the vertex shader from radius and phase; the attribute only
    // exists because three requires one to know how many points to draw.
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('aRadius', new THREE.BufferAttribute(radii, 1))
    geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1))
    geometry.setAttribute('aGrit', new THREE.BufferAttribute(grit, 1))
    return geometry
  }, [])
}

/**
 * Onset detection: a fast envelope crossing a slow one, so impacts land on hits rather
 * than on loudness. Same approach as Stillwater, and for the same reason — a threshold on
 * the level itself fires constantly through a loud passage and never through a quiet one.
 */
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

export function Saturn() {
  const planet = usePlanet()
  const rings = useRings()
  const planetMat = useRef<THREE.ShaderMaterial>(null)
  const ringMat = useRef<THREE.ShaderMaterial>(null)
  const system = useRef<THREE.Group>(null)
  const { camera, viewport } = useThree()

  const planetUniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uBass: { value: 0 },
      uHigh: { value: 0 },
      uPixelRatio: { value: 1 },
      // w is age in seconds; negative means the slot is empty.
      uImpacts: { value: Array.from({ length: IMPACTS }, () => new THREE.Vector4(0, 1, 0, -1)) },
    }),
    [],
  )
  const ringUniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uBass: { value: 0 },
      uHat: { value: 0 },
      uWarp: { value: 0 },
      uPixelRatio: { value: 1 },
    }),
    [],
  )

  const next = useRef(0)
  const onKick = useMemo(() => makeDetector(1.55, 0.22), [])
  const spin = useRef(0)
  const roll = useRef(0.613)
  const random = () => {
    roll.current = (roll.current * 9301 + 0.49297) % 1
    return roll.current
  }

  useFrame((_, dt) => {
    const p = uniformsOf(planetMat)
    const r = uniformsOf(ringMat)
    if (!p || !r) return
    const { bass, high } = readLevels(sceneAudio.analyser)

    p.uTime.value += dt
    p.uBass.value += (bass - p.uBass.value) * Math.min(1, dt * 4)
    p.uHigh.value += (high - p.uHigh.value) * Math.min(1, dt * 5)
    p.uPixelRatio.value = viewport.dpr
    r.uTime.value += dt
    r.uBass.value = p.uBass.value
    // Snapped up, eased down: the ring shimmer has to arrive with the hat, not swell into
    // it. Smoothing both ways turns a break into a wash.
    r.uHat.value = high > r.uHat.value ? high : r.uHat.value + (high - r.uHat.value) * Math.min(1, dt * 7)
    r.uWarp.value = touch.energy
    r.uPixelRatio.value = viewport.dpr

    const impacts = p.uImpacts.value as THREE.Vector4[]
    for (const hit of impacts) {
      if (hit.w < 0) continue
      hit.w += dt
      // Retired once the scar has faded to nothing, not when the flash has.
      if (hit.w > 26) hit.w = -1
    }

    const strength = onKick(bass, dt)
    if (strength) {
      const hit = impacts[next.current]
      next.current = (next.current + 1) % IMPACTS
      // Somewhere on the sphere, biased to the lit side so the flash is actually seen.
      const y = random() * 1.3 - 0.55
      const a = random() * Math.PI * 2
      const rad = Math.sqrt(Math.max(0.01, 1 - y * y))
      hit.set(Math.cos(a) * rad - 0.35, y, Math.sin(a) * rad + 0.5, 0)
    }

    // The whole system turns, tilted, and a finger swings the camera round it and lifts
    // the ring plane toward edge-on.
    spin.current += dt * 0.06
    if (system.current) {
      system.current.rotation.set(0.42 - (touch.y - 0.5) * 0.7 * touch.energy, spin.current, 0.16)
    }

    // Framed against whichever edge is binding rather than against a guess per orientation.
    // Seen at this tilt the system is as wide as the outer ring and roughly two thirds as
    // tall, so those are the extents to fit — using the radius for both would frame a
    // square of mostly empty sky.
    const orbitAngle = (touch.x - 0.5) * 1.6 * touch.energy
    const distance = fitDistance(camera as THREE.PerspectiveCamera, RING_OUTER, 15) - bass * 1.5
    camera.position.set(Math.sin(orbitAngle) * distance, 9 + bass * 0.8, Math.cos(orbitAngle) * distance)
    camera.lookAt(0, 0, 0)
    if (planetMat.current) planetMat.current.uniformsNeedUpdate = true
    if (ringMat.current) ringMat.current.uniformsNeedUpdate = true
  })

  return (
    <>
      <color attach="background" args={['#03030a']} />
      <group ref={system}>
        <points geometry={planet} frustumCulled={false}>
          <shaderMaterial
            ref={planetMat}
            uniforms={planetUniforms}
            vertexShader={PLANET_VERTEX}
            fragmentShader={PLANET_FRAGMENT}
            transparent
            depthWrite={false}
          />
        </points>
        {/* Additive, so where the rings cross in front of the planet they brighten it
            rather than punching a hole in it — which is what a field of ice does. */}
        <points geometry={rings} frustumCulled={false}>
          <shaderMaterial
            ref={ringMat}
            uniforms={ringUniforms}
            vertexShader={RING_VERTEX}
            fragmentShader={RING_FRAGMENT}
            transparent
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </points>
      </group>
    </>
  )
}
