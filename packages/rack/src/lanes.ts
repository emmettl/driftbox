import { STEPS_PER_BAR, pointsIn } from './automation.js'
import type { AutoLane } from './types.js'

// Playing a patch's recorded automation back.
//
// **A patch with lanes in it does not play them by itself, and nothing in this package used to say so.** The
// rack's own sequencing lives on the audio thread — a Tracker, an Arranger, a Clock — but automation is
// different in kind: the lanes are in the document, on the host's side, so something on this side has to
// hand them over in time. In this repo that something was forty lines inside `RackApp`, which meant a patch
// opened anywhere else played the patch and not the performance, silently and with nothing to notice. For an
// embedding host — a game opening a shared link — that is the difference between the music somebody authored
// and a version of it with every recorded move missing.
//
// So it moves here, unchanged in design and with the app's two hard-won details intact.
//
// **Accuracy comes from `scheduleParam`, not from the tick.** Each point is handed over with the frame it
// belongs at, so how often this is called decides only how far ahead work is done — never where a value
// lands. A knob delivered one point per tick would be up to a tick late, which is inaudible on a slow sweep
// and quite audible on a filter that is supposed to open exactly on the downbeat.
//
// **The window advances by where it got to**, so a point is queued exactly once. `pointsIn` is open at the
// start and closed at the end for exactly this reason, and the seam is where getting it wrong shows up as a
// knob that jumps twice.

/**
 * What a lane player needs from a rack. Both `Rack` and `RackRenderer` satisfy it.
 *
 * `time` and `beat` are two views of one clock — seconds for scheduling, beats for finding the position in
 * the music — and they have to come from the same host for the same reason `Rack.beat` is derived from
 * `ctx.currentTime` rather than reported from the worklet: a position read from one clock and a frame
 * scheduled against another cannot be made to agree about when now is.
 */
export interface LaneHost {
  readonly beat: number
  readonly time: number
  readonly tempo: number
  readonly running: boolean
  frameFor(seconds: number): number
  scheduleParam(moduleId: string, paramId: string, value: number, frame: number, voice?: number): void
}

export interface LanePlayerOptions {
  /**
   * How far ahead to queue, in seconds. A quarter of a second by default, which is the app's figure: long
   * enough that a tick can be late without a gap, short enough that a seek does not have half a bar of
   * already-scheduled moves to fight.
   */
  lookahead?: number
  /** Four unless the music says otherwise. Only used to turn beats into the sixteenths a lane records in. */
  beatsPerBar?: number
}

/**
 * A lookahead scheduler for a patch's automation.
 *
 * ```js
 * const lanes = new LanePlayer(rack)
 * setInterval(() => lanes.advance(rack.patch.automation), 100)   // or in the game's update loop
 * ```
 *
 * Call `advance` as often as you like — more often than the lookahead is waste, less often is a gap. It
 * queues nothing while the transport is stopped, and it re-queues from the current position after a seek.
 */
export class LanePlayer {
  private readonly host: LaneHost
  private readonly lookahead: number
  private readonly stepsPerBeat: number
  /**
   * The step the window reached last time, or null before it has run at all. Points are queued for
   * `(scheduledTo, until]`.
   */
  private scheduledTo: number | null = null
  /**
   * The position at the previous call, which is what a seek is measured against.
   *
   * **Not the window's end**, and that distinction is the whole of this: the window always sits a lookahead
   * ahead of the music, so comparing the position to it would read as a seek backwards on every single call
   * and re-queue the same points for ever. Measured wrong, it is not a subtle bug — it is the same knob move
   * delivered ten times a second.
   */
  private lastStep: number | null = null

  constructor(host: LaneHost, options: LanePlayerOptions = {}) {
    this.host = host
    this.lookahead = Math.max(0, options.lookahead ?? 0.25)
    const perBar = options.beatsPerBar ?? 4
    this.stepsPerBeat = STEPS_PER_BAR / (Number.isFinite(perBar) && perBar > 0 ? perBar : 4)
  }

  /** Where the window has reached, in steps. Useful in a test, and in a host drawing what is queued. */
  get position(): number {
    return this.scheduledTo ?? 0
  }

  /**
   * Forget what has been queued and start again from where the transport is.
   *
   * Called for you when the position moves backwards — a loop, a seek, a restart — because a window that
   * only ever advanced would sit in the future and queue nothing until the music caught up with it. Exposed
   * because a host that changed the patch's lanes wants the same thing and has no position change to show
   * for it.
   */
  reset(): void {
    this.scheduledTo = null
    this.lastStep = null
  }

  /**
   * Queue every point that falls in the next lookahead.
   *
   * Takes the lanes rather than holding them, because a host edits its patch and the version this was
   * constructed with would go stale — the app reads them from its store on every tick for the same reason.
   */
  advance(lanes: readonly AutoLane[] | undefined): void {
    if (!lanes || lanes.length === 0) return
    const now = this.currentStep()

    if (!this.host.running) {
      // Nothing passes while stopped, and the window follows the position so that pressing play does not
      // hand over a quarter of a second of moves that never happened.
      this.lastStep = now
      this.seed(now)
      return
    }

    // Two cases, one repair. **Never having run** means the window has no business starting at zero: a
    // player built while the music is already at bar eight would otherwise queue every point before it, all
    // at once and all in the past. **Going backwards** is a seek or a loop, and leaving the window in the
    // future would mean silence on every lane until the music caught up with it.
    const sought = this.lastStep !== null && now < this.lastStep
    this.lastStep = now
    if (this.scheduledTo === null || sought) this.seed(now)
    const from = this.scheduledTo as number

    const until = now + this.lookahead * (this.host.tempo / 60) * this.stepsPerBeat
    if (until <= from) return

    const secondsPerStep = 60 / (this.host.tempo * this.stepsPerBeat)
    const time = this.host.time
    for (const lane of lanes) {
      for (const point of pointsIn(lane, from, until)) {
        const at = time + (point.at - now) * secondsPerStep
        this.host.scheduleParam(lane.target[0], lane.target[1], point.value, this.host.frameFor(at))
      }
    }
    this.scheduledTo = until
  }

  /**
   * Start the window just *before* a position rather than on it.
   *
   * `pointsIn` is open at the start, which is what stops a point being queued twice on the seam between two
   * windows — and it would also skip a point sitting exactly where the window began. That is the common
   * case rather than an edge one: a lane's first point is usually at the top of the arrangement, which is
   * where a transport starting from a stop is, so the one value most worth getting right is the one that
   * would go missing. A hair earlier costs nothing, because there is nothing before it to double up with.
   */
  private seed(now: number): void {
    this.scheduledTo = Math.max(0, now) - 1e-6
  }

  private currentStep(): number {
    const beat = this.host.beat
    return Number.isFinite(beat) ? beat * this.stepsPerBeat : 0
  }
}
