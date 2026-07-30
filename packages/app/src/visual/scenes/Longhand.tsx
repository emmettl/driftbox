import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { sceneAudio } from '../audio'
import { ease, readLevels } from '../levels'
import { touch, touchSamplesAfter } from '../touch'

// Longhand.
//
// Most Driftbox scenes treat a touch as a force: material bends, turns or gathers under
// the finger, then returns to what it was. This one makes the opposite promise. The empty
// stave belongs to the player. Every drag lays a piece of luminous tubing into the scene,
// and lifting a finger commits it. The mark remains until the scene is left.
//
// The music does not redraw the gesture. It reads it: a small playhead travels the route,
// bass blooms its halo and high frequencies sharpen the ink. That distinction matters.
// If the track were allowed to change the shape, the drawing would stop feeling authored
// as soon as the finger lifted.

const MAX_STROKES = 12
const MAX_POINTS = 180
const SAMPLE_GAP = 0.045
const CORE_RADIUS = 0.025
const HALO_RADIUS = 0.09
const COLOURS = ['#ff4f87', '#ffb347', '#77f2d0', '#62b7ff', '#d58cff', '#f8f3dc']
const WHITE = new THREE.Color('#ffffff')

interface Stroke {
  points: THREE.Vector3[]
  curve: THREE.CatmullRomCurve3 | null
  core: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>
  halo: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>
  tip: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>
  reader: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>
  colour: THREE.Color
}

function tube(points: THREE.Vector3[], radius: number): THREE.BufferGeometry {
  if (points.length < 2) return new THREE.BufferGeometry()
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal')
  return new THREE.TubeGeometry(curve, Math.max(8, points.length * 2), radius, 6, false)
}

function disposeStroke(stroke: Stroke): void {
  stroke.core.geometry.dispose()
  stroke.halo.geometry.dispose()
  stroke.core.material.dispose()
  stroke.halo.material.dispose()
  stroke.tip.material.dispose()
  stroke.reader.material.dispose()
  // tip and reader share one sphere within the stroke.
  stroke.tip.geometry.dispose()
}

/**
 * Put the finger on the plane the tubes occupy.
 *
 * The camera stays square to that plane, so this is the perspective projection written
 * backwards rather than a guessed world width. It is direct in portrait as well as
 * landscape: the centre of the fingertip and the centre of the new tube coincide.
 */
function pointOnPage(camera: THREE.PerspectiveCamera, x: number, y: number): THREE.Vector3 {
  const distance = camera.position.z
  const height = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * distance
  const width = height * camera.aspect
  return new THREE.Vector3((x - 0.5) * width, (y - 0.5) * height, 0)
}

function useDust(): THREE.BufferGeometry {
  return useMemo(() => {
    // Deterministic rather than random at mount: returning to the scene should feel like
    // returning to the same sheet, not loading a new backdrop.
    let seed = 0.314159
    const random = () => {
      seed = (seed * 9301 + 0.49297) % 1
      return seed
    }
    const positions = new Float32Array(120 * 3)
    for (let i = 0; i < positions.length; i += 3) {
      positions[i] = (random() - 0.5) * 24
      positions[i + 1] = (random() - 0.5) * 18
      positions[i + 2] = -0.6 - random() * 4
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    return geometry
  }, [])
}

export function Longhand() {
  const { camera, gl } = useThree()
  const page = useRef<THREE.Group>(null)
  const dust = useRef<THREE.Points>(null)
  const strokes = useRef<Stroke[]>([])
  const current = useRef<Stroke | null>(null)
  // Start at the current serial so entering Longhand does not redraw a gesture made in
  // the previous scene. From here on, consume every pointer-rate sample, not one position
  // per rendered frame.
  const lastSample = useRef(touch.serial)
  const gesture = useRef(touch.gesture)
  const time = useRef(0)
  const bass_ = useRef(0)
  const high_ = useRef(0)
  const dustGeometry = useDust()
  const drawingBuffer = useMemo(() => new THREE.Vector2(), [])

  const startStroke = () => {
    const colour = new THREE.Color(COLOURS[strokes.current.length % COLOURS.length])
    const sphere = new THREE.SphereGeometry(0.075, 12, 8)
    const core = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({ color: colour, depthWrite: false }),
    )
    const halo = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({
        color: colour,
        transparent: true,
        opacity: 0.12,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    )
    const tip = new THREE.Mesh(
      sphere,
      new THREE.MeshBasicMaterial({ color: colour, depthWrite: false }),
    )
    const reader = new THREE.Mesh(
      sphere,
      new THREE.MeshBasicMaterial({
        color: '#ffffff',
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    )
    reader.visible = false

    const stroke: Stroke = { points: [], curve: null, core, halo, tip, reader, colour }
    strokes.current.push(stroke)
    current.current = stroke
    page.current?.add(halo, core, tip, reader)

    if (strokes.current.length > MAX_STROKES) {
      const old = strokes.current.shift()
      if (old) {
        page.current?.remove(old.core, old.halo, old.tip, old.reader)
        disposeStroke(old)
      }
    }
  }

  const appendPoint = (point: THREE.Vector3) => {
    const stroke = current.current
    if (!stroke || stroke.points.length >= MAX_POINTS) return
    const previous = stroke.points.at(-1)
    if (previous && previous.distanceTo(point) < SAMPLE_GAP) return

    stroke.points.push(point)
    stroke.tip.position.copy(point)
    if (stroke.points.length < 2) return

    stroke.curve = new THREE.CatmullRomCurve3(stroke.points, false, 'centripetal')
    stroke.core.geometry.dispose()
    stroke.halo.geometry.dispose()
    stroke.core.geometry = tube(stroke.points, CORE_RADIUS)
    stroke.halo.geometry = tube(stroke.points, HALO_RADIUS)
    stroke.reader.visible = true
  }

  useEffect(
    () => () => {
      for (const stroke of strokes.current) disposeStroke(stroke)
      strokes.current.length = 0
      dustGeometry.dispose()
    },
    [dustGeometry],
  )

  useFrame((_, dt) => {
    const cam = camera as THREE.PerspectiveCamera
    cam.position.set(0, 0, 9)
    cam.lookAt(0, 0, 0)
    cam.updateProjectionMatrix()

    // A gesture id starts a new piece of ink; all its pointer-rate samples extend that
    // stroke. Release commits it simply by ceasing to append. No decay, no timer and no
    // hidden "settle" phase: what was drawn is now part of the scene.
    for (const sample of touchSamplesAfter(lastSample.current)) {
      if (sample.gesture !== gesture.current) {
        gesture.current = sample.gesture
        startStroke()
      }
      appendPoint(pointOnPage(cam, sample.x, sample.y))
      lastSample.current = sample.serial
    }
    if (!touch.down) current.current = null

    const { bass, high } = readLevels(sceneAudio.analyser)
    bass_.current = ease(bass_.current, bass, dt, 2.8)
    high_.current = ease(high_.current, high, dt, 5)
    if (sceneAudio.running) time.current += dt

    const beat = time.current * (sceneAudio.bpm / 60)
    strokes.current.forEach((stroke, index) => {
      stroke.halo.material.opacity = 0.08 + bass_.current * 0.2
      stroke.core.material.color.lerpColors(stroke.colour, WHITE, high_.current * 0.35)
      stroke.tip.scale.setScalar(0.7 + high_.current * 0.7)

      if (stroke.curve) {
        // One traversal every four beats. Offsetting the strokes turns several marks into
        // a score being read in canon rather than a row of identical progress indicators.
        const at = (beat / 4 + index / Math.max(1, strokes.current.length)) % 1
        stroke.reader.position.copy(stroke.curve.getPointAt(at))
        stroke.reader.scale.setScalar(0.7 + bass_.current * 1.5 + high_.current * 0.8)
      }
    })

    const dustMaterial = dust.current?.material
    if (dustMaterial instanceof THREE.PointsMaterial) {
      gl.getDrawingBufferSize(drawingBuffer)
      dustMaterial.size = Math.max(1.2, drawingBuffer.y / 900) * (1.2 + high_.current * 1.8)
      dustMaterial.opacity = 0.18 + high_.current * 0.18
    }
  })

  return (
    <>
      <color attach="background" args={['#03040a']} />
      <fog attach="fog" args={['#03040a', 10, 18]} />

      {/* A page rather than a void. It is deliberately quiet until somebody writes. */}
      <gridHelper
        args={[30, 30, '#091326', '#091326']}
        rotation={[Math.PI / 2, 0, 0]}
        position={[0, 0, -1.2]}
      />
      <points ref={dust} geometry={dustGeometry}>
        <pointsMaterial
          color="#6da7db"
          size={1.4}
          sizeAttenuation={false}
          transparent
          opacity={0.2}
          depthWrite={false}
        />
      </points>
      <group ref={page} />
    </>
  )
}
