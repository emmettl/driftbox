import type { ModuleDef, Processor } from '../types.js'

// An eight-step sequencer: a pitch and an on/off per step, advanced by an external clock.
//
// **There is no clock in it.** `docs/RACK.md` listed clock and sequencer as one module; splitting
// them is what lets a sequencer be advanced by something that is not a clock — an envelope's end,
// a comparator, another sequencer's gate, a manual button. It also means two sequencers can share
// one clock and stay in phase, which a pair of self-clocking ones could never quite do.
//
// The consequence is that a Seq on its own does nothing at all, which is correct and is also the
// first thing that will confuse somebody. It is standard modular behaviour and the Clock module is
// sitting next to it in the list.
//
// **The gate output is the clock's gate AND'd with the step being on.** So the gate *length* comes
// from the Clock's width knob rather than from a knob here — one knob, in the place that already
// owns the shape of the pulse, and turning it shortens every step at once, which is what you
// actually want when a line is too legato.
//
// **A reset does not fire a step.** It winds back to before the first one, so the next clock edge
// plays step 1. The Clock's reset does the opposite and fires immediately, because a clock's job is
// to start the beat and a sequencer's is to be somewhere when the beat arrives.
//
// This class is SELF-CONTAINED — see the comment in `worklet.ts`.

export class SeqProcessor implements Processor {
  private readonly sampleRate: number
  private readonly trigSamples: number

  /** −1 before the first clock, so the first edge plays step 0 rather than step 1. */
  private step = -1
  private lastClock = 0
  private lastReset = 0
  private trigLeft = 0
  private pitch = 0

  private lastGlide = Number.NaN
  private glideCoef = 0

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate
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
    const pitchOut = outlets[0]
    const gateOut = outlets[1]
    const trigOut = outlets[2]
    const length = params[0]
    const glide = params[1]

    for (let i = 0; i < frames; i++) {
      const reset = resetIn[i] >= 0.5 ? 1 : 0
      if (reset === 1 && this.lastReset === 0) this.step = -1
      this.lastReset = reset

      let steps = length[i] | 0
      if (steps < 1) steps = 1
      else if (steps > 8) steps = 8

      const clock = clockIn[i] >= 0.5 ? 1 : 0
      if (clock === 1 && this.lastClock === 0) {
        this.step = this.step + 1 >= steps ? 0 : this.step + 1
        this.trigLeft = this.trigSamples
      }
      this.lastClock = clock

      const active = this.step >= 0 ? this.step : 0
      // params[2..9] are the eight pitches, params[10..17] the eight on/off switches.
      const target = params[2 + active][i] / 12
      const on = this.step >= 0 && (params[10 + active][i] | 0) === 1

      if (glide[i] !== this.lastGlide) {
        this.lastGlide = glide[i]
        // Same 99%-in-the-stated-time convention the envelope uses, so a glide knob marked in
        // seconds means the same thing as a decay knob marked in seconds.
        this.glideCoef =
          glide[i] <= 0 ? 0 : Math.pow(0.01, 1 / Math.max(1, glide[i] * this.sampleRate))
      }
      this.pitch = target + (this.pitch - target) * this.glideCoef

      pitchOut[i] = this.pitch
      gateOut[i] = on && clock === 1 ? 1 : 0
      if (this.trigLeft > 0 && on) {
        this.trigLeft--
        trigOut[i] = 1
      } else {
        if (this.trigLeft > 0) this.trigLeft--
        trigOut[i] = 0
      }
    }
  }
}

const step = (index: number) => ({
  id: `pitch${index + 1}`,
  name: `Pitch ${index + 1}`,
  min: -24,
  max: 24,
  default: 0,
})

const switched = (index: number) => ({
  id: `gate${index + 1}`,
  name: `Gate ${index + 1}`,
  min: 0,
  max: 1,
  // Every step on by default, so a Seq patched to a Clock makes a sound immediately rather than
  // looking broken.
  default: 1,
  stepped: true,
})

export const SEQ_MODULE: ModuleDef = {
  type: 'seq',
  version: 1,
  name: 'Seq',
  inlets: [
    { id: 'clock', name: 'Clock' },
    { id: 'reset', name: 'Reset' },
  ],
  outlets: [
    { id: 'pitch', name: 'Pitch' },
    { id: 'gate', name: 'Gate' },
    { id: 'trig', name: 'Trig' },
  ],
  // Order is load-bearing: the processor reads params[2 + n] for pitches and params[10 + n] for
  // gates. `modules.test.ts` asserts the layout so that inserting a param at the front fails a
  // test rather than transposing somebody's sequence.
  params: [
    { id: 'length', name: 'Length', min: 1, max: 8, default: 8, stepped: true },
    { id: 'glide', name: 'Glide', min: 0, max: 1, default: 0 },
    ...Array.from({ length: 8 }, (_, i) => step(i)),
    ...Array.from({ length: 8 }, (_, i) => switched(i)),
  ],
  processor: SeqProcessor,
}
