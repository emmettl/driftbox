import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useBox } from '../../store'
import { ease, readLevels } from '../levels'
import { touch } from '../touch'

// Pulsing spheres, drifting in deep space.
//
// The reference is the ISDN-era Future Sound of London videos: organic bodies breathing
// slowly, wireframe over translucent, nothing quite still and nothing quite symmetrical.
// The trick that gets you most of the way there is that the surfaces are NOT spheres —
// every vertex is pushed in and out by layered noise, so the silhouette is always
// changing and never repeats exactly.
//
// Where the sunset scene is a picture the music moves, this one is a body the music
// breathes. Bass inflates; highs make the surface twitch; a finger drags them toward it.

/** Cheap 3D value noise. Not the good kind, but this runs per vertex per frame on a
 *  phone, and the difference between this and gradient noise is invisible once three
 *  octaves are layered and the whole thing is moving. */
const NOISE = /* glsl */ `
  vec3 hash3(vec3 p) {
    p = vec3(dot(p, vec3(127.1, 311.7, 74.7)),
             dot(p, vec3(269.5, 183.3, 246.1)),
             dot(p, vec3(113.5, 271.9, 124.6)));
    return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
  }

  float noise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    vec3 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(dot(hash3(i + vec3(0,0,0)), f - vec3(0,0,0)),
              dot(hash3(i + vec3(1,0,0)), f - vec3(1,0,0)), u.x),
          mix(dot(hash3(i + vec3(0,1,0)), f - vec3(0,1,0)),
              dot(hash3(i + vec3(1,1,0)), f - vec3(1,1,0)), u.x), u.y),
      mix(mix(dot(hash3(i + vec3(0,0,1)), f - vec3(0,0,1)),
              dot(hash3(i + vec3(1,0,1)), f - vec3(1,0,1)), u.x),
          mix(dot(hash3(i + vec3(0,1,1)), f - vec3(0,1,1)),
              dot(hash3(i + vec3(1,1,1)), f - vec3(1,1,1)), u.x), u.y), u.z);
  }
`

const BODY_VERTEX = /* glsl */ `
  uniform float uTime;
  uniform float uBass;
  uniform float uHigh;
  uniform float uWarp;
  uniform vec3 uPull;
  uniform float uSeed;
  varying vec3 vNormal;
  varying vec3 vView;
  varying float vBulge;

  ${NOISE}

  void main() {
    vec3 pos = position;
    vec3 n = normalize(position);

    // Three octaves, each drifting at its own speed so the surface never repeats.
    float slow = noise(n * 1.4 + vec3(uSeed, uTime * 0.13, 0.0));
    float mid = noise(n * 3.1 + vec3(0.0, uTime * 0.29, uSeed)) * 0.45;
    float fast = noise(n * 7.4 + vec3(uTime * 0.6, uSeed, 0.0)) * 0.18;

    // Bass inflates the whole body; highs only reach the fine octave, so hats read as a
    // shiver across the surface rather than as the thing breathing faster.
    float bulge = slow * (0.34 + uBass * 0.72) + mid * (0.2 + uHigh * 0.5) + fast * uHigh * 1.4;
    pos += n * bulge;

    // Dragged toward the finger, and squashed along the way — a body leaning, not a
    // whole object sliding.
    vec3 toPull = uPull - pos;
    pos += toPull * uWarp * 0.85 * (0.4 + slow * 0.6);
    // And squashed along the axis it is being pulled down, so a body leaning is also a
    // body deforming — otherwise seven objects all sliding the same way reads as the
    // camera moving rather than as the bodies reacting.
    pos -= n * dot(n, normalize(toPull + vec3(0.0001))) * uWarp * 0.3;

    vBulge = bulge;
    vNormal = normalize(normalMatrix * n);
    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    vView = -mv.xyz;
    gl_Position = projectionMatrix * mv;
  }
`

const BODY_FRAGMENT = /* glsl */ `
  precision highp float;
  uniform vec3 uInner;
  uniform vec3 uRim;
  uniform float uBass;
  varying vec3 vNormal;
  varying vec3 vView;
  varying float vBulge;

  void main() {
    // Fresnel: bright at the silhouette, near-transparent facing you. It is what makes a
    // translucent body read as volume rather than as a flat coloured disc, and it is
    // most of the look.
    float fres = pow(1.0 - abs(dot(normalize(vNormal), normalize(vView))), 2.2);
    vec3 colour = mix(uInner, uRim, clamp(fres + vBulge * 0.5, 0.0, 1.0));
    float alpha = clamp(fres * 0.9 + 0.06 + uBass * 0.12, 0.0, 1.0);
    gl_FragColor = vec4(colour * (0.8 + uBass * 0.9), alpha);
  }
`

/** Where the bodies sit, how big, and what colour. Hand-placed rather than random: a
 *  random cluster looks like a mistake, and the depth ordering here is what gives the
 *  scene somewhere to be. */
const BODIES = [
  { pos: [0, 0.2, -4], size: 1.5, seed: 0.0, inner: '#2a0f4d', rim: '#ff5fc8' },
  { pos: [-3.4, 1.1, -8], size: 1.1, seed: 3.7, inner: '#08303d', rim: '#4be0ff' },
  { pos: [3.6, -0.6, -9], size: 1.35, seed: 8.1, inner: '#3d1030', rim: '#ffb02e' },
  { pos: [-1.6, -1.8, -13], size: 2.1, seed: 12.4, inner: '#101a45', rim: '#8a6bff' },
  { pos: [4.4, 2.3, -16], size: 1.7, seed: 17.9, inner: '#2c0a2a', rim: '#ff2e93' },
  { pos: [-5.2, -0.4, -19], size: 2.4, seed: 21.3, inner: '#062c33', rim: '#5ff0d0' },
  { pos: [1.2, 3.1, -23], size: 2.0, seed: 26.8, inner: '#1a0b3a', rim: '#c46bff' },
] as const

function Body({ body }: { body: (typeof BODIES)[number] }) {
  const material = useRef<THREE.ShaderMaterial>(null)
  const mesh = useRef<THREE.Mesh>(null)
  const engine = useBox((s) => s.engine)

  const uniforms = useMemo(
    () => ({
      uTime: { value: body.seed },
      uBass: { value: 0 },
      uHigh: { value: 0 },
      uWarp: { value: 0 },
      uPull: { value: new THREE.Vector3() },
      uSeed: { value: body.seed },
      uInner: { value: new THREE.Color(body.inner) },
      uRim: { value: new THREE.Color(body.rim) },
    }),
    [body],
  )

  useFrame((_, dt) => {
    const { bass, high } = readLevels(engine)
    const warp = touch.energy
    const u = uniforms

    u.uTime.value += dt
    u.uBass.value = ease(u.uBass.value, bass, dt, 2.4)
    u.uHigh.value = ease(u.uHigh.value, high, dt, 5.0)
    u.uWarp.value = warp

    // The finger, put into the scene at this body's depth so the pull is toward a point
    // in space rather than toward the camera plane.
    u.uPull.value.set(
      (touch.x - 0.5) * 9,
      (touch.y - 0.5) * 7,
      // Relative to the body, since the shader works in object space.
      -body.pos[2] * 0.15,
    )

    if (mesh.current) {
      // Everything turns, slowly, at its own rate and on its own axis. Uniform rotation
      // would make seven bodies look like one object.
      mesh.current.rotation.y += dt * (0.05 + body.seed * 0.004)
      mesh.current.rotation.x += dt * 0.021
      mesh.current.position.y = body.pos[1] + Math.sin(u.uTime.value * 0.31 + body.seed) * 0.35
      mesh.current.scale.setScalar(body.size * (1 + bass * 0.1))
    }
    if (material.current) material.current.uniformsNeedUpdate = true
  })

  return (
    <mesh ref={mesh} position={[body.pos[0], body.pos[1], body.pos[2]]}>
      {/* Detail 5 is about 5k vertices — enough that the noise reads as a surface rather
          than as facets, and cheap enough to run seven of on a phone. */}
      <icosahedronGeometry args={[1, 5]} />
      <shaderMaterial
        ref={material}
        uniforms={uniforms}
        vertexShader={BODY_VERTEX}
        fragmentShader={BODY_FRAGMENT}
        transparent
        depthWrite={false}
        // Additive, so overlapping bodies build light where they cross instead of
        // occluding each other. Half the depth in the scene comes from this.
        blending={THREE.AdditiveBlending}
        side={THREE.DoubleSide}
      />
    </mesh>
  )
}

export function Lifeforms() {
  const engine = useBox((s) => s.engine)
  const { camera, size } = useThree()
  const drift = useRef(0)

  useFrame((_, dt) => {
    const { bass } = readLevels(engine)
    const warp = touch.energy
    drift.current += dt * 0.08

    // A slow wander, so it never settles into a still frame, plus a lean toward the
    // finger and a push back on the kick.
    camera.position.x += (Math.sin(drift.current) * 1.4 + (touch.x - 0.5) * 5 * warp - camera.position.x) * Math.min(1, dt * 1.6)
    camera.position.y += (Math.cos(drift.current * 0.7) * 0.9 + (touch.y - 0.5) * 3 * warp - camera.position.y) * Math.min(1, dt * 1.6)
    // Pull back on a tall screen. The bodies are spread wider than they are high, so a
    // portrait phone at the desktop distance frames them into the bottom third with an
    // empty sky above — the same composition that works in landscape falls apart turned
    // ninety degrees.
    const portrait = size.width / size.height < 0.85
    camera.position.z = (portrait ? 9.5 : 5.5) - bass * 0.6
    camera.lookAt(0, 0.4, -12)
  })

  return (
    <>
      <color attach="background" args={['#04030c']} />
      <fog attach="fog" args={['#080418', 8, 34]} />
      {BODIES.map((body, i) => (
        <Body key={i} body={body} />
      ))}
    </>
  )
}
