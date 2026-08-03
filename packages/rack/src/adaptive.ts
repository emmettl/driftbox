import type { ParamRef } from './types.js'

// Music that follows what is happening, for a host that has a number describing it.
//
// A game knows how its scene is going — the crowd size, the health bar, how close the chase is — and wants
// the music to know too. The obvious build is to keep several finished pieces and cross-fade between them,
// and the second most obvious is to keep several patches and swap them. **Both are wrong here, and the
// second one is wrong in a way worth stating plainly**: applying a plan rebuilds every processor in the
// graph, so an oscillator's phase, a filter's history and an envelope's stage all restart. A patch swap is
// a hard cut with a click on it, not a transition. `graph.ts` says so at `setPlan` and notes that
// preserving state across an edit is a later feature.
//
// So an adaptive score moves parameters **inside one patch**, which the rack is unusually well set up for:
// a Combinator rotary already reaches any parameter of any module through the patch's own `modulation`
// list, including stepped ones no cable can touch, and a Tracker's `pattern` param already selects one of
// eight patterns on the next step edge. What was missing was the mapping from a game's number to those
// knobs, and the rule about *when* each one is allowed to move.
//
// **That rule is the whole of what this file adds.** Two kinds of parameter, two answers:
//
//   - A **continuous** one — a level, a cutoff, a send — moves now. The Graph ramps it across the block
//     that follows, so it slides rather than clicks, and an intensity that drifts produces a filter that
//     drifts with it.
//   - A **discrete** one — a pattern index, a waveform, a mute — moves on the **bar line**. A drum pattern
//     that changes on beat three is not a transition, it is a mistake, and no amount of ramping fixes it
//     because there is nothing between pattern 2 and pattern 3 to ramp through.
//
// Everything else here follows from those two sentences. The arithmetic is pure functions so it is testable
// without a rack at all, and the class is a small amount of state: what was last sent, and what is waiting
// for a bar.
//
// **It is not a sequencer and does not want to be.** Nothing here decides notes, and it holds no clock —
// the caller says where the beat is, because the caller is the only one who knows whether it is driving a
// live `Rack` off `ctx.currentTime` or a `RackRenderer` rendering faster than real time.

/** One point on a control's curve: at this intensity, this value. */
export interface AdaptivePoint {
  /** Where on the intensity scale this point sits. 0..1 by convention; any scale works as long as the
   *  score and the caller agree, because nothing here rescales it. */
  at: number
  value: number
}

/** One parameter, and what it should read at each intensity. */
export interface AdaptiveControl {
  target: ParamRef
  /**
   * The curve, as points. Order does not matter — the value is found by bracketing rather than by walking,
   * so a score written out of order still works and does not have to be sorted first.
   *
   * Between two points the value is linear. Outside the outermost pair it holds: an intensity above
   * anything the score describes gets the top value rather than an extrapolation, because extrapolating a
   * level past the loudest point the author wrote is how a score ends up clipping in the one situation
   * nobody tested.
   */
  points: readonly AdaptivePoint[]
  /**
   * Change only on a bar line rather than at once. Default false.
   *
   * Set it for anything the ear hears as a *choice* rather than as a position: a Tracker's pattern, a
   * waveform selector, a mute. See the note at the top of this file.
   */
  onBar?: boolean
  /** Round to a whole number before sending. Stepped params round on the audio thread anyway; doing it here
   *  as well is what keeps `update`'s report — and the "did this change?" test behind it — honest about
   *  what the module actually received. */
  step?: boolean
}

export interface AdaptiveScore {
  controls: readonly AdaptiveControl[]
  /** Four unless a score says otherwise. Only `onBar` controls read it. */
  beatsPerBar?: number
}

/** What an adaptive score needs from a rack: one method, which both `Rack` and `RackRenderer` have. */
export interface AdaptiveHost {
  setParam(moduleId: string, paramId: string, value: number, voice?: number): void
}

/** One parameter change an update decided on. Returned by `update` so a host can log or draw it. */
export interface AdaptiveChange {
  target: ParamRef
  value: number
}

const DEFAULT_BEATS_PER_BAR = 4

/**
 * Two values are the same knob position if nothing downstream could tell them apart.
 *
 * Relative rather than absolute because the params this drives are not on one scale: 1e-4 is inaudible on a
 * cutoff in hertz and is most of the useful range of a mute. Without some tolerance, a game updating sixty
 * times a second with an intensity that wobbles in the sixth decimal would send sixty messages a second per
 * control — and across a `Rack`, every one of those is a `postMessage` the audio thread has to drain.
 */
function differs(a: number, b: number): boolean {
  return Math.abs(a - b) > 1e-4 * Math.max(1, Math.abs(a), Math.abs(b))
}

/**
 * What one control reads at a given intensity.
 *
 * Returns NaN for a control with no points, which `adaptiveValues` then drops. A control with nothing to
 * say is skipped rather than sent a zero: zero is a real value — silence on a level, pattern one on a
 * Tracker — and inventing it would quietly rewrite a patch the score never described.
 */
export function adaptiveValue(control: AdaptiveControl, intensity: number): number {
  const points = control.points
  if (points.length === 0 || !Number.isFinite(intensity)) return Number.NaN

  // Bracket rather than assume ascending order. One pass, no allocation, and a score written in whatever
  // order made sense to its author behaves the same as a sorted one.
  let below: AdaptivePoint | null = null
  let above: AdaptivePoint | null = null
  for (const point of points) {
    if (!Number.isFinite(point.at) || !Number.isFinite(point.value)) continue
    if (point.at <= intensity && (below === null || point.at > below.at)) below = point
    if (point.at >= intensity && (above === null || point.at < above.at)) above = point
  }

  // Outside the curve, hold the end. Exactly on a point, both brackets are it.
  if (below === null && above === null) return Number.NaN

  // Rounded at the one exit rather than in the interpolating branch, so a stepped control clamped above its
  // top point lands on a whole number too. It reads as a detail and is not: the value the score last sent
  // is what "has this changed?" compares against, so a fractional one there would resend for ever.
  let value: number
  if (below === null) value = (above as AdaptivePoint).value
  else if (above === null) value = below.value
  else {
    const span = above.at - below.at
    value =
      span === 0
        ? above.value
        : below.value + ((intensity - below.at) / span) * (above.value - below.value)
  }
  return control.step ? Math.round(value) : value
}

/** Every control's value at an intensity, with the ones that had nothing to say dropped. */
export function adaptiveValues(score: AdaptiveScore, intensity: number): AdaptiveChange[] {
  const changes: AdaptiveChange[] = []
  for (const control of score.controls) {
    const value = adaptiveValue(control, intensity)
    if (Number.isFinite(value)) changes.push({ target: control.target, value })
  }
  return changes
}

/**
 * A score, driven by a number.
 *
 * ```js
 * const score = new Adaptive(rack, {
 *   controls: [
 *     { target: ['macro', 'rotary1'], points: [{ at: 0, value: 0 }, { at: 1, value: 127 }] },
 *     { target: ['drums', 'pattern'], points: [{ at: 0, value: 0 }, { at: 0.5, value: 1 }, { at: 1, value: 3 }],
 *       onBar: true, step: true },
 *   ],
 * })
 *
 * // in the game's update loop
 * score.update(danger, rack.beat)
 * ```
 *
 * Call it as often as you like. It sends only what changed, so an update loop running at frame rate costs
 * almost nothing while the scene is steady.
 */
export class Adaptive {
  private readonly host: AdaptiveHost
  private readonly score: AdaptiveScore
  private readonly beatsPerBar: number
  /**
   * A key per control, in the score's order.
   *
   * `JSON.stringify` for the reason `compile.ts` gives at its own `key`: both halves come out of a patch,
   * and joining them with a separator collides — `["a b", "c"]` and `["a", "b c"]` are two different
   * targets with the same joined name. Computed once here rather than per update, because unlike a patch
   * edit this runs in a game's update loop.
   */
  private readonly keys: string[]
  /** What each target was last told, by that key. */
  private readonly sent = new Map<string, number>()
  /** Values waiting for a bar line. */
  private readonly pending = new Map<string, AdaptiveChange>()
  private bar: number | null = null
  private intensityValue = Number.NaN

  constructor(host: AdaptiveHost, score: AdaptiveScore) {
    this.host = host
    this.score = score
    this.keys = score.controls.map((control) => JSON.stringify(control.target))
    const perBar = score.beatsPerBar ?? DEFAULT_BEATS_PER_BAR
    this.beatsPerBar = Number.isFinite(perBar) && perBar > 0 ? perBar : DEFAULT_BEATS_PER_BAR
  }

  /** The intensity of the last update, or NaN before the first one. */
  get intensity(): number {
    return this.intensityValue
  }

  /**
   * Apply the score at an intensity, given where the transport is.
   *
   * `beat` comes from the host — `RackRenderer.beat`, or the app's playhead against `ctx.currentTime` — and
   * is read for one purpose only: deciding whether a bar line has gone by since the last call. A host with
   * no transport can pass 0 for ever, and every `onBar` control then behaves like an immediate one on the
   * first update and never moves again, which is the honest answer to "what bar is it" when nothing is
   * playing.
   *
   * Returns the changes it sent, most useful in a test and in a debug overlay.
   */
  update(intensity: number, beat = 0): AdaptiveChange[] {
    this.intensityValue = intensity
    const bar = Number.isFinite(beat) ? Math.floor(beat / this.beatsPerBar) : 0
    // The first update applies everything at once. Nothing has been set, so holding a pattern back for a
    // bar would leave the patch on whatever it was saved with — the score would arrive a bar late, every
    // time, including in an offline render that is only four bars long.
    const first = this.bar === null
    // A bar line, or a seek: going backwards is a loop or a jump, which is a boundary as surely as going
    // forwards is. Waiting for the *next* forward crossing after a seek would strand a pending change.
    const boundary = first || bar !== this.bar
    this.bar = bar

    const applied: AdaptiveChange[] = []
    for (let index = 0; index < this.score.controls.length; index++) {
      const control = this.score.controls[index]
      const value = adaptiveValue(control, intensity)
      if (!Number.isFinite(value)) continue
      const key = this.keys[index]
      const last = this.sent.get(key)

      if (control.onBar && !first) {
        // Held, and overwritten while it waits: the value that lands on the bar line is the one the game
        // wanted *at* the bar line, not the one it wanted when the intensity first moved.
        if (last === undefined || differs(value, last)) this.pending.set(key, { target: control.target, value })
        else this.pending.delete(key)
        continue
      }

      if (last !== undefined && !differs(value, last)) continue
      this.host.setParam(control.target[0], control.target[1], value)
      this.sent.set(key, value)
      applied.push({ target: control.target, value })
    }

    if (boundary && this.pending.size > 0) {
      for (const [key, change] of this.pending) {
        this.host.setParam(change.target[0], change.target[1], change.value)
        this.sent.set(key, change.value)
        applied.push(change)
      }
      this.pending.clear()
    }

    return applied
  }
}
