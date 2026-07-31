// The shape a cable hangs in, and the way it swings when the rack turns.
//
// Reason's back panel is the reason anybody remembers what Reason looked like, and the cables are
// most of that. They hang. A bezier straight between two jacks reads as a diagram; a cable with
// weight in it reads as a rack.
//
// A real hanging cable is a catenary, `cosh`. This is not one, and does not need to be: the visible
// difference between a catenary and a cubic bezier with both control points pushed down is nothing
// at all at the sizes involved, and the bezier is a string an SVG path can take directly. What has
// to be right is not the curve family but the *behaviour* — that slack depends on how far apart the
// ends are, so dragging two jacks together makes the cable belly out rather than shrink.
//
// **The swing is the same idea taken one step further.** When the rack spins the cables get left
// behind, then catch up, then overshoot, then settle. That is a damped pendulum, one angle per cable.
//
// Two things about it were wrong at first and both were caught by driving the actual page rather than
// by these tests, which is worth recording because the tests all passed both times:
//
//   1. The first version swung the belly on an arc of radius `sag`, conserving the cable's length
//      exactly. Correct physics, 10.8 design units of travel, and completely invisible on a rack 480
//      units wide — see `REACH`.
//   2. Deriving each cable's period from its own length is real and, here, almost no variation: every
//      cable in the shipped patch spans 433-508 units, so all eight peaked on the same frame. See
//      `swingPeriod`.
//
// Pure, so `cable.test.ts` can check the properties that matter without a browser — but the two
// mistakes above say plainly what that file cannot do on its own, which is tell whether any of this
// can be seen.

/** Rest length beyond the straight-line distance, in design units. A cable is never taut. */
const SLACK = 22
/**
 * How much of the remaining distance still turns into sag.
 *
 * 0.10, down from the 0.22 this started at. At 0.22 a cable spanning the height of the rack dropped
 * 200 design units and the back panel read as bunting rather than as patch leads — enough sag to be
 * obviously a hanging cable is a much smaller number than it feels like it should be.
 */
const DROOP = 0.1

/**
 * Gravity, in design units per second squared, and it is a tuning knob rather than a measurement.
 *
 * Design units are not metres, so 9.81 would be meaningless here. What this number actually sets is
 * the spread of periods across the rack, via `T = 2π√(L/g)`: at 4300 the shortest cable swings at
 * about 0.45s and one spanning the full height at about 1.0s. That ratio is the whole effect. Making
 * it much larger makes every cable twitch at the same fast rate and the plausibility goes.
 */
const GRAVITY = 4300
/** How far the belly is thrown at the peak of the first swing, in radians. About 52°. */
const THROW = 0.9
/**
 * How far sideways the belly can reach, in design units, as a base plus a share of the sag.
 *
 * This exists because the strictly-conserved version did not work. The first attempt swung the belly on
 * an arc of radius `sag`, which is what a pendulum does and meant the cable could not change length —
 * elegant, and measured in the browser at 10.8 units of travel at its peak. On a rack 480 units wide
 * that is invisible: the mid-swing screenshot was indistinguishable from the settled one.
 *
 * The cause is that `DROOP` was deliberately tuned down to 0.1 to stop the panel reading as bunting, so
 * the sag is small, so a pendulum of that length has nowhere to go. Rather than undo that, the reach is
 * its own number — which is defensible on its own terms, since the slack in a cable is its arc length
 * and that is a good deal more than the depth it hangs to.
 *
 * The cost is that length is now only approximately conserved. That was worth paying: an invisible
 * effect that conserves length perfectly is not a better effect.
 */
const REACH = 20
const REACH_PER_SAG = 1.4
/**
 * How much of the sag the belly gives up at full swing, as a fraction.
 *
 * The bob, and it has to be there — a belly that slid sideways without rising would look like it was on
 * rails. Applied through `1 - cos`, so it is second order in the angle and therefore happens at twice
 * the sway's rate, which is what a real pendulum does and costs no second oscillator.
 */
const LIFT = 0.5
/** Time constant of the decay, in seconds. Three of these is 1.5s, by which point it is at rest. */
const DAMPING = 0.5
/**
 * After this long the swing is under a pixel and the animation can stop.
 *
 * It has to be long enough that cutting the loop is not itself a visible movement. At 1600ms and a throw
 * of 0.9 the residual angle at the cut was 0.065rad, which is about four design units of belly — a small
 * but real snap. Four decay constants leaves under one, which is nothing.
 */
export const SWING_MS = 2200

export interface Point {
  x: number
  y: number
}

/** How far below the straight line between two points the cable hangs at its lowest. */
export function sag(from: Point, to: Point): number {
  const distance = Math.hypot(to.x - from.x, to.y - from.y)
  return SLACK + distance * DROOP
}

/**
 * A stable number in [0, 1) for a cable, from its own name.
 *
 * Not randomness — the same cable must get the same value on every render, or it would jump each time
 * React re-drew the panel. A hash of the key the panel already has is enough, and it means nothing has
 * to be stored anywhere.
 */
export function swingSeed(key: string): number {
  let hash = 2166136261
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return ((hash >>> 0) % 1000) / 1000
}

/**
 * How long one swing of this cable takes, in milliseconds.
 *
 * A pendulum's period, with the sag standing in for the length — the sag *is* how far the belly hangs
 * below its supports, so `√L` gives a cable that hangs twice as far a swing 1.41 times slower.
 *
 * On its own that turned out not to be enough, and the browser is what said so. Every cable in the
 * shipped patch spans between 433 and 508 design units, because the rack is one column wide and they
 * all run roughly the same diagonal. Through `sag = 22 + 0.1d` that compresses to 65-73, and through
 * the square root to a period range of 774-818ms — a 5% spread, which is lockstep to the eye. The
 * measured peak frame for all eight cables was frame 13 or 14 of the same swing.
 *
 * So `seed` varies it by ±15% as well. Real patch leads differ in stiffness, in how firmly they are
 * seated, in whether they are resting on a neighbour, and that is exactly why a real panel does not
 * move as one object. This is that, done cheaply and deterministically.
 */
export function swingPeriod(from: Point, to: Point, seed = 0): number {
  const base = 2 * Math.PI * Math.sqrt(sag(from, to) / GRAVITY) * 1000
  return base * (0.85 + seed * 0.3)
}

/** The longest a cable waits before it starts to move, in ms. Enough to read, short enough to feel like one event. */
const STAGGER_MS = 70

/**
 * The angle this cable's belly is displaced by, `elapsed` ms after the rack was spun.
 *
 * A damped harmonic oscillator started from rest with a kick: `sin` rather than `cos`, so it begins
 * at zero displacement and maximum velocity. That is what actually happens — the rack accelerates
 * away and the cable, being where it was, is suddenly moving relative to it.
 *
 * `direction` is ±1 for which way the rack turned, because flipping to the back and flipping to the
 * front throw the cables opposite ways and a swing that ignored that would be visibly wrong on every
 * second press.
 *
 * `seed` is this cable's own character, from `swingSeed` — it sets both the period and a few tens of
 * milliseconds of delay before the cable gets going, so the panel comes loose in a ripple rather than
 * snapping sideways as one sheet.
 */
export function swingAngle(
  elapsed: number,
  from: Point,
  to: Point,
  direction = 1,
  seed = 0,
): number {
  const since = elapsed - seed * STAGGER_MS
  if (since < 0 || elapsed >= SWING_MS) return 0
  const decay = Math.exp(-since / 1000 / DAMPING)
  const phase = (2 * Math.PI * since) / swingPeriod(from, to, seed)
  return direction * THROW * decay * Math.sin(phase)
}

/**
 * Where the belly of a cable sits at a given swing angle: sideways, and how far down.
 *
 * Shared by the path and the grab handle so they cannot disagree — a grab target that drifted off its
 * own cable during the swing would look detached from the thing it belongs to.
 *
 * Sideways is `sin`, so it is largest at the extremes of the swing. The drop is reduced through
 * `1 - cos`, so the belly rises as it swings out and dips as it passes through the middle — second
 * order in the angle, which means the bob happens at twice the rate of the sway for free. At angle
 * zero both terms vanish and this is arithmetically the resting position.
 */
function belly(from: Point, to: Point, angle: number): { across: number; down: number } {
  const drop = sag(from, to)
  return {
    across: Math.sin(angle) * (REACH + drop * REACH_PER_SAG),
    down: drop * (1 - LIFT * (1 - Math.cos(angle))),
  }
}

/** The two control points shared by drawing, hit testing and deletion particles. */
function controls(from: Point, to: Point, angle: number): [Point, Point] {
  const { across, down } = belly(from, to, angle)
  const dx = to.x - from.x
  return [
    { x: from.x + dx * 0.25 + across, y: from.y + down },
    { x: to.x - dx * 0.25 + across, y: to.y + down },
  ]
}

/**
 * An SVG path for a cable between two jacks, optionally mid-swing.
 *
 * The control points sit a quarter of the way along and a full sag below, which gives a flatter
 * bottom than a single quadratic control point would — closer to how a cable actually sits, and it
 * keeps the ends leaving the jacks at a shallower angle, as though the plug were pointing outward.
 */
export function cablePath(from: Point, to: Point, angle = 0): string {
  const [c1, c2] = controls(from, to, angle)
  return `M ${round(from.x)} ${round(from.y)} C ${round(c1.x)} ${round(c1.y)}, ${round(c2.x)} ${round(c2.y)}, ${round(to.x)} ${round(to.y)}`
}

/**
 * A point on the cable's cubic curve.
 *
 * Deletion smoke is emitted along the lead rather than from its bounding box, so it needs the same
 * geometry as the path. Keeping the cubic arithmetic here prevents the particles drifting off a cable
 * when the sag or swing model changes.
 */
export function cablePoint(from: Point, to: Point, progress: number, angle = 0): Point {
  const t = Math.max(0, Math.min(1, progress))
  const remaining = 1 - t
  const [c1, c2] = controls(from, to, angle)
  return {
    x:
      remaining ** 3 * from.x +
      3 * remaining ** 2 * t * c1.x +
      3 * remaining * t ** 2 * c2.x +
      t ** 3 * to.x,
    y:
      remaining ** 3 * from.y +
      3 * remaining ** 2 * t * c1.y +
      3 * remaining * t ** 2 * c2.y +
      t ** 3 * to.y,
  }
}

/**
 * The lowest point of the curve, which is where the cable would be grabbed.
 *
 * A cubic bezier at t=0.5 is an eighth of the way between the ends plus three eighths of each
 * control point, which for two control points displaced by the same amount is three quarters of the
 * displacement. Worth having as a number rather than as a guess: the click target for deleting a
 * cable has to be on the cable, including while it is swinging — a grab handle that stayed put for a
 * second and a half after a flip would look detached from the thing it belongs to.
 */
export function cableMiddle(from: Point, to: Point, angle = 0): Point {
  return cablePoint(from, to, 0.5, angle)
}

const round = (value: number) => Math.round(value * 10) / 10
