import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useBox } from '../../store'
import { ease, readLevels } from '../levels'
import { touch } from '../touch'
import { uniformsOf } from '../uniforms'

// The trench run, after Atari's vector Star Wars cabinet.
//
// The trench IS the station's equatorial groove. That sentence is the whole scene, and it
// took three goes to arrive at it.
//
// The first version had a straight corridor and a separate sphere, and faded the corridor
// up as the music started — a cross-fade dressed as a move. The second flew the camera down
// into the corridor rather than raising the corridor, which is a real move but still a move
// toward a different object: you were diving at a canyon that happened to be near a battle
// station. Both are the same mistake. A dive into something has to be a dive into THAT
// thing, so the groove is now cut into the sphere — the hull's latitude rings stop at the
// trench lip, the floor is a ring of its own at a smaller radius, and flying down it is
// flying around the station's equator.
//
// Two things fall straight out of that, and both are improvements:
//
//   - There is no scrolling and no wrapping. The trench is a closed ring, so travelling is
//     an angle going up. The old version slid geometry past a stationary camera and wrapped
//     it with a modulo, which is where its worst bug lived — the fog was computed from that
//     wrapped depth and came out inside out, lighting the far end and leaving the corridor
//     you were actually inside completely transparent.
//   - From orbit the groove is visible on the hull as a band missing from the sphere, so
//     the thing you are about to dive into is the thing you can already see.
//
// The station has to be big for its floor to read as a canyon rather than a bowl, and big
// means the far plane has to move. The canvas ships 200 for everybody; this scene pushes
// its own camera to 1400, which is safe because the canvas is keyed on the scene and hands
// each one a fresh camera.

// The station is very large, and that is the whole reason the trench looks straight.
//
// Curvature over the visible stretch is just arc length over radius. At 420 the hundred and
// fifty units you can see ahead bend through seventeen degrees, and the floor visibly rolls
// away like the inside of a barrel. At 3200 the same stretch bends through three, which is
// what the cabinet's trench does — it converges to a vanishing point and does not curl.
// Flat is not a shading choice here; it is a radius.
const STATION_RADIUS = 3200
const TRENCH_HALF_WIDTH = 30
const TRENCH_DEPTH = 46
const FLOOR_RADIUS = STATION_RADIUS - TRENCH_DEPTH
/** Cross-sections around the full ring. At this radius that is a rib every seven units —
 *  closer together and the walls stop reading as ribs and become a solid sheet of lines. */
const RIBS = 2870
/** Where the run starts, as a distance from the station's centre. */
const ORBIT_RADIUS = 7400
const ORBIT_HEIGHT = 1750
/** How high above the trench floor the ship ends up flying. */
const FLY_HEIGHT = 14
/** How far round the station the approach swings before the dive, in radians. The camera
 *  arcs through this and arrives at the trench entry, which is what carries the dish past
 *  the frame instead of welding it to face wherever the run happens to start. */
const APPROACH_SWEEP = 1.15
/** The lens. Wide in orbit, so the whole station fits; long in the trench, where a narrow
 *  angle stops the near walls splaying out at the frame edges. */
const ORBIT_FOV = 60
const TRENCH_FOV = 46

/** Far enough to see the whole station. The canvas default of 200 would clip it in half
 *  before it had finished appearing. Depth precision does not suffer for it: everything
 *  here is additive lines with depth writes off, so there is nothing to z-fight. */
const FAR_PLANE = 10500

const SCENE_VERTEX = /* glsl */ `
  uniform float uBass;
  uniform float uWarp;
  uniform vec2 uTouch;
  /** Where the fog starts and ends, in world units. */
  uniform vec2 uFog;
  attribute float aKind;
  varying float vFade;
  varying float vKind;

  void main() {
    vec3 pos = position;

    // The station breathes on the low end. Radially — on a ring, "wider" means further
    // from the axis, so x and z scale together and the groove stays a groove.
    pos.xz *= 1.0 + uBass * 0.012;

    // Banking. The trench leans away from the finger, which is what a ship pulling
    // sideways would look like from inside it.
    pos.y -= (uTouch.y - 0.5) * uWarp * 6.0;

    vec4 view = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * view;

    // Fog by actual distance, which is only possible because the geometry stands still.
    //
    // Its range travels with the dive, and it has to. Tuned for being INSIDE the groove —
    // gone by four hundred units — it makes the whole station invisible from orbit, where
    // the nearest hull is six hundred units away and the far side is fourteen hundred.
    // One fixed range cannot serve a shot that starts a kilometre out and ends in a ditch.
    float dist = -view.z;
    vFade = 1.0 - smoothstep(uFog.x, uFog.y, dist);
    vKind = aKind;
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
    gl_FragColor = vec4(colour * (0.75 + uHigh * 0.9), vFade * (0.6 + uHigh * 0.4));
  }
`

/** A point on the station: an angle round the equator, a height along its axis, and a
 *  distance from that axis. Everything here is built in these three. */
function at(angle: number, y: number, radius: number): [number, number, number] {
  return [Math.cos(angle) * radius, y, Math.sin(angle) * radius]
}

/**
 * The hull, the groove cut into it, the clutter bolted to its walls and the dish — one
 * buffer, one draw call, because they are all the same station.
 *
 * Deterministic pseudo-random rather than Math.random: the greebles have to be in the same
 * place every time the scene mounts, or switching away and back rebuilds a different
 * station and it stops being a place.
 */
function useStation() {
  return useMemo(() => {
    const positions: number[] = []
    const kinds: number[] = []
    let seed = 1337
    const random = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296
      return seed / 4294967296
    }
    const line = (a: [number, number, number], b: [number, number, number], kind: number) => {
      positions.push(a[0], a[1], a[2], b[0], b[1], b[2])
      kinds.push(kind, kind)
    }

    // --- The groove.
    for (let i = 0; i < RIBS; i++) {
      const ang = (i / RIBS) * Math.PI * 2
      const next = ((i + 1) / RIBS) * Math.PI * 2

      // Floor across, and an upright up each wall to the lip.
      line(at(ang, -TRENCH_HALF_WIDTH, FLOOR_RADIUS), at(ang, TRENCH_HALF_WIDTH, FLOOR_RADIUS), 0)
      line(at(ang, -TRENCH_HALF_WIDTH, FLOOR_RADIUS), at(ang, -TRENCH_HALF_WIDTH, STATION_RADIUS), 0)
      line(at(ang, TRENCH_HALF_WIDTH, FLOOR_RADIUS), at(ang, TRENCH_HALF_WIDTH, STATION_RADIUS), 0)

      // Rails running the length, at the floor line and along both lips — what gives the
      // speed something continuous to read against. No special case at the join: a ring
      // has no last rib, which is one of the things that got simpler.
      for (const [y, r] of [
        [-TRENCH_HALF_WIDTH, FLOOR_RADIUS],
        [TRENCH_HALF_WIDTH, FLOOR_RADIUS],
        [-TRENCH_HALF_WIDTH, STATION_RADIUS],
        [TRENCH_HALF_WIDTH, STATION_RADIUS],
      ] as const) {
        line(at(ang, y, r), at(next, y, r), 0)
      }

      // Greebles: a box bolted to one wall, every few ribs. An outline rather than a solid,
      // because everything else here is a line and a filled shape would look imported.
      if (random() < 0.09) {
        const side = random() < 0.5 ? -1 : 1
        const y = side * TRENCH_HALF_WIDTH
        const base = FLOOR_RADIUS + random() * (TRENCH_DEPTH - 6)
        const tall = 1.5 + random() * 4.5
        const inner = y - (1.2 + random() * 3.5) * side
        const a2 = ang + (1.5 + random() * 4) / STATION_RADIUS
        for (const t of [ang, a2]) {
          line(at(t, y, base), at(t, inner, base), 1)
          line(at(t, y, base + tall), at(t, inner, base + tall), 1)
          line(at(t, inner, base), at(t, inner, base + tall), 1)
        }
        line(at(ang, inner, base), at(a2, inner, base), 1)
        line(at(ang, inner, base + tall), at(a2, inner, base + tall), 1)
      }
    }

    // --- The hull, stopping at the trench lips.
    //
    // Latitude rings that would fall inside the groove are simply not drawn, and meridian
    // segments that would cross it are skipped. That absence IS the trench: from outside
    // you see a band missing from the sphere, which is the one detail that makes a
    // wireframe ball read as that battle station.
    const LATS = 22
    const RING_STEPS = 72
    for (let i = 1; i < LATS; i++) {
      const phi = (i / LATS) * Math.PI - Math.PI / 2
      const y = Math.sin(phi) * STATION_RADIUS
      if (Math.abs(y) < TRENCH_HALF_WIDTH) continue
      const r = Math.cos(phi) * STATION_RADIUS
      for (let s = 0; s < RING_STEPS; s++) {
        line(
          at((s / RING_STEPS) * Math.PI * 2, y, r),
          at(((s + 1) / RING_STEPS) * Math.PI * 2, y, r),
          0,
        )
      }
    }
    const MERIDIANS = 30
    for (let m = 0; m < MERIDIANS; m++) {
      const ang = (m / MERIDIANS) * Math.PI * 2
      const STEPS = 26
      for (let s = 0; s < STEPS; s++) {
        const p0 = (s / STEPS) * Math.PI - Math.PI / 2
        const p1 = ((s + 1) / STEPS) * Math.PI - Math.PI / 2
        const y0 = Math.sin(p0) * STATION_RADIUS
        const y1 = Math.sin(p1) * STATION_RADIUS
        if (Math.abs(y0) < TRENCH_HALF_WIDTH || Math.abs(y1) < TRENCH_HALF_WIDTH) continue
        line(at(ang, y0, Math.cos(p0) * STATION_RADIUS), at(ang, y1, Math.cos(p1) * STATION_RADIUS), 0)
      }
    }

    // --- The dish, sunk into the northern hemisphere. Concentric rings and spokes, which
    // is how a vector machine would have drawn a crater.
    // Placed on the arc the approach sweeps over rather than aimed at a single starting
    // angle. The camera swings through APPROACH_SWEEP radians before the dive, so a dish
    // sitting near the middle of that arc is carried across the frame as the hull turns —
    // which is a property of the flight path, not a coincidence of where the run begins.
    const lat = 0.5
    const lon = 2.12
    const normal = new THREE.Vector3(
      Math.cos(lat) * Math.sin(lon),
      Math.sin(lat),
      Math.cos(lat) * Math.cos(lon),
    )
    const centre = normal.clone().multiplyScalar(STATION_RADIUS * 0.93)
    const right = new THREE.Vector3(0, 1, 0).cross(normal).normalize()
    const up = normal.clone().cross(right).normalize()
    const dishAt = (radius: number, angle: number, sink: number): [number, number, number] => {
      const p = centre
        .clone()
        .addScaledVector(right, Math.cos(angle) * radius)
        .addScaledVector(up, Math.sin(angle) * radius)
        .addScaledVector(normal, -sink)
      return [p.x, p.y, p.z]
    }
    // Scaled with the station, and about a fifth of its radius across — the dish is the
    // one silhouette detail that says which battle station this is, so it has to read from
    // orbit rather than being a technically-present ring.
    for (const [radius, sink] of [
      [STATION_RADIUS * 0.2, 0],
      [STATION_RADIUS * 0.13, STATION_RADIUS * 0.045],
      [STATION_RADIUS * 0.055, STATION_RADIUS * 0.075],
    ] as const) {
      for (let i = 0; i < 32; i++) {
        line(dishAt(radius, (i / 32) * Math.PI * 2, sink), dishAt(radius, ((i + 1) / 32) * Math.PI * 2, sink), 0)
      }
    }
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2
      line(dishAt(STATION_RADIUS * 0.2, a, 0), dishAt(STATION_RADIUS * 0.055, a, STATION_RADIUS * 0.075), 0)
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geometry.setAttribute('aKind', new THREE.Float32BufferAttribute(kinds, 1))
    return geometry
  }, [])
}

/** Segments per laser beam. Enough to bend smoothly, few enough to rewrite every frame. */
const BEAM_SEGMENTS = 7
/** How far in front of the camera the cannons sit. Only the frame they define matters. */
const MUZZLE_DIST = 3
/**
 * Strands per beam.
 *
 * WebGL will not draw a line wider than one pixel, so a beam drawn as a single chain is a
 * hairline however bright the colour. Three chains side by side, hue-split, give it both
 * body and a prismatic edge.
 */
const BEAM_STRANDS = [-1, 0, 1]

export function Trench() {
  const engine = useBox((s) => s.engine)
  const running = useBox((s) => s.running)
  const station = useStation()
  const material = useRef<THREE.ShaderMaterial>(null)
  const lasers = useRef<THREE.LineSegments>(null)
  const beamMat = useRef<THREE.LineBasicMaterial>(null)
  const { camera } = useThree()

  /** How far round the equator the ship has flown, in radians. */
  const flown = useRef(0)
  const approach = useRef(0)
  const clock = useRef(0)
  const roll = useRef(0)

  const uniforms = useMemo(
    () => ({
      uBass: { value: 0 },
      uHigh: { value: 0 },
      uWarp: { value: 0 },
      uTouch: { value: new THREE.Vector2(0.5, 0.5) },
      uFog: { value: new THREE.Vector2(1900, 11000) },
    }),
    [],
  )

  const laserGeometry = useMemo(() => {
    const g = new THREE.BufferGeometry()
    const verts = 4 * BEAM_STRANDS.length * BEAM_SEGMENTS * 2
    g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(verts * 3), 3))
    g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(verts * 3), 3))
    return g
  }, [])

  const scratch = useMemo(
    () => ({
      muzzle: new THREE.Vector3(),
      target: new THREE.Vector3(),
      point: new THREE.Vector3(),
      dir: new THREE.Vector3(),
      perp: new THREE.Vector3(),
      look: new THREE.Vector3(),
      up: new THREE.Vector3(),
      colour: new THREE.Color(),
    }),
    [],
  )

  useFrame((_, dt) => {
    const u = uniformsOf(material)
    if (!u) return
    const { bass, high } = readLevels(engine)
    const warp = touch.energy
    const cam = camera as THREE.PerspectiveCamera

    // The station is far further away than the canvas's shared far plane allows. Set once;
    // the canvas is keyed on the scene, so every scene gets a fresh camera and this cannot
    // leak into the next one.
    if (cam.far !== FAR_PLANE) {
      cam.far = FAR_PLANE
      cam.updateProjectionMatrix()
    }

    clock.current += dt
    // The dive only happens once the music does. Before that you are holding station.
    if (running) approach.current = Math.min(1, approach.current + dt * 0.16)
    const dive = approach.current
    // Squared, so it hangs in orbit and then drops. A linear descent reads as a lift.
    const drop = dive * dive

    u.uBass.value = ease(u.uBass.value, bass, dt, 5)
    u.uHigh.value = ease(u.uHigh.value, high, dt, 6)
    u.uWarp.value = warp
    u.uTouch.value.set(touch.x, touch.y)
    // Wide open in orbit, close in once you are down in the groove.
    u.uFog.value.set(1900 - 1830 * drop, 11000 - 10520 * drop)

    // Travel is an ANGLE. There is no scrolling geometry and nothing to wrap.
    const speed = (16 + bass * 52) * (0.25 + drop * 1.6)
    flown.current += (dt * speed) / STATION_RADIUS

    // The flight path, in the same cylindrical coordinates the station is built in: from
    // high and far out, to down inside the groove.
    const radius = ORBIT_RADIUS + (FLOOR_RADIUS + FLY_HEIGHT - ORBIT_RADIUS) * drop
    const height = ORBIT_HEIGHT * (1 - drop) + (touch.y - 0.5) * 3 * warp
    // The approach ARCS. The camera starts a radian or so round the station and swings to
    // the trench entry as it drops, so the hull turns under you and the dish comes past —
    // which is a better answer than bolting the dish to face the starting angle, because it
    // does not care where on the station the dish happens to be.
    const ang = flown.current
    const view = ang - APPROACH_SWEEP * (1 - drop)
    camera.position.set(Math.cos(view) * radius, height, Math.sin(view) * radius)

    // And the lens lengthens as it goes. A wide angle is right for holding the whole
    // station in frame and wrong inside a corridor, where it splays the near walls out to
    // the corners.
    const wantFov = ORBIT_FOV + (TRENCH_FOV - ORBIT_FOV) * drop
    if (Math.abs(cam.fov - wantFov) > 0.01) {
      cam.fov = wantFov
      cam.updateProjectionMatrix()
    }

    // The aim swings from the station itself to a point along the trench ahead. At the
    // start you are looking AT the thing; by the end you are looking down it.
    //
    // The target sits at the ship's OWN radius, not on the floor. Aiming at the floor a
    // short way ahead pitches the camera down at it, which frames the ground rather than
    // the corridor — the trench only reads as somewhere you are flying if the look is
    // level and far enough ahead to be past where the floor curves away.
    const { look, up } = scratch
    const aheadAng = ang + 0.05
    const lookRadius = FLOOR_RADIUS + FLY_HEIGHT
    look.set(Math.cos(aheadAng) * lookRadius * drop, 0, Math.sin(aheadAng) * lookRadius * drop)
    // UP is radial once you are in the groove, and this is the whole orientation of the
    // scene. A trench cut round an equator opens RADIALLY OUTWARD, and its two walls are
    // the north and south faces — so from inside it, "out of the trench" points away from
    // the station's axis, which is horizontal in world terms, and the walls are above and
    // below you in world Y. Leaving up as world-up flies the whole run rolled ninety
    // degrees: the floor ends up on the left and the sky on the right, which is what it did.
    up.set(Math.cos(view), 0, Math.sin(view))
    camera.up.set(0, 1, 0).lerp(up, drop).normalize()
    camera.lookAt(look)
    roll.current += ((touch.x - 0.5) * -0.35 * warp - roll.current) * Math.min(1, dt * 3)
    camera.rotateZ(roll.current)

    // Four cannons at the corners of the screen, converging on the finger. Both ends are
    // derived from the camera rather than written down: a muzzle at a fixed offset is in
    // the corner on the viewport you happened to test and off the edge on every other.
    const firing = warp > 0.002 && drop > 0.35
    if (lasers.current) lasers.current.visible = firing
    if (beamMat.current) beamMat.current.opacity = 0.95 * Math.min(1, warp * 1.35)
    if (firing) {
      const { muzzle, target, point, dir, perp, colour } = scratch
      const halfH = Math.tan((cam.fov * Math.PI) / 360) * MUZZLE_DIST
      const halfW = halfH * cam.aspect

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
        dir.subVectors(target, muzzle).normalize()
        perp.crossVectors(dir, cam.up).normalize()
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

    if (material.current) material.current.uniformsNeedUpdate = true
  })

  return (
    <>
      <color attach="background" args={['#01010a']} />

      {/* Culling off: this is one object several hundred units across, and three's bounding
          sphere test on it is both useless and occasionally wrong once the shader has
          breathed it outward. */}
      <lineSegments geometry={station} frustumCulled={false}>
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

      <lineSegments ref={lasers} geometry={laserGeometry} frustumCulled={false}>
        <lineBasicMaterial
          ref={beamMat}
          vertexColors
          transparent
          opacity={0.95}
          blending={THREE.AdditiveBlending}
        />
      </lineSegments>
    </>
  )
}
