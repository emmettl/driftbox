import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useBox } from '../../store'
import { ease, readBands, readLevels } from '../levels'
import { touch } from '../touch'

// The web. Tempest 2000.
//
// Not another tunnel. The Rez corridor is a tube of constant width that you fly THROUGH;
// this is a well that narrows to a point and does not move at all — you look into it, and
// things travel up the lanes toward you. That difference is the whole reason both exist,
// and it is why this one is built from spokes rather than ribs.
//
// The other half is the colour. Minter's Tempest is not tasteful: hue cycles hard, the
// whole web flashes, and everything is more saturated than it has any right to be. The
// restraint that makes the other three scenes work would make this one wrong.
//
// And each lane is its own band of the spectrum, which no other scene does. Sixteen lanes,
// sixteen logarithmic bands, so a kick lights one lane and a hat lights another and the
// web reads as the *shape* of the mix rather than as its loudness.

/** Lanes. Sixteen is Tempest's own count for a circular web, and conveniently the number
 *  of steps in a bar — a coincidence, but a pleasing one. */
const LANES = 16
/** Rings from the rim down to the throat. */
const RINGS = 14
const RIM = 13

const WEB_VERTEX = /* glsl */ `
  uniform float uBands[${LANES}];
  uniform float uBass;
  uniform float uWarp;
  uniform vec2 uTouch;
  uniform float uTime;
  attribute float aLane;
  attribute float aRing;
  varying float vLane;
  varying float vRing;
  varying float vHeat;

  void main() {
    vec3 pos = position;

    // How loud this lane is. The band index has to be read with a constant expression in
    // older GLSL, so it is unrolled by the loop rather than indexed directly.
    float heat = 0.0;
    for (int i = 0; i < ${LANES}; i++) {
      if (i == int(aLane + 0.5)) heat = uBands[i];
    }

    // The lane swells outward with its own band. This is the readout: a loud lane is
    // physically wider than a quiet one, so the web takes the shape of the mix.
    pos.xy *= 1.0 + heat * 0.55 * aRing;

    // The whole well pumps on the low end.
    pos.xy *= 1.0 + uBass * 0.16;

    // A finger drags the rim around, and the throat lags behind it — the web twists
    // rather than sliding, which is what stops it reading as a flat picture being moved.
    float twist = (uTouch.x - 0.5) * uWarp * 2.4 * (1.0 - aRing);
    float c = cos(twist), s = sin(twist);
    pos.xy = mat2(c, -s, s, c) * pos.xy;
    pos.xy *= 1.0 + (uTouch.y - 0.5) * uWarp * 1.1 * (1.0 - aRing);

    vLane = aLane;
    vRing = aRing;
    vHeat = heat;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`

const WEB_FRAGMENT = /* glsl */ `
  precision highp float;
  uniform float uTime;
  uniform float uHigh;
  varying float vLane;
  varying float vRing;
  varying float vHeat;

  // Hue to RGB, so the whole web can cycle through the spectrum rather than crossfading
  // between two chosen colours. Tempest does not have a palette; it has all of them.
  vec3 hue(float h) {
    vec3 k = mod(vec3(5.0, 3.0, 1.0) + h * 6.0, 6.0);
    return clamp(min(k, 4.0 - k), 0.0, 1.0);
  }

  void main() {
    // Hue runs around the web AND drifts with time, so neighbouring lanes are never the
    // same colour and the whole thing cycles.
    float h = fract(vLane / ${LANES}.0 + uTime * 0.06 + vRing * 0.15);
    vec3 colour = hue(h);

    // Brightest at the rim, and much brighter on a loud lane.
    float bright = (0.16 + vRing * 0.5) + vHeat * 2.6 + uHigh * 0.3;
    gl_FragColor = vec4(colour * bright, clamp(0.25 + vHeat * 1.8 + vRing * 0.3, 0.0, 1.0));
  }
`

/** Spokes from throat to rim, plus a ring at each depth. Built once; everything after is
 *  the vertex shader. */
function useWeb() {
  return useMemo(() => {
    const positions: number[] = []
    const lanes: number[] = []
    const rings: number[] = []

    // `ring` runs 0 at the throat to 1 at the rim, and drives both radius and depth —
    // a well rather than a tube, so it narrows away from you instead of running parallel.
    const at = (lane: number, ring: number) => {
      const a = (lane / LANES) * Math.PI * 2
      const t = ring / (RINGS - 1)
      const radius = RIM * (0.06 + 0.94 * t * t)
      return [Math.cos(a) * radius, Math.sin(a) * radius, -34 * (1 - t) * (1 - t)] as const
    }

    const push = (lane: number, ring: number) => {
      const [x, y, z] = at(lane, ring)
      positions.push(x, y, z)
      lanes.push(lane % LANES)
      rings.push(ring / (RINGS - 1))
    }

    // The spokes. These are what make it a web rather than a tunnel.
    for (let lane = 0; lane < LANES; lane++) {
      for (let ring = 0; ring < RINGS - 1; ring++) {
        push(lane, ring)
        push(lane, ring + 1)
      }
    }

    // And a ring at each depth, closing the lanes into cells.
    for (let ring = 0; ring < RINGS; ring++) {
      for (let lane = 0; lane < LANES; lane++) {
        push(lane, ring)
        push(lane + 1, ring)
      }
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geometry.setAttribute('aLane', new THREE.Float32BufferAttribute(lanes, 1))
    geometry.setAttribute('aRing', new THREE.Float32BufferAttribute(rings, 1))
    return geometry
  }, [])
}

export function Web() {
  const engine = useBox((s) => s.engine)
  const geometry = useWeb()
  const material = useRef<THREE.ShaderMaterial>(null)
  const { camera, size } = useThree()
  const bands = useMemo(() => new Float32Array(LANES), [])

  const uniforms = useMemo(
    () => ({
      uBands: { value: new Array<number>(LANES).fill(0) },
      uBass: { value: 0 },
      uHigh: { value: 0 },
      uWarp: { value: 0 },
      uTouch: { value: new THREE.Vector2(0.5, 0.5) },
      uTime: { value: 0 },
    }),
    [],
  )

  useFrame((_, dt) => {
    const { bass, high } = readLevels(engine)
    readBands(engine, bands)
    const u = uniforms

    u.uTime.value += dt
    u.uBass.value = ease(u.uBass.value, bass, dt, 5)
    u.uHigh.value = ease(u.uHigh.value, high, dt, 6)
    u.uWarp.value = touch.energy
    u.uTouch.value.set(touch.x, touch.y)

    // Eased per lane, so a hit blooms and falls away instead of strobing on one frame.
    const values = u.uBands.value
    for (let i = 0; i < LANES; i++) {
      values[i] = ease(values[i], bands[i], dt, 4.5)
    }

    // Further back on a tall screen. The web is as wide as it is anything, so a portrait
    // phone at the desktop distance puts you so far inside it that the rim and most of the
    // lane structure are off the edges — the same problem the other scenes had, from the
    // same cause.
    const portrait = size.width / size.height < 0.85
    camera.position.z = (portrait ? 23 : 15) - bass * 1.6
    camera.position.x = 0
    camera.position.y = 0
    camera.rotation.z += dt * 0.05
    if (material.current) material.current.uniformsNeedUpdate = true
  })

  return (
    <>
      <color attach="background" args={['#03000a']} />
      <lineSegments geometry={geometry}>
        <shaderMaterial
          ref={material}
          uniforms={uniforms}
          vertexShader={WEB_VERTEX}
          fragmentShader={WEB_FRAGMENT}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </lineSegments>
    </>
  )
}
