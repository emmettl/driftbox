import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { sceneAudio } from './audio'
import { ease, readBands } from './levels'
import { touch } from './touch'
import { uniformsOf } from './uniforms'


/** Bind the same audio signals to a custom material, including instanced geometry. */
export function useSurfaceMaterial() {
  const material = useRef<THREE.ShaderMaterial>(null)
  const { size } = useThree()
  const bands = useMemo(() => new Float32Array(8), [])
  const detector = useRef({ previous: 0, last: -1, next: 0 })
  const uniforms = useMemo(() => ({
    uSize: { value: new THREE.Vector2(1, 1) },
    uTime: { value: 0 }, uTravel: { value: 0 }, uBeat: { value: 0 },
    uBass: { value: 0 }, uMid: { value: 0 }, uHigh: { value: 0 },
    uTouch: { value: new THREE.Vector3(0.5, 0.5, 0) },
    uHits: { value: Array.from({ length: 8 }, () => new THREE.Vector2(-100, 0)) },
  }), [])

  useFrame((_, delta) => {
    const u = uniformsOf(material)
    if (!u) return
    const dt = Math.min(delta, 0.1)
    readBands(sceneAudio.analyser, bands)
    const bass = (bands[0] + bands[1] + bands[2]) / 3
    const mid = (bands[3] + bands[4] + bands[5]) / 3
    const high = (bands[6] + bands[7]) / 2
    u.uTime.value += dt
    if (sceneAudio.running) {
      u.uTravel.value += dt
      u.uBeat.value += dt * sceneAudio.bpm / 60
    }
    u.uSize.value.set(size.width, size.height)
    u.uBass.value = ease(u.uBass.value, bass, dt)
    u.uMid.value = ease(u.uMid.value, mid, dt)
    u.uHigh.value = ease(u.uHigh.value, high, dt, 6)
    u.uTouch.value.set(touch.x, touch.y, touch.energy)
    const hit = detector.current
    if (sceneAudio.running && mid - hit.previous > 0.025 && u.uTime.value - hit.last > 0.14) {
      u.uHits.value[hit.next].set(u.uTime.value, Math.min(1, mid * 2))
      hit.next = (hit.next + 1) % 8
      hit.last = u.uTime.value
    }
    hit.previous += (mid - hit.previous) * Math.min(1, dt * 12)
  })

  return { material, uniforms }
}
