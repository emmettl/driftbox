// The shape a cable hangs in.
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
// Pure, so `cable.test.ts` can check the properties that matter without a browser: that it starts
// and ends on the jacks, that the middle is always below both of them, and that pulling the ends
// apart takes the sag out.

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
 * An SVG path for a cable between two jacks.
 *
 * The control points sit a quarter of the way along and a full sag below, which gives a flatter
 * bottom than a single quadratic control point would — closer to how a cable actually sits, and it
 * keeps the ends leaving the jacks at a shallower angle, as though the plug were pointing outward.
 */
export function cablePath(from: Point, to: Point): string {
  const drop = sag(from, to)
  const dx = to.x - from.x
  const c1 = { x: from.x + dx * 0.25, y: from.y + drop }
  const c2 = { x: to.x - dx * 0.25, y: to.y + drop }
  return `M ${round(from.x)} ${round(from.y)} C ${round(c1.x)} ${round(c1.y)}, ${round(c2.x)} ${round(c2.y)}, ${round(to.x)} ${round(to.y)}`
}

/**
 * The lowest point of the curve, which is where the cable would be grabbed.
 *
 * A cubic bezier at t=0.5 is an eighth of the way between the ends plus three eighths of each
 * control point, which for two control points dropped by the same amount is three quarters of the
 * sag. Worth having as a number rather than as a guess: the click target for deleting a cable has to
 * be on the cable.
 */
export function cableMiddle(from: Point, to: Point): Point {
  const drop = sag(from, to)
  return {
    x: (from.x + to.x) / 2,
    y: (from.y + to.y) / 2 + drop * 0.75,
  }
}

const round = (value: number) => Math.round(value * 10) / 10
