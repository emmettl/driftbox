import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useBox } from '../../store'
import { ease, readLevels } from '../levels'
import { touch } from '../touch'

// The chillwave scene: a sun with slatted bands, a wireframe floor running to the
// horizon, haze. Everything that moves is driven by the audio rather than by a clock,
// so the picture is a readout of the mix and not a screensaver playing alongside it.
//
// Bass drives the sun and the ground swell, highs drive the grid's brightness. Because
// the analyser sits on the master bus, this responds to the actual output — including
// the bus compressor — which is why the sun breathes on the kick.
//
// A finger on the screen pulls the floor toward it. Not a post-effect over the top: the
// vertex shader bends the actual geometry, so the grid lines stretch around the touch
// and the horizon moves with it.

const GRID_VERTEX = /* glsl */ `
  uniform float uTime;
  uniform float uBass;
  uniform vec2 uTouch;
  uniform float uWarp;
  varying vec2 vUv;
  varying float vDist;
  varying float vPull;

  void main() {
    vUv = uv;
    vec3 pos = position;
    // A slow swell in the floor, deeper when the low end is loud. Rolling hills rather
    // than a flat plane, so the grid has something to describe.
    float ridge = sin(pos.x * 0.18 + uTime * 0.25) * cos(pos.y * 0.13 - uTime * 0.16);
    pos.z += ridge * (1.1 + uBass * 3.4) * smoothstep(4.0, 40.0, abs(pos.y));

    // The finger. A gaussian well centred on it, so the floor lifts toward the touch and
    // falls away smoothly rather than denting at a point.
    vec2 target = vec2((uTouch.x - 0.5) * 90.0, mix(6.0, 74.0, 1.0 - uTouch.y));
    float d = length(pos.xy - target);
    float pull = exp(-d * d / 420.0);
    pos.z += pull * uWarp * 16.0;
    // And a ripple running out from it, so it reads as something disturbing the surface
    // rather than a lump under a carpet.
    pos.z += sin(d * 0.32 - uTime * 5.0) * pull * uWarp * 3.0;

    vPull = pull * uWarp;
    vDist = length(pos.xy);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`

const GRID_FRAGMENT = /* glsl */ `
  precision highp float;
  uniform float uTime;
  uniform float uHigh;
  uniform vec3 uNear;
  uniform vec3 uFar;
  varying vec2 vUv;
  varying float vDist;
  varying float vPull;

  void main() {
    // Scroll toward the viewer. The lines are drawn from the fract of the scaled uv,
    // with the line width scaled by fwidth so distant lines stay one pixel wide
    // instead of aliasing into a shimmering mess.
    vec2 uv = vec2(vUv.x * 60.0, vUv.y * 60.0 - uTime * 1.6);
    vec2 grid = abs(fract(uv - 0.5) - 0.5) / fwidth(uv);
    float line = 1.0 - min(min(grid.x, grid.y), 1.0);

    float fade = 1.0 - smoothstep(0.0, 0.62, vUv.y);
    vec3 colour = mix(uNear, uFar, vUv.y);
    float glow = line * fade * (0.55 + uHigh * 0.85);

    if (glow < 0.004) discard;
    // Lit where the finger is, so the warp is visible even on a still floor.
    vec3 lit = mix(colour * (0.7 + uHigh), vec3(1.0, 0.72, 0.3), clamp(vPull * 1.3, 0.0, 0.85));
    gl_FragColor = vec4(lit, glow * (1.0 + vPull * 1.6));
  }
`

const SUN_FRAGMENT = /* glsl */ `
  precision highp float;
  uniform float uBass;
  uniform vec3 uTop;
  uniform vec3 uBottom;
  varying vec2 vUv;

  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    if (r > 1.0) discard;

    vec3 colour = mix(uBottom, uTop, vUv.y);

    // The slats. They widen toward the bottom of the disc, which is the detail that
    // makes this read as the genre rather than as a sunset.
    float band = smoothstep(0.0, 1.0, vUv.y);
    float slat = step(0.34 + band * 0.6, fract(vUv.y * 17.0));
    float mask = mix(slat, 1.0, smoothstep(0.42, 0.95, vUv.y));

    float edge = smoothstep(1.0, 0.86, r);
    gl_FragColor = vec4(colour * (1.0 + uBass * 0.7), mask * edge);
  }
`

export function Sunset() {
  const engine = useBox((s) => s.engine)
  const gridRef = useRef<THREE.ShaderMaterial>(null)
  const sunRef = useRef<THREE.ShaderMaterial>(null)
  const sunMesh = useRef<THREE.Mesh>(null)
  const { camera } = useThree()

  const gridUniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uBass: { value: 0 },
      uHigh: { value: 0 },
      uNear: { value: new THREE.Color('#ff5fc8') },
      uFar: { value: new THREE.Color('#4be0ff') },
      uTouch: { value: new THREE.Vector2(0.5, 0.5) },
      uWarp: { value: 0 },
    }),
    [],
  )

  const sunUniforms = useMemo(
    () => ({
      uBass: { value: 0 },
      uTop: { value: new THREE.Color('#ffe66d') },
      uBottom: { value: new THREE.Color('#ff2e93') },
    }),
    [],
  )

  useFrame((_, dt) => {
    const { bass, high } = readLevels(engine)
    const warp = touch.energy

    if (gridRef.current) {
      const u = gridRef.current.uniforms
      u.uTime.value += dt
      u.uBass.value = ease(u.uBass.value, bass, dt)
      u.uHigh.value = ease(u.uHigh.value, high, dt)
      u.uTouch.value.set(touch.x, touch.y)
      u.uWarp.value = warp
    }
    if (sunRef.current) {
      sunRef.current.uniforms.uBass.value = ease(sunRef.current.uniforms.uBass.value, bass, dt)
    }
    if (sunMesh.current) {
      sunMesh.current.scale.setScalar(1 + bass * 0.06 + warp * 0.04)
    }

    // The camera leans toward the finger, which is most of why the warp reads as depth
    // rather than as a texture effect.
    camera.position.y = 1.15 + bass * 0.22 + warp * 0.5
    camera.position.x += ((touch.x - 0.5) * 3.2 * warp - camera.position.x) * Math.min(1, dt * 3)
    camera.lookAt(0, 1.6, -30)
  })

  return (
    <>
      <color attach="background" args={['#0a0418']} />
      <fog attach="fog" args={['#160a2c', 14, 62]} />

      <mesh ref={sunMesh} position={[0, 3.4, -46]}>
        <planeGeometry args={[26, 26]} />
        <shaderMaterial
          ref={sunRef}
          uniforms={sunUniforms}
          vertexShader={`varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`}
          fragmentShader={SUN_FRAGMENT}
          transparent
          depthWrite={false}
        />
      </mesh>

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.6, -30]}>
        <planeGeometry args={[140, 140, 120, 120]} />
        <shaderMaterial
          ref={gridRef}
          uniforms={gridUniforms}
          vertexShader={GRID_VERTEX}
          fragmentShader={GRID_FRAGMENT}
          transparent
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>
    </>
  )
}
