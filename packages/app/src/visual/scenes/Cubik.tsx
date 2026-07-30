import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useBox } from '../../store'
import { ease, readBands, readLevels } from '../levels'
import { touch } from '../touch'
import { uniformsOf } from '../uniforms'

// Cübik/Olympic: a white room made from the four inks on the single sleeve.
//
// The field is one instanced buffer and one draw call. Its cubes do not simply jump as
// one loudness meter: concentric rings are assigned to logarithmic frequency bands, while
// the low end launches a second wave through the whole floor. A kick moves the landscape,
// a synth note picks out one coloured ring, and a hat catches the top faces.

const SIDE = 27
const COUNT = SIDE * SIDE
const SPACING = 0.64
const BANDS = 12

const CUBE_VERTEX = /* glsl */ `
  precision highp float;

  uniform float uTime;
  uniform float uBass;
  uniform float uHigh;
  uniform float uWarp;
  uniform vec2 uTouch;
  uniform float uBands[${BANDS}];

  attribute vec2 aGrid;
  attribute float aBand;
  attribute float aInk;

  varying vec3 vNormal;
  varying float vInk;
  varying float vEnergy;
  varying float vDepth;

  float bandAt(float lane) {
    float value = uBands[0];
    ${Array.from({ length: BANDS - 1 }, (_, i) => `if (lane > ${(i + 0.5).toFixed(1)}) value = uBands[${i + 1}];`).join('\n    ')}
    return value;
  }

  void main() {
    vec2 centre = (uTouch - 0.5) * vec2(${(SIDE * 0.72).toFixed(1)}, ${(SIDE * -0.72).toFixed(1)}) * uWarp;
    float radius = length(aGrid - centre);
    float lane = bandAt(aBand);

    // Two waves: the spectrum makes persistent rings, the kick sends a sharp front
    // outwards. The latter moves faster when the record gets louder.
    float standing = 0.5 + 0.5 * sin(radius * 0.92 - uTime * 2.1 + aBand * 0.33);
    float travelling = max(0.0, sin(radius * 1.32 - uTime * (4.2 + uBass * 2.4)));
    travelling = pow(travelling, 5.0);
    float energy = lane * (0.4 + standing * 0.75) + uBass * travelling * 0.85;
    // Full-scale analysers are common once the limiter is working. Compress the visual
    // range here so a loud chorus is still a landscape rather than a solid wall.
    energy = min(1.28, energy);

    // A little height while silent keeps this a field of objects rather than a checkerboard.
    float height = 0.22 + energy * 2.35;
    vec3 pos = position;
    pos.y *= height;
    pos.y += height * 0.5;

    // The distorted synth bends the towers rather than merely making them taller. Since
    // the displacement grows up the cube, the feet remain locked to the grid.
    float bend = sin(aGrid.x * 0.71 + aGrid.y * 0.43 + uTime * 2.7);
    pos.x += position.y * bend * energy * 0.22;
    pos.z += position.y * cos(bend * 2.2 + uTime) * energy * 0.13;

    pos.x += aGrid.x * ${SPACING.toFixed(2)};
    pos.z += aGrid.y * ${SPACING.toFixed(2)};

    vec4 view = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * view;

    vNormal = normalize(normalMatrix * normal);
    vInk = aInk;
    vEnergy = energy;
    vDepth = clamp((-view.z - 7.0) / 24.0, 0.0, 1.0);
  }
`

const CUBE_FRAGMENT = /* glsl */ `
  precision highp float;

  uniform float uHigh;
  varying vec3 vNormal;
  varying float vInk;
  varying float vEnergy;
  varying float vDepth;

  void main() {
    vec3 red = vec3(0.91, 0.13, 0.16);
    vec3 blue = vec3(0.08, 0.35, 0.78);
    vec3 yellow = vec3(1.0, 0.66, 0.04);
    vec3 green = vec3(0.03, 0.58, 0.28);

    vec3 ink = red;
    if (vInk > 0.5) ink = blue;
    if (vInk > 1.5) ink = yellow;
    if (vInk > 2.5) ink = green;

    vec3 light = normalize(vec3(-0.45, 0.82, 0.35));
    float face = 0.54 + max(0.0, dot(vNormal, light)) * 0.58;
    float top = pow(max(0.0, vNormal.y), 5.0);
    vec3 colour = ink * face;
    colour = mix(colour, vec3(1.0), top * uHigh * 0.72);
    colour += ink * min(0.28, vEnergy * 0.08);

    // The far rows dissolve into the paper-white room instead of ending at a hard edge.
    vec3 paper = vec3(0.94, 0.93, 0.89);
    colour = mix(colour, paper, smoothstep(0.68, 1.0, vDepth) * 0.72);
    gl_FragColor = vec4(colour, 1.0);
  }
`

function useCubeField() {
  return useMemo(() => {
    const cube = new THREE.BoxGeometry(0.48, 1, 0.48)
    const geometry = new THREE.InstancedBufferGeometry()
    geometry.index = cube.index
    for (const [name, attribute] of Object.entries(cube.attributes)) {
      geometry.setAttribute(name, attribute)
    }

    const grid = new Float32Array(COUNT * 2)
    const bands = new Float32Array(COUNT)
    const inks = new Float32Array(COUNT)
    const half = (SIDE - 1) / 2
    let at = 0

    for (let z = 0; z < SIDE; z++) {
      for (let x = 0; x < SIDE; x++) {
        const gx = x - half
        const gz = z - half
        const radius = Math.hypot(gx, gz)
        grid[at * 2] = gx
        grid[at * 2 + 1] = gz
        bands[at] = Math.floor(radius * 0.9) % BANDS
        // Broad diagonal blocks of colour: ordered like printing ink, not confetti.
        inks[at] = (Math.floor((x + 3) / 5) + Math.floor((z + 2) / 4)) % 4
        at++
      }
    }

    geometry.setAttribute('aGrid', new THREE.InstancedBufferAttribute(grid, 2))
    geometry.setAttribute('aBand', new THREE.InstancedBufferAttribute(bands, 1))
    geometry.setAttribute('aInk', new THREE.InstancedBufferAttribute(inks, 1))
    geometry.instanceCount = COUNT
    geometry.computeBoundingSphere()
    cube.dispose()
    return geometry
  }, [])
}

export function Cubik() {
  const engine = useBox((state) => state.engine)
  const geometry = useCubeField()
  const material = useRef<THREE.ShaderMaterial>(null)
  const elapsed = useRef(0)
  const rawBands = useRef(new Float32Array(BANDS))
  const smoothBands = useRef(new Float32Array(BANDS))
  const { camera } = useThree()

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uBass: { value: 0 },
      uHigh: { value: 0 },
      uWarp: { value: 0 },
      uTouch: { value: new THREE.Vector2(0.5, 0.5) },
      uBands: { value: new Float32Array(BANDS) },
    }),
    [],
  )

  useFrame((_, dt) => {
    const levels = readLevels(engine)
    readBands(engine, rawBands.current)
    elapsed.current += dt * (0.72 + levels.bass * 1.5)

    const u = uniformsOf(material)
    if (!u) return
    u.uTime.value = elapsed.current
    u.uBass.value = ease(u.uBass.value, levels.bass, dt, 4.2)
    u.uHigh.value = ease(u.uHigh.value, levels.high, dt, 6.5)
    u.uWarp.value = touch.energy
    u.uTouch.value.set(touch.x, touch.y)
    for (let i = 0; i < BANDS; i++) {
      smoothBands.current[i] = ease(smoothBands.current[i], rawBands.current[i], dt, 5.2)
    }
    ;(u.uBands.value as Float32Array).set(smoothBands.current)

    const targetX = 7.8 + (touch.x - 0.5) * touch.energy * 3.2
    const targetY = 9.3 + (touch.y - 0.5) * touch.energy * 2.4
    camera.position.x += (targetX - camera.position.x) * Math.min(1, dt * 2.2)
    camera.position.y += (targetY - camera.position.y) * Math.min(1, dt * 2.2)
    camera.position.z = 12.8 - u.uBass.value * 1.1
    camera.lookAt(0, 0.6, -1.8)
    if (camera instanceof THREE.PerspectiveCamera) {
      camera.fov = 46
      camera.far = 80
      camera.updateProjectionMatrix()
    }
    if (material.current) material.current.uniformsNeedUpdate = true
  })

  return (
    <>
      <color attach="background" args={['#efede5']} />
      <fog attach="fog" args={['#efede5', 18, 34]} />
      <mesh geometry={geometry} frustumCulled={false}>
        <shaderMaterial
          ref={material}
          uniforms={uniforms}
          vertexShader={CUBE_VERTEX}
          fragmentShader={CUBE_FRAGMENT}
        />
      </mesh>
    </>
  )
}
