import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useBox } from '../../store'
import { ease, readLevels } from '../levels'
import { touch } from '../touch'
import { uniformsOf } from '../uniforms'

// Flying down a wireframe corridor. The Rez one.
//
// What separates this from the other two scenes is not the look, it is the MOTION. Sunset
// is a fixed horizon and Lifeforms drifts in place; this is travel — everything rushing
// at you and past, toward a vanishing point that never arrives. That sense of being
// pulled forward is most of what Rez feels like, and it is why the scene is a tunnel
// rather than a prettier version of the others.
//
// The rest is vector graphics as they were before anybody could shade them: hard thin
// lines, no fill, cyan and magenta, and everything snapping on the beat rather than
// easing. A trance record is a grid, and this should look like one.

/** How far down the corridor the ribs run before they wrap back to the far end. */
// Shorter and denser than it started. At 190 deep with 46 ribs the corridor read as a
// small hexagon a long way off rather than as something you are inside — most of it was
// beyond the point where the fade had dimmed it to nothing, so the geometry was there and
// invisible. Bringing the far end closer and packing the ribs in fills the frame.
const DEPTH = 120
const RIBS = 64
/** Points around a rib. Six is a hexagon, which reads as a tunnel while staying angular —
 *  a circle at this line weight just looks like a blurry circle. */
const SIDES = 6

const LINE_VERTEX = /* glsl */ `
  uniform float uTime;
  uniform float uBass;
  uniform float uWarp;
  uniform vec2 uTouch;
  attribute float aDepth;
  varying float vFade;
  varying float vPulse;

  void main() {
    vec3 pos = position;

    // Travel. Everything slides toward the camera and wraps at the near end, so the
    // corridor is endless without ever allocating a new rib.
    float z = mod(aDepth + uTime, ${DEPTH.toFixed(1)});
    pos.z = z - ${DEPTH.toFixed(1)};

    // The corridor breathes on the low end, and each rib does it slightly out of step
    // with its neighbours, so the pulse travels down the tunnel rather than the whole
    // thing inflating at once.
    float phase = z * 0.09;
    float breathe = 1.0 + uBass * 0.42 * (0.6 + 0.4 * sin(phase));
    pos.xy *= breathe;

    // Steered by the finger, more strongly the further away it is — which is what makes
    // it read as leaning into a turn rather than sliding the whole tunnel sideways.
    float far = z / ${DEPTH.toFixed(1)};
    pos.x += (uTouch.x - 0.5) * uWarp * 78.0 * far * far;
    pos.y += (uTouch.y - 0.5) * uWarp * 56.0 * far * far;
    // The corridor also flexes where you are holding it — a wave running down its length
    // rather than a clean bend, so steering deforms the tunnel instead of just aiming it.
    pos.xy *= 1.0 + sin(z * 0.16 - uTime * 3.0) * uWarp * 0.28;

    // Brightest just in front of the camera and gone at the far end. This is the fog —
    // done per vertex, because a corridor of thin lines is exactly the case where real
    // fog reads as a grey wash.
    // Held bright for the first half and only then falling away, so the corridor is lit
    // for most of its length instead of fading out a few metres ahead.
    vFade = 1.0 - smoothstep(0.42, 1.0, far);
    vPulse = 1.0 - fract(phase * 0.5 - uTime * 0.1);

    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`

const LINE_FRAGMENT = /* glsl */ `
  precision highp float;
  uniform vec3 uNear;
  uniform vec3 uFar;
  uniform float uHigh;
  varying float vFade;
  varying float vPulse;

  void main() {
    if (vFade < 0.01) discard;
    // Two colours down the length, so the corridor has depth cueing beyond brightness.
    vec3 colour = mix(uFar, uNear, vFade);
    // Highs run a bright band down the tunnel. Hats become something travelling.
    colour += vec3(0.5, 0.9, 1.0) * pow(vPulse, 6.0) * uHigh * 1.4;
    gl_FragColor = vec4(colour, vFade * (0.85 + uHigh * 0.5));
  }
`

/** One long line list: every rib as a closed loop, plus the rails joining them. Built once
 *  and moved entirely in the vertex shader, so there is a single draw call for the lot. */
function useCorridor() {
  return useMemo(() => {
    const positions: number[] = []
    const depths: number[] = []

    const ring = (index: number) => {
      const z = (index / RIBS) * DEPTH
      const radius = 9.5
      for (let s = 0; s < SIDES; s++) {
        for (const step of [s, s + 1]) {
          const a = (step / SIDES) * Math.PI * 2
          positions.push(Math.cos(a) * radius, Math.sin(a) * radius, 0)
          depths.push(z)
        }
      }
    }

    for (let i = 0; i < RIBS; i++) ring(i)

    // The rails: long lines running the length of the corridor at each corner, which is
    // what actually sells the speed. Ribs alone read as strobing; the rails give the eye
    // something continuous to track.
    for (let s = 0; s < SIDES; s++) {
      const a = (s / SIDES) * Math.PI * 2
      const x = Math.cos(a) * 9.5
      const y = Math.sin(a) * 9.5
      for (let i = 0; i < RIBS - 1; i++) {
        positions.push(x, y, 0, x, y, 0)
        depths.push((i / RIBS) * DEPTH, ((i + 1) / RIBS) * DEPTH)
      }
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geometry.setAttribute('aDepth', new THREE.Float32BufferAttribute(depths, 1))
    return geometry
  }, [])
}

export function Wireframe() {
  const engine = useBox((s) => s.engine)
  const geometry = useCorridor()
  const material = useRef<THREE.ShaderMaterial>(null)
  const { camera } = useThree()
  const travelled = useRef(0)

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uBass: { value: 0 },
      uHigh: { value: 0 },
      uWarp: { value: 0 },
      uTouch: { value: new THREE.Vector2(0.5, 0.5) },
      uNear: { value: new THREE.Color('#5ff0d0') },
      uFar: { value: new THREE.Color('#c43bff') },
    }),
    [],
  )

  useFrame((_, dt) => {
    const { bass, high } = readLevels(engine)
    const warp = touch.energy
    // The material's own uniforms, not the memoised object — see uniforms.ts.
    const u = uniformsOf(material)
    if (!u) return

    // Speed follows the low end, so the corridor surges on every kick. A constant rate
    // would be a screensaver; this is the picture reading the record.
    travelled.current += dt * (20 + bass * 34)
    u.uTime.value = travelled.current
    u.uBass.value = ease(u.uBass.value, bass, dt, 4.5)
    u.uHigh.value = ease(u.uHigh.value, high, dt, 6.0)
    u.uWarp.value = warp
    u.uTouch.value.set(touch.x, touch.y)

    // The camera rolls slightly with the finger. Small, because a corridor that rolls too
    // far stops reading as a corridor.
    camera.rotation.z += ((touch.x - 0.5) * -0.5 * warp - camera.rotation.z) * Math.min(1, dt * 2.5)
    camera.position.x += ((touch.x - 0.5) * 2.4 * warp - camera.position.x) * Math.min(1, dt * 3)
    camera.position.y += ((touch.y - 0.5) * 1.8 * warp - camera.position.y) * Math.min(1, dt * 3)
    camera.position.z = 3 - bass * 1.2
    if (material.current) material.current.uniformsNeedUpdate = true
  })

  return (
    <>
      <color attach="background" args={['#03020a']} />
      <lineSegments geometry={geometry}>
        <shaderMaterial
          ref={material}
          uniforms={uniforms}
          vertexShader={LINE_VERTEX}
          fragmentShader={LINE_FRAGMENT}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </lineSegments>
    </>
  )
}
