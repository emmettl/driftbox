import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useBox } from '../../store'
import { readLevels } from '../levels'
import { touch } from '../touch'
import { uniformsOf } from '../uniforms'

// Little fluffy clouds.
//
// Every other scene in this box is a dark room with glowing lines in it. That is nine
// scenes of the same fundamental idea, and by now the restraint has stopped being a style
// and started being a rut — so this one is a bright blue sky in the middle of the
// afternoon, and the only thing on it is weather.
//
// Which is also the right answer for the record. The Orb's is ambient house built out of a
// 303 and an 808 with a woman talking about the sky over the top of it, and it is *funny* —
// warm and daft and completely unbothered. Doing that in cold cyan vectors would be a
// misread. So: cartoon clouds, drawn as clusters of soft round puffs, which squash and
// stretch on the beat the way a cartoon does, and a rainbow that turns up when it gets
// loud enough to deserve one.
//
// The one thing it keeps from the rest of the set is that nothing is a texture. The puffs
// are point sprites shaded in the fragment shader, the sky is a gradient, the rainbow is
// seven arcs. No images anywhere, same as there are no samples anywhere.

const CLOUDS = 7
const PUFFS = 24
/** How far out the clouds drift before wrapping round to the other side. */
const SPAN = 46
const RAINBOW_BANDS = 7
const RAINBOW_SEGMENTS = 40

const SKY_VERTEX = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const SKY_FRAGMENT = /* glsl */ `
  precision highp float;
  uniform float uBass;
  uniform vec3 uSun;
  varying vec3 vDir;

  void main() {
    // Deep at the zenith, pale at the horizon. Every real sky does this and it is most of
    // what stops a flat blue fill reading as a wall.
    float up = clamp(vDir.y * 0.5 + 0.5, 0.0, 1.0);
    vec3 high = vec3(0.16, 0.44, 0.86);
    vec3 low = vec3(0.72, 0.88, 0.98);
    vec3 sky = mix(low, high, pow(up, 0.7));

    // And a broad warm glow around the sun, which is what makes it feel like an afternoon
    // rather than a colour swatch.
    // The halo exponent matters more than it looks. At 3 the glow spreads over sixty
    // degrees, which on a portrait phone is most of the frame — so with the sun anywhere
    // near the edge you see only its flank and it reads as a white band down one side
    // rather than as a sun at all.
    float toward = max(0.0, dot(vDir, normalize(uSun)));
    sky += vec3(1.0, 0.94, 0.76) * (pow(toward, 26.0) * 1.1 + pow(toward, 7.0) * 0.2);

    gl_FragColor = vec4(sky * (1.0 + uBass * 0.1), 1.0);
  }
`

const PUFF_VERTEX = /* glsl */ `
  uniform vec4 uClouds[${CLOUDS}];
  uniform float uPixelRatio;
  attribute float aCloud;
  attribute float aSize;
  attribute float aTop;
  varying float vTop;
  varying float vShade;

  void main() {
    // Constant-index fetch. Older GLSL will not index a uniform array with a value that
    // came in on an attribute, so the loop unrolls it — the same dance the Tempest web does
    // for its bands.
    vec4 cloud = vec4(0.0);
    for (int i = 0; i < ${CLOUDS}; i++) {
      if (i == int(aCloud + 0.5)) cloud = uClouds[i];
    }

    // Squash and stretch. The oldest trick in animation: a cartoon body keeps its volume,
    // so anything that flattens also has to widen. Driven by the kick, it makes the whole
    // sky bounce without a single thing moving from where it is.
    float squash = cloud.w;
    vec3 pos = position;
    pos.y *= squash;
    pos.x /= squash;
    pos += cloud.xyz;

    vTop = aTop;
    // Lit from where the sun is, roughly: the tops of the puffs are white and the
    // undersides go blue-grey. Real enough at this size, and it is what makes a circle
    // read as a lump rather than as a dot.
    vShade = 0.55 + aTop * 0.45;

    vec4 view = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * view;
    gl_PointSize = aSize * uPixelRatio * (300.0 / max(1.0, -view.z));
  }
`

const PUFF_FRAGMENT = /* glsl */ `
  precision highp float;
  varying float vTop;
  varying float vShade;

  void main() {
    vec2 d = gl_PointCoord - 0.5;
    float r = length(d);
    if (r > 0.5) discard;

    // A soft edge, but not too soft — a cartoon cloud has an edge you could draw round.
    // Fading it out over the last fifth of the radius gives a lump rather than a smudge.
    float alpha = 1.0 - smoothstep(0.30, 0.5, r);

    // Shaded within the puff as well as between them, so each lump is round.
    float lift = 1.0 - smoothstep(-0.1, 0.45, d.y);
    vec3 white = vec3(1.0, 0.99, 0.97);
    vec3 shadow = vec3(0.66, 0.74, 0.86);
    vec3 colour = mix(shadow, white, clamp(vShade * 0.55 + lift * 0.6, 0.0, 1.0));

    gl_FragColor = vec4(colour, alpha);
  }
`

const BOW_VERTEX = /* glsl */ `
  attribute vec3 aColour;
  varying vec3 vColour;
  void main() {
    vColour = aColour;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const BOW_FRAGMENT = /* glsl */ `
  precision highp float;
  uniform float uShow;
  varying vec3 vColour;
  void main() {
    if (uShow < 0.01) discard;
    gl_FragColor = vec4(vColour, uShow * 0.72);
  }
`

/** Deterministic, so the sky is the same sky every time it opens. */
function lcg(seed: number) {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
}

function usePuffs() {
  return useMemo(() => {
    const random = lcg(1969)
    const position: number[] = []
    const cloud: number[] = []
    const size: number[] = []
    const top: number[] = []

    for (let c = 0; c < CLOUDS; c++) {
      for (let p = 0; p < PUFFS; p++) {
        // A cloud is a fat lens of puffs: wide, shallow, and heavier along the bottom so
        // it has a flat base and a lumpy top. A blob of evenly scattered points is a
        // sphere, and a spherical cloud looks like a sheep.
        const t = p / (PUFFS - 1)
        const across = (random() - 0.5) * 2
        const height = Math.pow(random(), 1.7)
        const lift = Math.cos(across * 1.2) * 0.55
        const x = across * 7.5
        const y = height * 2.6 * lift + 0.2
        const z = (random() - 0.5) * 2.4
        position.push(x, y, z)
        cloud.push(c)
        // Bigger in the middle and toward the base, so the silhouette tapers at the ends.
        size.push((2.6 + (1 - Math.abs(across)) * 3.2) * (0.75 + random() * 0.5))
        top.push(Math.min(1, height * 0.6 + lift * 0.5 + t * 0.1))
      }
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3))
    geometry.setAttribute('aCloud', new THREE.Float32BufferAttribute(cloud, 1))
    geometry.setAttribute('aSize', new THREE.Float32BufferAttribute(size, 1))
    geometry.setAttribute('aTop', new THREE.Float32BufferAttribute(top, 1))
    return geometry
  }, [])
}

function useRainbow() {
  return useMemo(() => {
    const position: number[] = []
    const colour: number[] = []
    const bands = ['#ff4d4d', '#ff9d3b', '#ffe14d', '#5ede63', '#4db8ff', '#5a63e8', '#a45ce8']
    const c = new THREE.Color()
    for (let b = 0; b < RAINBOW_BANDS; b++) {
      c.set(bands[b])
      const radius = 30 - b * 1.4
      for (let s = 0; s < RAINBOW_SEGMENTS; s++) {
        const a0 = Math.PI * (s / RAINBOW_SEGMENTS)
        const a1 = Math.PI * ((s + 1) / RAINBOW_SEGMENTS)
        position.push(Math.cos(a0) * radius, Math.sin(a0) * radius - 12, -30)
        position.push(Math.cos(a1) * radius, Math.sin(a1) * radius - 12, -30)
        colour.push(c.r, c.g, c.b, c.r, c.g, c.b)
      }
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3))
    geometry.setAttribute('aColour', new THREE.Float32BufferAttribute(colour, 3))
    return geometry
  }, [])
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

export function Clouds() {
  const engine = useBox((s) => s.engine)
  const puffs = usePuffs()
  const rainbow = useRainbow()
  const skyMat = useRef<THREE.ShaderMaterial>(null)
  const skyMesh = useRef<THREE.Mesh>(null)
  const puffMat = useRef<THREE.ShaderMaterial>(null)
  const bowMat = useRef<THREE.ShaderMaterial>(null)
  const { camera, size, viewport } = useThree()

  // Up and to the right, but well inside the frame — a phone sees about nineteen degrees
  // either side of centre.
  const sun = useMemo(() => new THREE.Vector3(0.2, 0.44, -1), [])
  const skyUniforms = useMemo(() => ({ uBass: { value: 0 }, uSun: { value: sun } }), [sun])
  const puffUniforms = useMemo(
    () => ({
      uClouds: { value: Array.from({ length: CLOUDS }, () => new THREE.Vector4(0, 0, 0, 1)) },
      uPixelRatio: { value: 1 },
    }),
    [],
  )
  const bowUniforms = useMemo(() => ({ uShow: { value: 0 } }), [])

  // Where each cloud lives, how fast it drifts, and how squashed it is right now.
  const drift = useMemo(() => {
    const random = lcg(4223)
    return Array.from({ length: CLOUDS }, (_, i) => ({
      x: (i / CLOUDS - 0.5) * SPAN * 2 + random() * 6,
      y: -8 + random() * 22,
      z: -20 - random() * 34,
      speed: 0.9 + random() * 1.5,
      squash: 1,
      phase: random() * 6.28,
    }))
  }, [])

  const clock = useRef(0)
  const bow = useRef(0)
  const onBeat = useMemo(() => makeDetector(1.4, 0.16), [])
  const onBow = useMemo(() => makeDetector(2.4, 6), [])

  useFrame((_, dt) => {
    const sky = uniformsOf(skyMat)
    const p = uniformsOf(puffMat)
    const b = uniformsOf(bowMat)
    if (!sky || !p || !b) return
    const { bass, high } = readLevels(engine)

    clock.current += dt
    sky.uBass.value += (bass - sky.uBass.value) * Math.min(1, dt * 4)
    p.uPixelRatio.value = viewport.dpr

    const kick = onBeat(bass, dt) > 0
    if (onBow(high, dt)) bow.current = 1
    // Long enough to enjoy, short enough that it is an event. At 0.12 it outlasted its own
    // refractory period and simply never left.
    bow.current = Math.max(0, bow.current - dt * 0.28)
    b.uShow.value += (bow.current - b.uShow.value) * Math.min(1, dt * 2)

    const slots = p.uClouds.value as THREE.Vector4[]
    for (let i = 0; i < CLOUDS; i++) {
      const c = drift[i]
      c.x -= dt * c.speed
      // Wrapped round rather than respawned, so the sky never runs out and never repeats
      // in a way you can catch.
      if (c.x < -SPAN) c.x += SPAN * 2

      // A finger pushes clouds aside — they part around it and drift back. On a scene made
      // of weather, shoving it is the obvious thing to try.
      const fingerX = (touch.x - 0.5) * SPAN * 1.4
      const fingerY = (touch.y - 0.5) * 34
      const away = c.x - fingerX
      const gap = Math.hypot(away, c.y - fingerY)
      const shove = Math.exp(-gap * gap * 0.004) * touch.energy * 9
      const bob = Math.sin(clock.current * 0.5 + c.phase) * 0.7

      // Squash on the kick, spring back. Cartoon volume: flatter also means wider, which
      // the shader does by dividing x by the same number it multiplies y by.
      if (kick) c.squash = 0.76
      c.squash += (1 - c.squash) * Math.min(1, dt * 5)

      slots[i].set(c.x + Math.sign(away || 1) * shove, c.y + bob, c.z, c.squash)
    }

    // The sky follows the camera. `vDir` is the direction from the sphere's own centre, so
    // it only equals the direction you are actually looking if the two coincide — left at
    // the origin with the camera thirty units away, the gradient skews and the sun smears
    // into a vertical band down one side of the frame.
    if (skyMesh.current) skyMesh.current.position.copy(camera.position)

    // Barely moves. The clouds do the drifting; a camera that also drifts just makes it
    // hard to tell which is which.
    const portrait = size.width / size.height < 0.85
    camera.position.set((touch.x - 0.5) * 2 * touch.energy, 2 + high * 0.6, portrait ? 34 : 26)
    camera.rotation.set(0.06, 0, 0)
    if (skyMat.current) skyMat.current.uniformsNeedUpdate = true
    if (puffMat.current) puffMat.current.uniformsNeedUpdate = true
  })

  return (
    <>
      {/* The sky is a sphere around everything rather than a background colour, because a
          gradient needs somewhere to be drawn and this guarantees it covers the frame at
          any aspect without any arithmetic. */}
      <mesh ref={skyMesh}>
        <sphereGeometry args={[140, 24, 16]} />
        <shaderMaterial
          ref={skyMat}
          uniforms={skyUniforms}
          vertexShader={SKY_VERTEX}
          fragmentShader={SKY_FRAGMENT}
          side={THREE.BackSide}
          depthWrite={false}
        />
      </mesh>

      <lineSegments geometry={rainbow} frustumCulled={false}>
        <shaderMaterial
          ref={bowMat}
          uniforms={bowUniforms}
          vertexShader={BOW_VERTEX}
          fragmentShader={BOW_FRAGMENT}
          transparent
          depthWrite={false}
        />
      </lineSegments>

      {/* Not additive, and not depth-written. Clouds are opaque white on a bright sky, so
          adding them just blows out to a flat sheet; and writing depth makes the puffs
          within one cloud cut circular holes in each other. */}
      <points geometry={puffs} frustumCulled={false}>
        <shaderMaterial
          ref={puffMat}
          uniforms={puffUniforms}
          vertexShader={PUFF_VERTEX}
          fragmentShader={PUFF_FRAGMENT}
          transparent
          depthWrite={false}
        />
      </points>
    </>
  )
}
