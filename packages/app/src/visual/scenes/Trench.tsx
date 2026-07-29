import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useBox } from '../../store'
import { ease, readLevels } from '../levels'
import { touch } from '../touch'
import { uniformsOf } from '../uniforms'

// The trench run, after Atari's vector Star Wars cabinet.
//
// This is the only scene with a SEQUENCE. The other four are steady states you drop into;
// this one arrives at a battle station, dives, and then stays down. That progression only
// starts once the music does — press play and it goes, which is what makes it feel like
// the cabinet's attract mode ending rather than an animation on a timer.
//
// Three parts, and they are deliberately different kinds of thing:
//
//   THE STATION  a wireframe sphere ahead, growing, then gone past you.
//   THE TRENCH   two walls and a floor scrolling at you, pulsing on the kick, with
//                greebles bolted along them — the clutter is what makes a corridor read
//                as a place that was built rather than as three planes.
//   THE GUNS     four cannons at the corners of the screen, converging on wherever your
//                finger is. Only while you are touching, because a gun that fires on its
//                own is a screensaver.

// Sized against the canvas's 200-unit far plane. A 220-deep trench put its far end past
// the clip plane, and since a corridor 14 wide converges to a dot long before that, the
// whole thing was a speck at the vanishing point. Everything you can see is now inside
// the frustum.
const TRENCH_LENGTH = 140
/** Rungs along the trench. Each is a floor line plus two wall uprights. */
const RUNGS = 70
const HALF_WIDTH = 7
/** Tall enough to be a canyon. The camera sits at y=4, so the walls rise well overhead
 *  and the strip of black above them is the sky — which is the shape of the trench shot. */
const WALL_HEIGHT = 15

const SCENE_VERTEX = /* glsl */ `
  uniform float uTime;
  uniform float uBass;
  uniform float uApproach;
  uniform float uWarp;
  uniform vec2 uTouch;
  attribute float aDepth;
  attribute float aKind;
  varying float vFade;
  varying float vKind;

  void main() {
    vec3 pos = position;

    // Travel. Everything slides at the camera and wraps at the near end. The +14 puts the
    // wrap point *behind* you rather than a few metres in front of your face, so rungs
    // leave the frame past your shoulder instead of vanishing where you can see them.
    float z = mod(aDepth + uTime, ${TRENCH_LENGTH.toFixed(1)});
    pos.z = z - ${TRENCH_LENGTH.toFixed(1)} + 14.0;

    // The walls breathe on the low end. Wider on a kick, so the trench pumps.
    pos.x *= 1.0 + uBass * 0.2;
    pos.y *= 1.0 + uBass * 0.12;

    // Banking. The trench leans away from the finger, which is what a ship pulling
    // sideways would look like from inside it.
    float lean = (uTouch.x - 0.5) * uWarp;
    pos.x -= lean * 9.0;
    pos.y -= (uTouch.y - 0.5) * uWarp * 5.0;

    // The trench does not exist until the dive. Sunk below the camera at the start and
    // raised into place as the approach completes, so it arrives rather than fades.
    pos.y -= (1.0 - uApproach) * 42.0;

    // Fog, per vertex. "far" is 0 at the vanishing point and 1 at the camera, so this is
    // bright along the near two-thirds, fading into the distance at one end and out over
    // your shoulder at the other. Getting this backwards — which is easy, because the
    // wrap makes the near end the HIGH value — leaves the only lit geometry a hundred
    // metres away and the trench you are actually inside completely transparent.
    float far = z / ${TRENCH_LENGTH.toFixed(1)};
    vFade = smoothstep(0.02, 0.35, far) * (1.0 - smoothstep(0.72, 0.95, far)) * uApproach;
    vKind = aKind;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`

const SCENE_FRAGMENT = /* glsl */ `
  precision highp float;
  uniform float uHigh;
  varying float vFade;
  varying float vKind;

  void main() {
    if (vFade < 0.01) discard;
    // Structure is pale blue-white, like a vector monitor's phosphor; the greebles are
    // warmer, so the clutter separates from the walls it is bolted to.
    vec3 structure = vec3(0.62, 0.86, 1.0);
    vec3 greeble = vec3(1.0, 0.72, 0.45);
    vec3 colour = mix(structure, greeble, vKind);
    gl_FragColor = vec4(colour * (0.75 + uHigh * 0.9), vFade * (0.55 + uHigh * 0.45));
  }
`

/**
 * The trench, plus its clutter, in one buffer.
 *
 * Deterministic pseudo-random rather than Math.random: the greebles need to be in the
 * same place every time the scene mounts, or switching away and back rebuilds a different
 * trench and it stops being a place.
 */
function useTrench() {
  return useMemo(() => {
    const positions: number[] = []
    const depths: number[] = []
    const kinds: number[] = []

    let seed = 1337
    const random = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296
      return seed / 4294967296
    }

    const line = (
      ax: number, ay: number, bx: number, by: number, depth: number, kind: number,
      depthB = depth,
    ) => {
      positions.push(ax, ay, 0, bx, by, 0)
      depths.push(depth, depthB)
      kinds.push(kind, kind)
    }

    for (let i = 0; i < RUNGS; i++) {
      const z = (i / RUNGS) * TRENCH_LENGTH
      const next = ((i + 1) / RUNGS) * TRENCH_LENGTH

      // Floor across, and an upright on each wall.
      line(-HALF_WIDTH, 0, HALF_WIDTH, 0, z, 0)
      line(-HALF_WIDTH, 0, -HALF_WIDTH, WALL_HEIGHT, z, 0)
      line(HALF_WIDTH, 0, HALF_WIDTH, WALL_HEIGHT, z, 0)

      // Rails running the length, at the floor line and the wall tops. These are what
      // give the speed something continuous to read against.
      //
      // Not on the last rung: its far end would land on TRENCH_LENGTH exactly, the mod
      // would wrap it to zero, and the rail would be drawn as a single line stretching the
      // entire trench — one bright streak through the middle of the scene, every frame.
      if (i < RUNGS - 1) {
        for (const [x, y] of [[-HALF_WIDTH, 0], [HALF_WIDTH, 0], [-HALF_WIDTH, WALL_HEIGHT], [HALF_WIDTH, WALL_HEIGHT]]) {
          line(x, y, x, y, z, 0, next)
        }
      }

      // Greebles: a box bolted to one wall, every few rungs. Drawn as an outline rather
      // than a solid, because everything else here is a line and a filled shape would
      // look like a different scene.
      if (random() < 0.34 && z + 6 < TRENCH_LENGTH) {
        const side = random() < 0.5 ? -1 : 1
        const base = random() * (WALL_HEIGHT - 2.5)
        const h = 0.9 + random() * 2.2
        const d = 1.5 + random() * 4
        const out = 0.5 + random() * 1.6
        const x = HALF_WIDTH * side
        const xi = x - out * side

        line(x, base, xi, base, z, 1)
        line(x, base + h, xi, base + h, z, 1)
        line(xi, base, xi, base + h, z, 1)
        line(xi, base, xi, base, z, 1, z + d)
        line(xi, base + h, xi, base + h, z, 1, z + d)
        line(x, base, xi, base, z + d, 1)
        line(x, base + h, xi, base + h, z + d, 1)
        line(xi, base, xi, base + h, z + d, 1)
      }
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geometry.setAttribute('aDepth', new THREE.Float32BufferAttribute(depths, 1))
    geometry.setAttribute('aKind', new THREE.Float32BufferAttribute(kinds, 1))
    return geometry
  }, [])
}

const STATION_RADIUS = 30

/** Segments per laser beam. Enough to bend smoothly, few enough to rewrite every frame. */
const BEAM_SEGMENTS = 7
/**
 * Strands per beam.
 *
 * WebGL will not draw a line wider than one pixel, so a beam drawn as a single chain is a
 * hairline however bright the colour. Three chains side by side, hue-split, give it both
 * body and a prismatic edge — thickness and trippiness out of the same trick.
 */
const BEAM_STRANDS = [-1, 0, 1]
/** How far in front of the camera the cannons sit. Only the frame they define matters. */
const MUZZLE_DIST = 3

/** GLSL's smoothstep, for the parts of the sequence that are driven from JS. */
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

/** The battle station: a wireframe globe. */
function useStation() {
  return useMemo(() => {
    const sphere = new THREE.SphereGeometry(STATION_RADIUS, 22, 14)
    const wire = new THREE.WireframeGeometry(sphere)
    sphere.dispose()
    return wire
  }, [])
}

/**
 * The two details that make a wireframe sphere read as *that* battle station: the band
 * running round its equator, and the dish set into the northern hemisphere.
 *
 * Both are built as explicit line lists. A `ringGeometry` rendered through `lineSegments`
 * looks like a ring in the editor and like a handful of disconnected dashes on screen,
 * because it is a triangle list and the segments get taken from whatever vertex pairs the
 * index buffer happens to put next to each other.
 */
function useStationDetail() {
  return useMemo(() => {
    const positions: number[] = []
    const seg = (ax: number, ay: number, az: number, bx: number, by: number, bz: number) =>
      positions.push(ax, ay, az, bx, by, bz)

    // The equatorial band — and the reason it is here rather than being decoration: it is
    // the trench. You are about to be inside this line.
    const N = 64
    for (const lift of [-1.1, 1.1]) {
      for (let i = 0; i < N; i++) {
        const a = (i / N) * Math.PI * 2
        const b = ((i + 1) / N) * Math.PI * 2
        const r = STATION_RADIUS * 1.002
        seg(Math.cos(a) * r, lift, Math.sin(a) * r, Math.cos(b) * r, lift, Math.sin(b) * r)
      }
    }

    // The dish, sunk into the upper hemisphere and turned to face out of it. Concentric
    // rings plus spokes, which is how a vector machine would have drawn a crater.
    const lat = 0.62
    const lon = -0.35
    const normal = new THREE.Vector3(
      Math.cos(lat) * Math.sin(lon),
      Math.sin(lat),
      Math.cos(lat) * Math.cos(lon),
    )
    const centre = normal.clone().multiplyScalar(STATION_RADIUS * 0.94)
    const right = new THREE.Vector3(0, 1, 0).cross(normal).normalize()
    const up = normal.clone().cross(right).normalize()
    const at = (radius: number, angle: number, sink: number) =>
      centre
        .clone()
        .addScaledVector(right, Math.cos(angle) * radius)
        .addScaledVector(up, Math.sin(angle) * radius)
        .addScaledVector(normal, -sink)

    for (const [radius, sink] of [[9, 0], [5.6, 1.6], [2.4, 2.6]]) {
      for (let i = 0; i < 26; i++) {
        const a = (i / 26) * Math.PI * 2
        const b = ((i + 1) / 26) * Math.PI * 2
        const p = at(radius, a, sink)
        const q = at(radius, b, sink)
        seg(p.x, p.y, p.z, q.x, q.y, q.z)
      }
    }
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2
      const p = at(9, a, 0)
      const q = at(2.4, a, 2.6)
      seg(p.x, p.y, p.z, q.x, q.y, q.z)
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    return geometry
  }, [])
}

export function Trench() {
  const engine = useBox((s) => s.engine)
  const running = useBox((s) => s.running)
  const trench = useTrench()
  const station = useStation()
  const detail = useStationDetail()
  const material = useRef<THREE.ShaderMaterial>(null)
  const stationRef = useRef<THREE.Group>(null)
  const hull = useRef<THREE.LineBasicMaterial>(null)
  const trim = useRef<THREE.LineBasicMaterial>(null)
  const lasers = useRef<THREE.LineSegments>(null)
  const { camera } = useThree()

  const travelled = useRef(0)
  const approach = useRef(0)

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uBass: { value: 0 },
      uHigh: { value: 0 },
      uApproach: { value: 0 },
      uWarp: { value: 0 },
      uTouch: { value: new THREE.Vector2(0.5, 0.5) },
    }),
    [],
  )

  // Four beams, each drawn as a chain of short segments so it can bend. A cannon shot as
  // one straight segment is a ruled line; the wobble is what makes it read as energy.
  const laserGeometry = useMemo(() => {
    const g = new THREE.BufferGeometry()
    const verts = 4 * BEAM_STRANDS.length * BEAM_SEGMENTS * 2
    g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(verts * 3), 3))
    g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(verts * 3), 3))
    return g
  }, [])

  // Scratch, so aiming four beams a frame does not allocate.
  const scratch = useMemo(
    () => ({
      muzzle: new THREE.Vector3(),
      target: new THREE.Vector3(),
      point: new THREE.Vector3(),
      dir: new THREE.Vector3(),
      perp: new THREE.Vector3(),
      colour: new THREE.Color(),
    }),
    [],
  )
  const clock = useRef(0)

  useFrame((_, dt) => {
    const { bass, high } = readLevels(engine)
    const warp = touch.energy
    // The material's own uniforms, not the memoised object — see uniforms.ts.
    const u = uniformsOf(material)
    if (!u) return

    // The dive only happens once the music does. Before that you are holding station.
    if (running) approach.current = Math.min(1, approach.current + dt * 0.2)
    const dive = approach.current

    clock.current += dt
    travelled.current += dt * (30 + bass * 46) * dive
    u.uTime.value = travelled.current
    u.uBass.value = ease(u.uBass.value, bass, dt, 5)
    u.uHigh.value = ease(u.uHigh.value, high, dt, 6)
    u.uApproach.value = dive
    u.uWarp.value = warp
    u.uTouch.value.set(touch.x, touch.y)

    // The station starts far off and ends up behind you, which is the dive. Both ends of
    // that travel have to stay inside the canvas's 200-unit far plane or the thing the
    // scene opens on is simply clipped away and you get a black screen until the music
    // starts — which is exactly what it did at -320.
    if (stationRef.current) {
      stationRef.current.position.set(0, 15 - dive * 30, -152 + dive * dive * 196)
      stationRef.current.rotation.y += dt * 0.05
      stationRef.current.visible = dive < 0.95
      // Cross-dissolved against the trench rising into place, rather than both running at
      // full strength through the middle of the dive. Without this there is a stretch
      // where a sphere thirty across is directly on top of the corridor and the frame is
      // two scenes at once — the station has to be on its way out as the trench arrives.
      const clear = 1 - smoothstep(0.5, 0.95, dive)
      if (hull.current) hull.current.opacity = 0.55 * clear
      if (trim.current) trim.current.opacity = 0.95 * clear
    }

    // Four cannons at the corners of the screen, converging on the finger.
    //
    // Both ends are derived from the camera rather than written down. A muzzle at a fixed
    // offset is in the corner on the viewport you happened to test and somewhere off the
    // edge on every other one, and a target at a guessed depth lands near the finger
    // instead of on it — the beams have to actually meet under the fingertip or the whole
    // gesture reads as decoration.
    const firing = warp > 0.01 && dive > 0.4
    if (lasers.current) lasers.current.visible = firing
    if (firing) {
      const cam = camera as THREE.PerspectiveCamera
      const { muzzle, target, point, dir, perp, colour } = scratch
      const halfH = Math.tan((cam.fov * Math.PI) / 360) * MUZZLE_DIST
      const halfW = halfH * cam.aspect

      // Straight out of the screen through the fingertip, then 70 units down that ray.
      target
        .set(touch.x * 2 - 1, touch.y * 2 - 1, 0.5)
        .unproject(cam)
        .sub(cam.position)
        .normalize()
        .multiplyScalar(70)
        .add(cam.position)

      const pos = laserGeometry.getAttribute('position') as THREE.BufferAttribute
      const col = laserGeometry.getAttribute('color') as THREE.BufferAttribute
      let v = 0
      for (let c = 0; c < 4; c++) {
        muzzle.set(c % 2 ? halfW : -halfW, c < 2 ? -halfH : halfH, -MUZZLE_DIST)
        cam.localToWorld(muzzle)
        // Sideways, for the strand offsets — across the beam rather than across the world,
        // so a beam aimed into a corner is as thick as one aimed straight ahead.
        dir.subVectors(target, muzzle).normalize()
        perp.crossVectors(dir, cam.up).normalize()
        // A different hue per cannon, all four drifting. Four red lines are a diagram.
        const hue = (c / 4 + clock.current * 0.12) % 1

        for (const strand of BEAM_STRANDS) {
          colour.setHSL((hue + strand * 0.045 + 1) % 1, 1, strand === 0 ? 0.72 : 0.55)
          for (let s = 0; s < BEAM_SEGMENTS; s++) {
            for (const t of [s / BEAM_SEGMENTS, (s + 1) / BEAM_SEGMENTS]) {
              point.lerpVectors(muzzle, target, t)
              // Wobble and spread, both widest mid-flight and zero at either end, so the
              // beam still leaves the corner and still lands exactly on the finger.
              const w = Math.sin(t * Math.PI)
              point.addScaledVector(perp, strand * w * 0.5)
              point.x += Math.sin(t * 13 + clock.current * 11 + c * 1.7) * w * 0.9
              point.y += Math.cos(t * 9 + clock.current * 8 + c * 2.3) * w * 0.9
              pos.setXYZ(v, point.x, point.y, point.z)
              col.setXYZ(v, colour.r, colour.g, colour.b)
              v++
            }
          }
        }
      }
      pos.needsUpdate = true
      col.needsUpdate = true
    }

    camera.position.x = (touch.x - 0.5) * 2.4 * warp
    camera.position.y = 3.2 - bass * 0.5 + (touch.y - 0.5) * 1.6 * warp
    camera.position.z = 4
    camera.rotation.z += ((touch.x - 0.5) * -0.35 * warp - camera.rotation.z) * Math.min(1, dt * 3)
    if (material.current) material.current.uniformsNeedUpdate = true
  })

  return (
    <>
      <color attach="background" args={['#01010a']} />

      <group ref={stationRef}>
        <lineSegments geometry={station}>
          <lineBasicMaterial ref={hull} color="#8fa8c0" transparent opacity={0.55} blending={THREE.AdditiveBlending} />
        </lineSegments>
        {/* Equator and dish, brighter than the hull so they read at distance. */}
        <lineSegments geometry={detail}>
          <lineBasicMaterial ref={trim} color="#cfe6ff" transparent opacity={0.95} blending={THREE.AdditiveBlending} />
        </lineSegments>
      </group>

      {/* Same reason: the vertex shader puts this geometry a hundred metres from where
          its bounding sphere says it is. */}
      <lineSegments geometry={trench} frustumCulled={false}>
        <shaderMaterial
          ref={material}
          uniforms={uniforms}
          vertexShader={SCENE_VERTEX}
          fragmentShader={SCENE_FRAGMENT}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </lineSegments>

      {/* Culling off: the vertices are rewritten every frame, so the bounding sphere
          three computed once is describing a shape that no longer exists. */}
      <lineSegments ref={lasers} geometry={laserGeometry} frustumCulled={false}>
        <lineBasicMaterial vertexColors transparent opacity={0.95} blending={THREE.AdditiveBlending} />
      </lineSegments>
    </>
  )
}
