import type { ModuleDef, Processor } from '../types.js'

// A clock: gate, trigger and a phase ramp.
//
// `docs/RACK.md` listed this and the sequencer as one module. Splitting them was the right call
// and is worth recording: a clock that is not a sequencer can drive four of them at different
// divisions, and a sequencer that has no clock in it can be driven by an envelope, a comparator,
// or another sequencer's gate. One module doing both would have made every one of those a special
// case.
//
// Three outlets because the three are genuinely different things and a patch wants to pick:
//
//   gate   a square whose width is a knob — for holding an envelope open, or gating a VCA
//   trig   a fixed 1ms pulse — for advancing a sequencer, where width means nothing
//   phase  a rising ramp, 0 to 1 each cycle — the thing an LFO's saw is, at clock rate
//
// The rate is in Hz rather than BPM, and there is no tempo sync, because there is no transport
// yet — that is step 5 in `docs/RACK.md`, and when it exists this module grows a mode rather than
// changing shape. 2Hz is 120bpm in quarter notes if it helps.
//
// This class is SELF-CONTAINED — see the comment in `worklet.ts`.

export class ClockProcessor implements Processor {
  private readonly sampleRate: number
  /** How many samples a 1ms trigger lasts. Rounded up, so it is never zero at any sample rate a
   *  browser will hand us — a trigger of zero samples is a trigger nothing downstream can see. */
  private readonly trigSamples: number

  private phase = 0
  private lastReset = 0
  /** Armed at construction, so the clock ticks the instant it starts rather than after a whole
   *  period of silence. Patching a clock in and hearing nothing for a bar reads as a broken module,
   *  and at the bottom of the rate knob that bar is twenty seconds long. */
  private trigLeft: number

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate
    this.trigSamples = Math.max(1, Math.ceil(sampleRate * 0.001))
    this.trigLeft = this.trigSamples
  }

  process(
    inlets: Float32Array[],
    outlets: Float32Array[],
    params: Float32Array[],
    frames: number,
  ): void {
    const rateCv = inlets[0]
    const reset = inlets[1]
    const gateOut = outlets[0]
    const trigOut = outlets[1]
    const phaseOut = outlets[2]
    const rate = params[0]
    const width = params[1]

    for (let i = 0; i < frames; i++) {
      const resetGate = reset[i] >= 0.5 ? 1 : 0
      if (resetGate === 1 && this.lastReset === 0) {
        // A reset fires the beat as well as restarting it, which is what makes a reset useful for
        // starting a pattern in time rather than merely for winding it back.
        this.phase = 0
        this.trigLeft = this.trigSamples
      }
      this.lastReset = resetGate

      let frequency = rate[i]
      const octaves = rateCv[i]
      if (octaves !== 0) frequency *= Math.pow(2, octaves)
      if (frequency < 0) frequency = 0
      else if (frequency > 100) frequency = 100

      this.phase += frequency / this.sampleRate
      if (this.phase >= 1) {
        this.phase -= 1
        if (this.phase >= 1) this.phase = 0
        this.trigLeft = this.trigSamples
      }

      let pw = width[i]
      if (pw < 0.02) pw = 0.02
      else if (pw > 0.98) pw = 0.98

      gateOut[i] = this.phase < pw ? 1 : 0
      if (this.trigLeft > 0) {
        this.trigLeft--
        trigOut[i] = 1
      } else {
        trigOut[i] = 0
      }
      phaseOut[i] = this.phase
    }
  }
}

export const CLOCK_MODULE: ModuleDef = {
  type: 'clock',
  version: 1,
  name: 'Clock',
  inlets: [
    { id: 'rate', name: 'Rate' },
    { id: 'reset', name: 'Reset' },
  ],
  outlets: [
    { id: 'gate', name: 'Gate' },
    { id: 'trig', name: 'Trig' },
    { id: 'phase', name: 'Phase' },
  ],
  params: [
    { id: 'rate', name: 'Rate', min: 0.05, max: 100, default: 2 },
    { id: 'width', name: 'Width', min: 0.02, max: 0.98, default: 0.5 },
  ],
  processor: ClockProcessor,
  // One clock. Eight identical ones would tick together and cost eight times as much to do it.
  poly: false,
}
