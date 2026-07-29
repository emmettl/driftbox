import { useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useBox } from "../../store";
import { readLevels } from "../levels";
import { touch } from "../touch";
import { fitDistance } from "../fit";
import { uniformsOf } from "../uniforms";

// DEFCON.
//
// A map, seen from almost straight down, with two sides that shoot at each other on the
// beat. It is the only scene where the music causes something to HAPPEN rather than
// something to move: a kick launches a missile, the missile takes four seconds to fly, and
// it lands whenever it lands. So the picture is running a couple of bars behind the record
// at all times, which is the point — a launch and its arrival are different events, and the
// gap between them is the whole feeling of the game it comes from.
//
// Abstract rather than cartographic. The territories are generated blobs, not coastlines,
// because a recognisable world map invites you to look for your own house and this wants to
// be read as a board. What is kept from the original is the colour language and nothing
// else: deep blue landmasses with thin pale outlines, green for one side, red for the
// other, white only at the moment of impact.

const WORLD_X = 38;
const WORLD_Z = 30;
/** Missiles in the air at once. */
const MISSILES = 14;
/** Points along a trajectory. The arc is drawn as it is flown, so this is also how smooth
 *  the curve looks at the moment it lands. */
const ARC_POINTS = 18;
const IMPACTS = 10;
const RING_POINTS = 30;
const CITIES_PER_SIDE = 7;

const GREEN = new THREE.Color("#4bff9d");
const RED = new THREE.Color("#ff3b4d");
const WHITE = new THREE.Color(1, 1, 1);

const LAND_VERTEX = /* glsl */ `
  varying vec2 vPos;
  void main() {
    vPos = position.xz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const LAND_FRAGMENT = /* glsl */ `
  precision highp float;
  uniform float uBass;
  uniform float uAlert;
  varying vec2 vPos;
  void main() {
    // The glow the original has under its landmasses. Brightest inland and falling away at
    // the coast, so the fill and the outline are the same object rather than a shape with
    // a line drawn round it.
    vec3 blue = vec3(0.05, 0.21, 0.72);
    vec3 hot = vec3(0.35, 0.12, 0.30);
    vec3 colour = mix(blue, hot, uAlert * 0.6);
    gl_FragColor = vec4(colour * (0.62 + uBass * 0.5), 0.55);
  }
`;

/** Deterministic pseudo-random. The board has to be the same board every time it opens. */
function lcg(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

interface City {
  x: number;
  z: number;
  /** -1 west, +1 east. */
  side: number;
}

function useWorld() {
  return useMemo(() => {
    const random = lcg(7734);

    // Territories: blobs, not coastlines. A circle with its radius pushed around by a few
    // harmonics gives something that reads as land at a glance and as nothing in
    // particular on inspection, which is exactly the intent.
    const shapes: THREE.Shape[] = [];
    const outline: number[] = [];
    // Spaced so they barely touch. Overlapping blobs each draw their own closed outline,
    // and the outlines that end up INSIDE the landmass read as soap bubbles rather than as
    // coastline — a coast is a boundary, and boundaries do not cross each other.
    const blobs = [
      [-27, -14, 9],
      [-14, -3, 10],
      [-29, 11, 8],
      [-9, 17, 7],
      [21, -15, 9],
      [29, -1, 9],
      [15, 9, 8],
      [31, 16, 7],
    ] as const;
    for (const [cx, cz, radius] of blobs) {
      const wob = [
        0.3 + random() * 0.5,
        0.2 + random() * 0.4,
        0.15 + random() * 0.3,
      ];
      const phase = [random() * 6.28, random() * 6.28, random() * 6.28];
      const points: THREE.Vector2[] = [];
      const N = 44;
      for (let i = 0; i < N; i++) {
        const a = (i / N) * Math.PI * 2;
        const r =
          radius *
          (1 +
            Math.sin(a * 2 + phase[0]) * wob[0] * 0.55 +
            Math.sin(a * 3 + phase[1]) * wob[1] * 0.45 +
            Math.sin(a * 5 + phase[2]) * wob[2] * 0.3);
        points.push(
          new THREE.Vector2(cx + Math.cos(a) * r, cz + Math.sin(a) * r * 0.8),
        );
      }
      shapes.push(new THREE.Shape(points));
      for (let i = 0; i < N; i++) {
        const a = points[i];
        const b = points[(i + 1) % N];
        outline.push(a.x, 0.02, a.y, b.x, 0.02, b.y);
      }
    }

    // ShapeGeometry triangulates for us, which is the only reason arbitrary blobs are
    // affordable here — hand-rolling an ear clipper for a decorative fill would be daft.
    const land = new THREE.ShapeGeometry(shapes);
    land.rotateX(Math.PI / 2);
    land.scale(1, 1, -1);

    const coast = new THREE.BufferGeometry();
    coast.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(outline, 3),
    );

    // The graticule. Sparse and very dim: it is there to say "this is a map", and any
    // brighter it competes with the thing the map is for.
    const grid: number[] = [];
    for (let x = -WORLD_X; x <= WORLD_X; x += 9.5)
      grid.push(x, 0, -WORLD_Z, x, 0, WORLD_Z);
    for (let z = -WORLD_Z; z <= WORLD_Z; z += 9.5)
      grid.push(-WORLD_X, 0, z, WORLD_X, 0, z);
    const graticule = new THREE.BufferGeometry();
    graticule.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(grid, 3),
    );

    // Cities, kept on their own side of the board and off the very edge.
    const cities: City[] = [];
    for (const side of [-1, 1]) {
      for (let i = 0; i < CITIES_PER_SIDE; i++) {
        cities.push({
          x: side * (7 + random() * (WORLD_X - 12)),
          z: (random() - 0.5) * (WORLD_Z * 1.5),
          side,
        });
      }
    }

    // A glyph per city: a small diamond, which is as much vector iconography as reads at
    // this distance. Colour is baked in, since a city never changes sides.
    const glyphPos: number[] = [];
    const glyphCol: number[] = [];
    for (const city of cities) {
      const colour = city.side < 0 ? GREEN : RED;
      const r = 1.15;
      const pts = [
        [0, -r],
        [r, 0],
        [0, r],
        [-r, 0],
      ] as const;
      for (let i = 0; i < 4; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % 4];
        glyphPos.push(
          city.x + a[0],
          0.05,
          city.z + a[1],
          city.x + b[0],
          0.05,
          city.z + b[1],
        );
        glyphCol.push(
          colour.r,
          colour.g,
          colour.b,
          colour.r,
          colour.g,
          colour.b,
        );
      }
    }
    const glyphs = new THREE.BufferGeometry();
    glyphs.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(glyphPos, 3),
    );
    glyphs.setAttribute("color", new THREE.Float32BufferAttribute(glyphCol, 3));

    return { land, coast, graticule, glyphs, cities };
  }, []);
}

interface Missile {
  from: City;
  to: City;
  /** 0 at launch, 1 on impact. Negative means the slot is free. */
  t: number;
  speed: number;
}

interface Impact {
  x: number;
  z: number;
  age: number;
  side: number;
}

/** Onset detection: a fast envelope crossing a slow one, as in the other event-driven
 *  scenes. A level threshold fires all through a loud passage and never in a quiet one. */
function makeDetector(rise: number, refractory: number) {
  let fast = 0;
  let slow = 0;
  let wait = 0;
  return (value: number, dt: number): number => {
    fast += (value - fast) * Math.min(1, dt * 28);
    slow += (value - slow) * Math.min(1, dt * 2.2);
    wait -= dt;
    if (wait > 0 || fast < 0.07 || fast < slow * rise) return 0;
    wait = refractory;
    return Math.min(1, fast);
  };
}

export function Defcon() {
  const engine = useBox((s) => s.engine);
  const world = useWorld();
  const landMat = useRef<THREE.ShaderMaterial>(null);
  const arcs = useRef<THREE.LineSegments>(null);
  const rings = useRef<THREE.LineSegments>(null);
  const { camera, size } = useThree();
  const board = useRef<THREE.Group>(null);

  const landUniforms = useMemo(
    () => ({ uBass: { value: 0 }, uAlert: { value: 0 } }),
    [],
  );

  const arcGeometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const verts = MISSILES * (ARC_POINTS - 1) * 2;
    g.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(verts * 3), 3),
    );
    g.setAttribute(
      "color",
      new THREE.BufferAttribute(new Float32Array(verts * 3), 3),
    );
    return g;
  }, []);
  const ringGeometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const verts = IMPACTS * RING_POINTS * 2;
    g.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(verts * 3), 3),
    );
    g.setAttribute(
      "color",
      new THREE.BufferAttribute(new Float32Array(verts * 3), 3),
    );
    return g;
  }, []);

  const missiles = useMemo<Missile[]>(
    () =>
      Array.from({ length: MISSILES }, () => ({
        from: world.cities[0],
        to: world.cities[0],
        t: -1,
        speed: 0.25,
      })),
    [world],
  );
  const impacts = useMemo<Impact[]>(
    () =>
      Array.from({ length: IMPACTS }, () => ({ x: 0, z: 0, age: -1, side: 1 })),
    [],
  );
  const nextMissile = useRef(0);
  const nextImpact = useRef(0);
  const clock = useRef(0);
  const alert = useRef(0);
  const onLaunch = useMemo(() => makeDetector(1.45, 0.3), []);
  const random = useMemo(() => lcg(20240), []);
  const scratch = useMemo(
    () => ({
      a: new THREE.Vector3(),
      b: new THREE.Vector3(),
      c: new THREE.Color(),
    }),
    [],
  );

  const arcAt = (m: Missile, t: number, out: THREE.Vector3) => {
    // A plain parabola. Ballistic enough at this scale, and the alternative — a great
    // circle on a globe — would need a globe.
    const flat = Math.min(1, Math.max(0, t));
    const reach = Math.hypot(m.to.x - m.from.x, m.to.z - m.from.z);
    out.set(
      m.from.x + (m.to.x - m.from.x) * flat,
      Math.sin(flat * Math.PI) * reach * 0.22,
      m.from.z + (m.to.z - m.from.z) * flat,
    );
    return out;
  };

  useFrame((_, dt) => {
    const u = uniformsOf(landMat);
    if (!u) return;
    const { bass, high } = readLevels(engine);
    clock.current += dt;

    u.uBass.value += (bass - u.uBass.value) * Math.min(1, dt * 4);

    // Launch on the beat. Two at a time when it is loud, which is what turns a exchange
    // into a war over the course of a section.
    const kick = onLaunch(bass, dt);
    if (kick) {
      const salvo = kick > 0.5 ? 2 : 1;
      for (let n = 0; n < salvo; n++) {
        const west = random() < 0.5;
        const from =
          world.cities[
            (west ? 0 : CITIES_PER_SIDE) +
              Math.floor(random() * CITIES_PER_SIDE)
          ];
        const to =
          world.cities[
            (west ? CITIES_PER_SIDE : 0) +
              Math.floor(random() * CITIES_PER_SIDE)
          ];
        const m = missiles[nextMissile.current];
        nextMissile.current = (nextMissile.current + 1) % MISSILES;
        m.from = from;
        m.to = to;
        m.t = 0;
        // Slow. The gap between a launch and its arrival is the whole point, so this is
        // measured in bars rather than in frames.
        m.speed = 0.16 + random() * 0.09;
      }
    }

    // Fly, and land.
    const arcPos = arcGeometry.getAttribute(
      "position",
    ) as THREE.BufferAttribute;
    const arcCol = arcGeometry.getAttribute("color") as THREE.BufferAttribute;
    const { a, b, c } = scratch;
    let v = 0;
    let airborne = 0;
    for (const m of missiles) {
      if (m.t >= 0) {
        m.t += dt * m.speed;
        airborne++;
        if (m.t >= 1) {
          m.t = -1;
          const hit = impacts[nextImpact.current];
          nextImpact.current = (nextImpact.current + 1) % IMPACTS;
          hit.x = m.to.x;
          hit.z = m.to.z;
          hit.age = 0;
          hit.side = m.to.side;
          alert.current = 1;
        }
      }
      const colour = m.from.side < 0 ? GREEN : RED;
      for (let s = 0; s < ARC_POINTS - 1; s++) {
        // Only the flown part of the arc is drawn; the rest is collapsed onto the launch
        // site, where it is invisible. Cheaper than a draw range per missile and it means
        // the trajectory draws itself as the thing travels.
        const t0 = m.t < 0 ? 0 : (s / (ARC_POINTS - 1)) * m.t;
        const t1 = m.t < 0 ? 0 : ((s + 1) / (ARC_POINTS - 1)) * m.t;
        arcAt(m, t0, a);
        arcAt(m, t1, b);
        arcPos.setXYZ(v, a.x, a.y, a.z);
        arcPos.setXYZ(v + 1, b.x, b.y, b.z);
        // Brightest at the head, so it reads as something travelling rather than as a
        // line that happens to be getting longer.
        const lead = m.t < 0 ? 0 : Math.pow((s + 1) / (ARC_POINTS - 1), 3);
        // Only the very tip goes pale. Whitening the whole trail loses which side fired
        // it, which is the one thing a trajectory has to tell you.
        c.copy(colour)
          .lerp(WHITE, lead * 0.35)
          .multiplyScalar(m.t < 0 ? 0 : 0.3 + lead * 1.4);
        arcCol.setXYZ(v, c.r, c.g, c.b);
        arcCol.setXYZ(v + 1, c.r, c.g, c.b);
        v += 2;
      }
    }
    arcPos.needsUpdate = true;
    arcCol.needsUpdate = true;

    // Impacts: a ring that expands and dies.
    const ringPos = ringGeometry.getAttribute(
      "position",
    ) as THREE.BufferAttribute;
    const ringCol = ringGeometry.getAttribute("color") as THREE.BufferAttribute;
    let r = 0;
    for (const hit of impacts) {
      if (hit.age >= 0) {
        hit.age += dt;
        if (hit.age > 3.2) hit.age = -1;
      }
      const live = hit.age >= 0;
      // Kept small. A blast ring that grows to a third of the board stops being a place
      // something happened and becomes weather.
      const radius = live ? hit.age * 3.4 : 0;
      const fade = live ? Math.max(0, 1 - hit.age / 3.2) : 0;
      // White at the instant of impact and into its side's colour as it dies. Cubed, so
      // almost all of the brightness is in the first half second.
      c.set(1, 1, 1)
        .lerp(hit.side < 0 ? GREEN : RED, 1 - fade)
        .multiplyScalar(fade * fade * fade * 3.4);
      for (let s = 0; s < RING_POINTS; s++) {
        const a0 = (s / RING_POINTS) * Math.PI * 2;
        const a1 = ((s + 1) / RING_POINTS) * Math.PI * 2;
        ringPos.setXYZ(
          r,
          hit.x + Math.cos(a0) * radius,
          0.1,
          hit.z + Math.sin(a0) * radius,
        );
        ringPos.setXYZ(
          r + 1,
          hit.x + Math.cos(a1) * radius,
          0.1,
          hit.z + Math.sin(a1) * radius,
        );
        ringCol.setXYZ(r, c.r, c.g, c.b);
        ringCol.setXYZ(r + 1, c.r, c.g, c.b);
        r += 2;
      }
    }
    ringPos.needsUpdate = true;
    ringCol.needsUpdate = true;

    // How bad it has got. Rises on every impact and decays slowly, and the land runs from
    // blue toward red with it — the DEFCON level, without a readout saying so.
    alert.current = Math.max(0, alert.current - dt * 0.14);
    u.uAlert.value +=
      (Math.min(1, alert.current + airborne / MISSILES) - u.uAlert.value) *
      Math.min(1, dt * 1.5);

    // Nearly overhead, drifting. A finger tips the board toward the horizon, which turns a
    // map into a battlefield without ever leaving it.
    const portrait = size.width / size.height < 0.85;
    const lean = touch.energy * (touch.y - 0.5) * 46;
    const swing =
      Math.sin(clock.current * 0.06) * 3 + (touch.x - 0.5) * 14 * touch.energy;
    // The BOARD turns, not the camera. This map is half again as wide as it is deep, and a
    // phone's horizontal field of view is about 0.6 of its vertical — so framing it
    // landscape on a portrait screen means backing off until it is a strip through the
    // middle with dead space above and below. Turned a quarter, the same map fills the same
    // phone at two thirds the distance. Reshape the subject, not the lens.
    if (board.current) board.current.rotation.y = portrait ? Math.PI / 2 : 0;
    // And the extents swap with it. Seen from near overhead the board's depth is
    // foreshortened, so its on-screen height is the shorter side times about 0.85.
    const across = portrait ? WORLD_Z : WORLD_X;
    const deep = (portrait ? WORLD_X : WORLD_Z) * 0.85;
    const range = fitDistance(camera as THREE.PerspectiveCamera, across, deep);
    camera.position.set(swing, range * 0.94 - lean * 0.5 + high * 1.5, range * 0.3 + lean);
    camera.lookAt(0, 0, 0);
    if (landMat.current) landMat.current.uniformsNeedUpdate = true;
  });

  return (
    <>
      <color attach="background" args={["#01030e"]} />
      <group ref={board}>
        <lineSegments geometry={world.graticule}>
          <lineBasicMaterial color="#123a6b" transparent opacity={0.32} />
        </lineSegments>
        <mesh geometry={world.land}>
          <shaderMaterial
            ref={landMat}
            uniforms={landUniforms}
            vertexShader={LAND_VERTEX}
            fragmentShader={LAND_FRAGMENT}
            transparent
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
        <lineSegments geometry={world.coast}>
          <lineBasicMaterial color="#8fd0ff" transparent opacity={0.5} />
        </lineSegments>
        <lineSegments geometry={world.glyphs}>
          <lineBasicMaterial
            vertexColors
            transparent
            opacity={0.9}
            blending={THREE.AdditiveBlending}
          />
        </lineSegments>
        {/* Culling off on both: the vertices are rewritten every frame, so the bounds three
          worked out once describe shapes that no longer exist. */}
        <lineSegments ref={arcs} geometry={arcGeometry} frustumCulled={false}>
          <lineBasicMaterial
            vertexColors
            transparent
            blending={THREE.AdditiveBlending}
          />
        </lineSegments>
        <lineSegments ref={rings} geometry={ringGeometry} frustumCulled={false}>
          <lineBasicMaterial
            vertexColors
            transparent
            blending={THREE.AdditiveBlending}
          />
        </lineSegments>
      </group>
    </>
  );
}
