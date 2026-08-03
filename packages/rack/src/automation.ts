import type { AutoLane, AutoPoint, ParamRef } from './types.js'

// Parameter automation: what a knob did, over the arrangement.
//
// **The rack could drive a parameter from four places and remember none of them** — a knob, a Combinator
// routing, a learned CC, a cable into a param-shaped inlet. `docs/REASON-GAP.md` calls that the second of
// the three gaps that matter, and it is most of what makes Reason a DAW rather than an instrument.
//
// Three decisions, none of them obvious.
//
// **Lanes live on the Patch, not on the retained Song.** The engine already has a versioned automation
// timeline and the rack hosts it, so reusing it looks like the smaller change. It is not: that timeline
// belongs to a `Song`, and a rack-native patch has no song in it at all. Automation that only worked for
// groovebox-compatible documents would be absent from exactly the patches somebody built from modules,
// which is the instrument this is.
//
// **A target is `[module, param]`, the same tuple a cable and a Combinator routing use.** The engine names
// its targets with strings — `voice/tr808-bd/decay` — because its parameters are a fixed set with a
// hierarchy. The rack's are neither: they are two ids, and the codec already has an endpoint parser that
// validates exactly that shape. Consistency with the rack's own idiom beats consistency with the engine's,
// and it means a lane naming a module the file does not contain is caught by the same rule cables use.
//
// **Positions are musical, not frames.** A lane records at a bar and a step, so it survives a tempo change,
// a loop, and being shared with somebody whose transport is elsewhere. Frames are what it is *played back*
// through — `Rack.scheduleParam` — and that conversion happens at the last possible moment. A lane in
// frames would be a tape rather than a document.

/** Steps per bar, at sixteenths — what the Transport's `sixteenth` outlet counts and what a Tracker's
 *  default length is. One resolution for the whole rack, so a position means one thing everywhere. */
export const STEPS_PER_BAR = 16

/** A position on the arrangement, as one number. Lanes sort and search by this. */
export function stepOf(bar: number, step: number): number {
  return Math.max(0, Math.round(bar) * STEPS_PER_BAR + Math.round(step))
}

const same = (a: ParamRef, b: ParamRef): boolean => a[0] === b[0] && a[1] === b[1]

/** The lane for one parameter, or undefined. */
export function laneFor(lanes: readonly AutoLane[] | undefined, target: ParamRef): AutoLane | undefined {
  return lanes?.find((lane) => same(lane.target, target))
}

/**
 * Write one point, returning new lanes.
 *
 * Immutable throughout, like every other edit to a patch, so React can diff it and undo can hold onto the
 * version before. A point at a position that already has one **replaces** it rather than adding a second:
 * two values at one instant is not a thing a lane can mean, and recording a knob that somebody wiggles
 * would otherwise grow without limit.
 */
export function setPoint(
  lanes: readonly AutoLane[] | undefined,
  target: ParamRef,
  at: number,
  value: number,
  curve: AutoLane['curve'] = 'linear',
): AutoLane[] {
  if (!Number.isFinite(value)) return [...(lanes ?? [])]
  const position = Math.max(0, Math.round(at))
  const existing = laneFor(lanes, target)
  const point: AutoPoint = { at: position, value }

  if (!existing) {
    const lane: AutoLane = { target, points: [point] }
    // Written only when it is not the default, so a linear lane round-trips byte-identically — the same
    // standard `voices`, `tempo` and `modulation` hold themselves to, and the reason the decoder only ever
    // reads `hold`. Writing `curve: 'linear'` here made a saved patch differ from the one in memory.
    if (curve === 'hold') lane.curve = 'hold'
    return [...(lanes ?? []), lane]
  }

  const points = existing.points.filter((p) => p.at !== position)
  points.push(point)
  // Sorted on write rather than on read. A lane is written once per knob move and read on every scheduler
  // tick, so the cost belongs here — and a sorted lane is what makes `valueAt` a walk rather than a scan.
  points.sort((a, b) => a.at - b.at)
  return (lanes ?? []).map((lane) => (same(lane.target, target) ? { ...lane, points } : lane))
}

/** Forget one parameter's automation entirely. Absent lanes are dropped rather than left empty, so a
 *  cleared lane leaves the patch exactly as it was before anything was recorded. */
export function clearLane(lanes: readonly AutoLane[] | undefined, target: ParamRef): AutoLane[] {
  return (lanes ?? []).filter((lane) => !same(lane.target, target))
}

/**
 * What a lane says at a position, or undefined if it has nothing to say there.
 *
 * Undefined rather than a fallback value, deliberately: **before its first point the parameter's own knob
 * is still in charge.** A lane that answered from step zero would silently take ownership of a knob the
 * moment anybody recorded a single move late in the arrangement, which is the opposite of what recording
 * one move means. After the last point the last value is held, which is what a lane running out means.
 */
export function valueAt(lane: AutoLane | undefined, at: number): number | undefined {
  const points = lane?.points
  if (!points || points.length === 0) return undefined
  if (at < points[0].at) return undefined

  let before = points[0]
  for (let i = 1; i < points.length; i++) {
    if (points[i].at > at) break
    before = points[i]
  }
  const next = points[points.indexOf(before) + 1]
  if (!next || lane!.curve === 'hold') return before.value
  const span = next.at - before.at
  if (span <= 0) return next.value
  return before.value + ((next.value - before.value) * (at - before.at)) / span
}

/**
 * Every point strictly inside a window, for a scheduler looking ahead.
 *
 * Half-open at the start and closed at the end — `(from, to]` — because a scheduler advances its window by
 * setting `from` to the previous `to`, and a point exactly on the seam would otherwise be scheduled twice
 * or not at all depending on which way the comparison fell. Getting that wrong is a knob that jumps twice.
 */
export function pointsIn(lane: AutoLane, from: number, to: number): AutoPoint[] {
  const out: AutoPoint[] = []
  for (const point of lane.points) {
    if (point.at > from && point.at <= to) out.push(point)
  }
  return out
}

/** The last position anything is recorded at, so a host knows how long the automation runs. */
export function automationLength(lanes: readonly AutoLane[] | undefined): number {
  let last = 0
  for (const lane of lanes ?? []) {
    const end = lane.points[lane.points.length - 1]
    if (end && end.at > last) last = end.at
  }
  return last
}
