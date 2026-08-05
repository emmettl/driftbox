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
// **A fourth interpretation, Curve, is the Matrix's third lane.** Reason's Matrix had a Note CV, a Gate CV and
// a freely drawn Curve against the same clock, and that last one was the sequencer gap `docs/REASON-GAP.md`
// still listed after this module landed: sixty-four steps and eight banks answered the length half, and
// nothing here could draw a modulation shape. A Curve lane inverts the rule above — **zero is a value there,
// not a rest** — and emits no gate and no trigger, because a curve is not a note. Everything else it needs,
// this module already had, which is why it is a mode on a lane rather than a third sequencer.
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
  /**
   * Per lane: the step's value exactly as written, zero included.
   *
   * Separate from `held` because the two answer opposite questions. `held` is "what note is sounding", so it
   * survives a rest — which is what stops a bassline ending every phrase on the wrong note. A curve lane
   * needs the other thing: zero is a value there, and a curve that could not reach it would be a curve with
   * a floor nobody asked for.
   */
  private raw = [0, 0, 0, 0]
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
    const patternIn = inlets[2]
    const lengthParam = params[0]
    // Appended to the param list rather than inserted, so every existing index below is unchanged — the
    // processor reads params[0] for length, then a mute per lane, then a unit per lane, then this.
    const patternParam = params[params.length - 1]

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

      // Which pattern plays. The knob is the base and the inlet adds to it, the same arrangement every
      // other CV-able control here uses — so a patch can select by hand, by sequencer, or by both.
      //
      // The inlet is scaled by sixteen so that **a Tracker's own Unit lane drives it one for one**: a Unit
      // lane emits `value / 16`, so writing 0, 1, 2, 3 into one selects patterns 0, 1, 2, 3 on another.
      // That is the whole song mechanism, and it wanted no new module — one Tracker clocked by the bar
      // chaining another's patterns is an arrangement. Sixteen is inlined for the usual reason.
      let pattern = Math.round(patternParam[i] + patternIn[i] * 16)
      if (pattern < 0) pattern = 0
      else if (pattern > 7) pattern = 7

      // Derived rather than a constant: this class is serialised into a scope that shares nothing with this
      // module, so it cannot read one. Three outlets per lane.
      const lanes = outlets.length / 3

      const clock = clockIn[i] >= 0.5 ? 1 : 0
      if (clock === 1 && this.lastClock === 0) {
        this.step = this.step + 1 >= length ? 0 : this.step + 1
        for (let lane = 0; lane < lanes; lane++) {
          // Read on the edge only. Reading per sample would mean editing a pattern mid-step retriggered it.
          const values = this.data.get(`lane${lane + 1}`)
          // **Patterns are stored end to end in the one lane array**, so pattern p occupies
          // `[p * length, (p + 1) * length)`. That is what makes this change cost nothing in the patch
          // format and nothing in compatibility: a lane of sixteen values at a length of sixteen is
          // exactly pattern 0, which is every patch written before banks existed, byte for byte.
          //
          // The alternative — a slot per pattern, `p2lane1` and so on — would have meant a naming scheme
          // in the data, a migration, and a reader that had to know about banks. This needs none of it.
          const offset = pattern * length + this.step
          const value = values && offset < values.length ? values[offset] : 0
          const muted = Math.round(params[1 + lane][i]) === 1
          // Kept whatever the value is, so a Curve lane can be written down to zero. Still gated on mute,
          // because a muted lane freezing its output is the behaviour the other two modes already have and
          // one lane behaving differently would be the surprise.
          if (!muted) this.raw[lane] = value
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
        const mode = Math.round(params[1 + lanes + lane][i])

        // **Curve: the Matrix's third lane.** Reason's Matrix had a Note CV, a Gate CV and a freely drawn
        // Curve, and the third one is the whole reason `docs/REASON-GAP.md` still listed a sequencer gap
        // after the Tracker landed — the length half was answered by sixty-four steps and eight banks, but
        // nothing here could draw a modulation shape against the same clock.
        //
        // It is a lane MODE rather than a fifth lane or a third sequencer, because the one thing a curve
        // needs that the other interpretations refuse is that **zero is a value**. Everything else it wants
        // — a step per clock, a bank of eight, a length, an editor — the Tracker already had. A device
        // whose only new idea is one lane behaving differently would have been the mistake the reverb's
        // rejected algorithms and the Line Mixer's channel EQ were both refused for.
        //
        // Divided by sixteen like a Unit lane, so a lane drawn 0 to 16 is 0 to 1. Negative values are
        // simply negative — a bipolar curve costs nothing here because a lane holds numbers rather than
        // switches, and Reason needed a mode switch for it.
        if (mode === 2) {
          outlets[lane * 3][i] = this.raw[lane] / 16
          // No gate and no trigger: a curve is not a note. The trigger is still counted down rather than
          // abandoned, so a lane switched to Curve and back mid-pattern does not fire a stale pulse.
          outlets[lane * 3 + 1][i] = 0
          if (this.trigLeft[lane] > 0) this.trigLeft[lane]--
          outlets[lane * 3 + 2][i] = 0
          continue
        }

        const unit = mode === 1
        // Semitones by default, because that is what every other pitch-shaped signal in the rack is. `Unit`
        // divides by sixteen instead — a bar of sixteenths and the Sampler's default slice count — which is what
        // makes a lane of slice indices drive a chopped break directly. Sixteen is inlined because a constant at
        // module scope would not survive being serialised into the worklet.
        outlets[lane * 3][i] = this.held[lane] / (unit ? 16 : 12)
        // The gate follows the clock's own high time, so one knob on the Clock or the Transport shortens every
        // step at once — the same decision `seq` makes and for the same reason.
        // High for the whole STEP, not for the clock's high time.
        //
        // It followed the clock at first, so that one knob on the Clock shortened every step at once. That
        // reads well and was measured to be wrong: the Transport's `sixteenth` is a trigger, high for 1.2%
        // of its period, so a Tracker locked to the transport produced gates 1.2% wide and every envelope
        // driven from one barely opened. It made the basslines in every shipped drum-and-bass patch roughly
        // sixteen times quieter than the break next to them, which is what finally gave it away.
        //
        // A step's gate meaning "this step is sounding" is also just what a tracker's gate is. Strikes have
        // their own outlet, and two consecutive notes now hold the gate rather than retriggering — which is
        // legato, and is what `trig` is there for when it is not what you want.
        outlets[lane * 3 + 1][i] = this.open[lane] ? 1 : 0
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
  group: 'Sequencing',
  blurb:
    'Four lanes of up to sixty-four steps, and eight patterns of them. A bar of drum and bass with the break, the bass and two more parts in it.',
  guide: {
    overview:
      'Tracker stores eight patterns, each with four independent lanes. Every clock edge advances one row; a lane can emit pitch CV, a held gate and a short trigger from that same row so it can drive melodic voices or percussion.',
    concepts: [
      {
        title: 'CV, Gate and Trig answer different needs',
        body: 'CV carries the row’s value continuously. Gate stays high for the step when it is active. Trig is a brief pulse at the step edge—use it to strike envelopes and samplers.',
      },
      {
        title: 'A Curve lane draws modulation, not notes',
        body: 'Set a lane’s Mode to Curve and its numbers stop meaning pitch and start meaning a shape: zero is a value rather than a rest, so the lane can be drawn down to nothing and back. It emits CV only — no gate, no trigger — and negative steps simply go below centre, so a bipolar sweep needs no second control.',
      },
      {
        title: 'Pattern is a bank address',
        body: 'The Pattern control and inlet choose one of eight stored grids; they do not transpose the notes. The Arranger automates that choice to build sections into a song.',
      },
    ],
    firstPatch: [
      'Patch a sixteenth-note clock to Clock and a transport-start pulse to Reset.',
      'Use Lane 1 Trig to fire a Sampler and Lane 2 CV plus Gate to play a synth voice.',
      'Enter a few rows, keep Steps at 16 for one bar, then duplicate the idea into Pattern 2 and vary it.',
    ],
    watchFor: [
      'Mode changes how a lane’s stored numbers are interpreted; choose it before fine-tuning values.',
      'A Curve lane treats zero as a value rather than a rest, so it emits no gate and no trigger. Patch its CV at a cutoff or a level, not at an envelope.',
      'Mute stops a lane’s outputs but keeps its pattern data intact.',
    ],
  },
  logo: {
    paths: [
      'M7 5v30M20 5v30M33 5v30M46 5v30M59 5v30',
      'M7 12h52M7 20h52M7 28h52',
      'M10 8h7M23 16h7M36 24h7M49 8h7M49 32h7',
    ],
  },
  inlets: [
    { id: 'clock', name: 'Clock' },
    { id: 'reset', name: 'Reset' },
    { id: 'pattern', name: 'Pattern' },
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
      // The **id stays `unit`** though the control now has three positions and "unit" names only one of
      // them. A param id is patch data — every saved Tracker, every device patch and every Combinator
      // routing names it — so renaming it to `mode` would cost far more than the tidier word is worth. The
      // display name is free to change and has.
      id: `unit${lane + 1}`,
      name: `Mode ${lane + 1}`,
      min: 0,
      max: 2,
      default: 0,
      stepped: true,
      labels: ['Semi', 'Unit', 'Curve'] as const,
    })),
    // Last, so adding it moved no existing param index. Eight is a bank: enough to build a track out of an
    // intro, a main, a break and a drop with room to spare, and few enough that eight times sixty-four
    // values still fits in a URL alongside everything else.
    { id: 'pattern', name: 'Pattern', min: 0, max: 7, default: 0, stepped: true },
  ],
  processor: TrackerProcessor,
  // One sequence. Eight copies advanced by the same clock would play the same step — the same reasoning as `seq`.
  poly: false,
}

/** So a host does not have to hardcode how many lanes there are. */
export const TRACKER_LANES = LANES
