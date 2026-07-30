import type { ModuleData, ModuleDef, Processor } from '../types.js'

// Four lanes of up to sixty-four steps, from pattern data rather than from knobs.
//
// The existing `seq` is eight steps of pitch with a knob each: immediate, needs no data, and the right thing to
// reach for when you want a line and you want it now. This is the other one — long enough for a drum-and-bass
// bar, wide enough to drive a break and a bassline and two more things at once, and its pattern lives in
// `PatchModule.data` because 4 × 64 is 256 values and that is not 256 knobs. It is the reason A2 existed.
//
// Both are kept rather than one replacing the other. Rewriting `seq`'s param shape would have broken every patch
// already shared as a URL, and "a short one with knobs" and "a long one with a pattern" are genuinely different
// instruments to reach for.
//
// **Each lane is values, not switches.** A step is a number: zero is a rest, anything else opens the gate *and*
// comes out as a CV. That one decision is what lets the same module drive drums (any non-zero), a bassline
// (semitones), and a chopped break (slice indices) — which is three modules in most racks.
//
// The CV holds its last non-zero value across rests, so a rest is a gap in the rhythm rather than a lurch down to
// zero in the pitch. A sequencer that dropped to zero on every rest would make every bassline end each phrase on
// the same wrong note.
//
// Clocked from an inlet and not from the transport, so it is the Transport module's `sixteenth` that makes it a
// sixteenth — see the comment there about why exactly one module reads the transport.
//
// This class is SELF-CONTAINED — see the comment in `worklet.ts`.

/**
 * How many lanes. Four covers a break, a bass, and two more things.
 *
 * Used by the **def** only. The processor derives its own lane count from `outlets.length / 3` instead, because a
 * class that gets serialised into an AudioWorkletGlobalScope may not reference anything at module scope — see the
 * comment in `worklet.ts`. The first version of this read `LANES` inside `process` and the contract suite caught
 * it as a ReferenceError, which is exactly what that test exists for. Deriving it also means the two cannot
 * disagree: the class learns its shape from what it is handed.
 */
const LANES = 4

export class TrackerProcessor implements Processor {
  private readonly data: ModuleData
  private readonly trigSamples: number

  /** −1 before the first clock, so the first edge plays step 0 rather than step 1. */
  private step = -1
  private lastClock = 0
  private lastReset = 0
  /** Per lane: the CV being held, and how many samples of trigger are left. */
  private held = [0, 0, 0, 0]
  private trigLeft = [0, 0, 0, 0]
  /** Whether each lane's step is sounding, so the gate can follow the clock's own width. */
  private open = [false, false, false, false]

  constructor(sampleRate: number, _deps: Record<string, unknown>, _id: string, data: ModuleData) {
    this.data = data
    this.trigSamples = Math.max(1, Math.ceil(sampleRate * 0.001))
  }

  process(
    inlets: Float32Array[],
    outlets: Float32Array[],
    params: Float32Array[],
    frames: number,
  ): void {
    const clockIn = inlets[0]
    const resetIn = inlets[1]
    const lengthParam = params[0]

    for (let i = 0; i < frames; i++) {
      const reset = resetIn[i] >= 0.5 ? 1 : 0
      if (reset === 1 && this.lastReset === 0) {
        // Winds back to before the first step, so the next clock plays step one — matching `seq`, and unlike the
        // Clock, whose reset fires immediately. A sequencer's job is to be somewhere when the beat arrives.
        this.step = -1
      }
      this.lastReset = reset

      let length = Math.round(lengthParam[i])
      if (length < 1) length = 1
      else if (length > 64) length = 64

      // Derived rather than a constant: this class is serialised into a scope that shares nothing with this
      // module, so it cannot read one. Three outlets per lane.
      const lanes = outlets.length / 3

      const clock = clockIn[i] >= 0.5 ? 1 : 0
      if (clock === 1 && this.lastClock === 0) {
        this.step = this.step + 1 >= length ? 0 : this.step + 1
        for (let lane = 0; lane < lanes; lane++) {
          // Read on the edge only. Reading per sample would mean editing a pattern mid-step retriggered it.
          const values = this.data.get(`lane${lane + 1}`)
          const value = values && this.step < values.length ? values[this.step] : 0
          const muted = Math.round(params[1 + lane][i]) === 1
          this.open[lane] = value !== 0 && !muted
          if (this.open[lane]) {
            this.trigLeft[lane] = this.trigSamples
            // Held across rests: a rest is a gap in the rhythm, not a lurch to zero in the pitch.
            this.held[lane] = value
          }
        }
      }
      this.lastClock = clock

      for (let lane = 0; lane < lanes; lane++) {
        const unit = Math.round(params[1 + lanes + lane][i]) === 1
        // Semitones by default, because that is what every other pitch-shaped signal in the rack is. `Unit`
        // divides by sixteen instead — a bar of sixteenths and the Sampler's default slice count — which is what
        // makes a lane of slice indices drive a chopped break directly. Sixteen is inlined because a constant at
        // module scope would not survive being serialised into the worklet.
        outlets[lane * 3][i] = this.held[lane] / (unit ? 16 : 12)
        // The gate follows the clock's own high time, so one knob on the Clock or the Transport shortens every
        // step at once — the same decision `seq` makes and for the same reason.
        outlets[lane * 3 + 1][i] = this.open[lane] && clock === 1 ? 1 : 0
        if (this.trigLeft[lane] > 0) {
          this.trigLeft[lane]--
          outlets[lane * 3 + 2][i] = 1
        } else {
          outlets[lane * 3 + 2][i] = 0
        }
      }
    }
  }
}

const laneOutlets = () =>
  Array.from({ length: LANES }, (_, lane) => [
    { id: `cv${lane + 1}`, name: `CV ${lane + 1}` },
    { id: `gate${lane + 1}`, name: `Gate ${lane + 1}` },
    { id: `trig${lane + 1}`, name: `Trig ${lane + 1}` },
  ]).flat()

export const TRACKER_MODULE: ModuleDef = {
  type: 'tracker',
  version: 1,
  name: 'Tracker',
  inlets: [
    { id: 'clock', name: 'Clock' },
    { id: 'reset', name: 'Reset' },
  ],
  // Three per lane. A CV to play, a gate to hold something open, and a trigger to strike something — which are
  // three different questions and a patch usually wants two of them.
  outlets: laneOutlets(),
  // Order is load-bearing: the processor reads params[0] for length, then a mute per lane, then a unit per lane.
  // `tracker.test.ts` asserts the layout, so inserting one at the front fails a test rather than silently muting
  // a lane or transposing a pattern.
  params: [
    // 16 is a bar of sixteenths; 64 is four bars, which is the phrase length most drum and bass is written in.
    { id: 'length', name: 'Steps', min: 1, max: 64, default: 16, stepped: true },
    ...Array.from({ length: LANES }, (_, lane) => ({
      id: `mute${lane + 1}`,
      name: `Mute ${lane + 1}`,
      min: 0,
      max: 1,
      default: 0,
      stepped: true,
      labels: ['On', 'Off'] as const,
    })),
    ...Array.from({ length: LANES }, (_, lane) => ({
      id: `unit${lane + 1}`,
      name: `Unit ${lane + 1}`,
      min: 0,
      max: 1,
      default: 0,
      stepped: true,
      labels: ['Semi', 'Unit'] as const,
    })),
  ],
  processor: TrackerProcessor,
  // One sequence. Eight copies advanced by the same clock would play the same step — the same reasoning as `seq`.
  poly: false,
}

/** So a host does not have to hardcode how many lanes there are. */
export const TRACKER_LANES = LANES
