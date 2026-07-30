import type { ModuleDef, Processor } from '../types.js'

// An oscillator, band-limited.
//
// A naive saw is four lines and sounds like a fax machine anywhere near the top of the
// keyboard: every harmonic above Nyquist folds back down to a frequency that is not a
// harmonic of anything, so the sound acquires a metallic shimmer that does not move when
// the pitch does. Reason's oscillators were band-limited in 2000 on a 300MHz G3 and so is
// this one — it is not the expensive part.
//
// The method is PolyBLEP: at each discontinuity, subtract a two-sample polynomial that
// approximates the difference between the naive step and a band-limited one. It is a fraction
// of the code of a wavetable and none of the memory, and it is honestly a middling
// approximation — `vco.test.ts` measures it against an additively-synthesised reference and
// finds 25 to 52dB of alias suppression, along with a real cost at the top of the range: at
// 5kHz the third harmonic comes out 3dB shy of where it should be. Both of those numbers are
// what two multiplies per discontinuity buys. A minBLEP or an oversampled wavetable would do
// better and neither is worth it before there is a rack to play.
//
// The triangle is deliberately naive. Its harmonics fall off as 1/n² rather than 1/n, so
// what folds back is 20-odd dB down before it starts; blepping the slope discontinuities
// of a triangle needs a different correction (a BLAMP, not a BLEP) and it would be spent on
// something nobody can hear.
//
// This class is SELF-CONTAINED — see the comment in `worklet.ts`.

export class VcoProcessor implements Processor {
  private readonly sampleRate: number
  private phase = 0
  /** The last exponent handed to Math.pow, and its result. A static pitch is the common
   *  case by a wide margin, and this turns 128 pow() calls a block into 128 compares. */
  private lastExponent = Number.NaN
  private lastRatio = 1

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate
  }

  process(
    inlets: Float32Array[],
    outlets: Float32Array[],
    params: Float32Array[],
    frames: number,
  ): void {
    const pitch = inlets[0]
    const fm = inlets[1]
    const out = outlets[0]
    const tune = params[0]
    const shape = params[1]
    const width = params[2]

    for (let i = 0; i < frames; i++) {
      // 0 V is C2. One unit of pitch CV is an octave — volts-per-octave, the convention
      // every modular since the Model 15 has used — and `tune` is in semitones so that a
      // knob on a faceplate can be marked in something a musician recognises.
      const exponent = tune[i] / 12 + pitch[i]
      if (exponent !== this.lastExponent) {
        this.lastExponent = exponent
        this.lastRatio = Math.pow(2, exponent)
      }
      const carrier = 65.40639132514966 * this.lastRatio

      // Linear FM, with the index in units of the carrier — so an FM input of 1.0 is one
      // carrier frequency of deviation whatever note is being played, and the timbre holds
      // still as you play up the keyboard. Exponential FM is the `pitch` inlet; both are
      // useful and they are not the same effect.
      let frequency = carrier + carrier * fm[i]
      if (!(frequency > 0)) frequency = 0

      // 0.45 rather than 0.5: PolyBLEP's correction is two samples wide, and past about
      // there the two discontinuities of a pulse start to overlap and the correction stops
      // meaning anything.
      let dt = frequency / this.sampleRate
      if (dt > 0.45) dt = 0.45

      this.phase += dt
      if (this.phase >= 1) this.phase -= 1
      const t = this.phase

      let value: number
      const kind = shape[i] | 0
      if (kind === 1) {
        // Two discontinuities, in opposite directions: up at the top of the cycle, down at
        // the pulse width.
        let pw = width[i]
        if (pw < 0.05) pw = 0.05
        else if (pw > 0.95) pw = 0.95
        value = t < pw ? 1 : -1
        value += this.blep(t, dt)
        let fall = t - pw
        if (fall < 0) fall += 1
        value -= this.blep(fall, dt)
      } else if (kind === 2) {
        value = 1 - 4 * Math.abs(t - 0.5)
      } else {
        value = 2 * t - 1 - this.blep(t, dt)
      }
      out[i] = value
    }
  }

  /**
   * The PolyBLEP residual, scaled for a jump of 2 — which is what all of these are, since
   * every shape here runs ±1.
   *
   * `t` is the phase and `dt` the phase increment, so the correction is applied for the one
   * sample before a discontinuity and the one after it. Away from those it is exactly zero,
   * which is what makes this cheap: the branch is false for all but two samples a cycle.
   */
  private blep(t: number, dt: number): number {
    if (t < dt) {
      const x = t / dt
      return x + x - x * x - 1
    }
    if (t > 1 - dt) {
      const x = (t - 1) / dt
      return x * x + x + x + 1
    }
    return 0
  }
}

export const VCO_MODULE: ModuleDef = {
  type: 'vco',
  version: 1,
  name: 'VCO',
  inlets: [
    { id: 'pitch', name: 'V/Oct' },
    { id: 'fm', name: 'FM' },
  ],
  outlets: [{ id: 'out', name: 'Out' }],
  params: [
    { id: 'tune', name: 'Tune', min: -24, max: 24, default: 0 },
    // Stepped: a waveform selector two thirds of the way between saw and pulse is not a
    // sound, and a ramping value would make the selector flicker across the changeover.
    { id: 'shape', name: 'Shape', min: 0, max: 2, default: 0, stepped: true, labels: ['Saw', 'Pulse', 'Tri'] },
    { id: 'width', name: 'Width', min: 0.05, max: 0.95, default: 0.5 },
  ],
  processor: VcoProcessor,
}
