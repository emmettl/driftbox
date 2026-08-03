import { Osc } from '../dsp/osc.js'
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
// This class is SELF-CONTAINED — see the comment in `worklet.ts`. The oscillator itself lives in
// `dsp/osc.ts` and arrives through `deps`, so the Voice module can use the same one rather than a copy
// that would quietly drift from the numbers measured above.

/** What this module needs of the shared oscillator. Structural rather than the class itself, because the
 *  serialised processor may never name it — see the constructor. */
interface OscLike {
  next(dt: number, shape: number, width: number): number
}

export class VcoProcessor implements Processor {
  private readonly sampleRate: number
  private readonly osc: OscLike
  /** The last exponent handed to Math.pow, and its result. A static pitch is the common
   *  case by a wide margin, and this turns 128 pow() calls a block into 128 compares. */
  private lastExponent = Number.NaN
  private lastRatio = 1

  constructor(sampleRate: number, deps: Record<string, unknown>) {
    this.sampleRate = sampleRate
    // Through `deps` rather than as an import: this class is serialised into a scope of its own, so a
    // captured reference would be a ReferenceError the moment the first patch loaded. By string key and
    // never by identifier — see the long note in `worklet.ts` about what a minifier does to a class name.
    const Oscillator = deps.Osc as new () => OscLike
    this.osc = new Oscillator()
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

      out[i] = this.osc.next(dt, shape[i] | 0, width[i])
    }
  }
}

export const VCO_MODULE: ModuleDef = {
  type: 'vco',
  version: 1,
  name: 'VCO',
  group: 'Sources',
  blurb:
    'Band-limited saw, pulse and triangle, with a width knob on the pulse. The thing that makes a note, and where most patches start.',
  logo: {
    paths: [
      'M4 27l12-16v16l12-16v16l12-16v16',
      'M44 27v-16h12v16',
      'M4 32h52',
    ],
  },
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
  deps: { Osc },
}
