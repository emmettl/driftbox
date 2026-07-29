import { useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useBox } from '../store'

// The chillwave scene: a sun with slatted bands, a wireframe floor running to the
// horizon, haze. Everything that moves is driven by the audio rather than by a clock,
// so the picture is a readout of the mix and not a screensaver playing alongside it.
//
// Bass drives the sun and the ground swell, highs drive the grid's brightness. Because
// the analyser sits on the master bus, this responds to the actual output — including
// the bus compressor — which is why the sun breathes on the kick.

const GRID_VERTEX = /* glsl */ `
  uniform float uTime;
  uniform float uBass;
  varying vec2 vUv;
  varying float vDist;

  void main() {
    vUv = uv;
    vec3 pos = position;
    // A slow swell in the floor, deeper when the low end is loud. Rolling hills rather
    // than a flat plane, so the grid has something to describe.
    float ridge = sin(pos.x * 0.18 + uTime * 0.25) * cos(pos.y * 0.13 - uTime * 0.16);
    pos.z += ridge * (1.1 + uBass * 3.4) * smoothstep(4.0, 40.0, abs(pos.y));
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
    gl_FragColor = vec4(colour * (0.7 + uHigh), glow);
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

function Scene() {
  const engine = useBox((s) => s.engine)
  const gridRef = useRef<THREE.ShaderMaterial>(null)
  const sunRef = useRef<THREE.ShaderMaterial>(null)
  const sunMesh = useRef<THREE.Mesh>(null)
  const { camera } = useThree()

  const spectrum = useMemo(() => new Uint8Array(1024), [])

  const gridUniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uBass: { value: 0 },
      uHigh: { value: 0 },
      uNear: { value: new THREE.Color('#ff5fc8') },
      uFar: { value: new THREE.Color('#4be0ff') },
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
    let bass = 0
    let high = 0

    const analyser = engine?.analyser
    if (analyser) {
      const bins = Math.min(spectrum.length, analyser.frequencyBinCount)
      analyser.getByteFrequencyData(spectrum.subarray(0, bins) as Uint8Array<ArrayBuffer>)
      // Roughly: the first few bins are the kick's fundamental, the top third is hats
      // and the noise in snares and claps.
      const lowEnd = Math.max(1, Math.floor(bins * 0.035))
      for (let i = 0; i < lowEnd; i++) bass += spectrum[i]
      bass /= lowEnd * 255

      const highStart = Math.floor(bins * 0.55)
      for (let i = highStart; i < bins; i++) high += spectrum[i]
      high /= (bins - highStart) * 255
    }

    // Asymmetric smoothing: snap up on a transient, ease down afterwards. Symmetric
    // smoothing makes every hit look like a slow swell and loses the punch entirely.
    const ease = (current: number, target: number) =>
      target > current ? target : current + (target - current) * Math.min(1, dt * 3.2)

    if (gridRef.current) {
      const u = gridRef.current.uniforms
      u.uTime.value += dt
      u.uBass.value = ease(u.uBass.value, bass)
      u.uHigh.value = ease(u.uHigh.value, high)
    }
    if (sunRef.current) {
      const u = sunRef.current.uniforms
      u.uBass.value = ease(u.uBass.value, bass)
    }
    if (sunMesh.current) {
      const scale = 1 + bass * 0.06
      sunMesh.current.scale.setScalar(scale)
    }

    camera.position.y = 1.15 + bass * 0.22
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

export function Chillwave({ className }: { className?: string }) {
  return (
    <Canvas
      className={className}
      camera={{ fov: 60, position: [0, 1.15, 6], near: 0.1, far: 200 }}
      dpr={[1, 1.75]}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
    >
      <Scene />
    </Canvas>
  )
}
