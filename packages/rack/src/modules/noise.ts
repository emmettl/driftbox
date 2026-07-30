import { Random } from '../dsp/random.js'
import type { ModuleDef, Processor } from '../types.js'

// White and pink, both at once, on two outlets.
//
// Same argument as the SVF's four outputs: pink is computed *from* white, so hiding one behind a
// selector knob would be spending a knob to withhold something already sitting in a register.
//
// The pink filter is Paul Kellet's refined version — six one-pole sections in parallel whose sum
// tracks -3dB/octave to within about a twentieth of a decibel from a few Hz to Nyquist. The
// coefficients are his and are not adjustable.
//
// One property of the pink outlet is worth knowing before it surprises somebody: it **wanders below
// the audio band**. Amplitude proportional to 1/sqrt(f) means energy keeps rising as frequency
// falls, so over any short window pink has an offset, and a filter fed straight from it sits
// slightly off centre in a way that changes over seconds. That is what pink noise is rather than a
// flaw in this one — if a patch needs it centred, the SVF's highpass outlet is two cables away.
//
// This class is SELF-CONTAINED — see the comment in `worklet.ts`. `Random` arrives through `deps`.

export class NoiseProcessor implements Processor {
  private readonly random: { next(): number }

  private b0 = 0
  private b1 = 0
  private b2 = 0
  private b3 = 0
  private b4 = 0
  private b5 = 0
  private b6 = 0

  constructor(_sampleRate: number, deps: Record<string, unknown>, id: string) {
    const Rng = deps.Random as new (seed: string | number) => { next(): number }
    this.random = new Rng(id)
  }

  process(
    _inlets: Float32Array[],
    outlets: Float32Array[],
    _params: Float32Array[],
    frames: number,
  ): void {
    const white = outlets[0]
    const pink = outlets[1]

    for (let i = 0; i < frames; i++) {
      const w = this.random.next()
      white[i] = w

      this.b0 = 0.99886 * this.b0 + w * 0.0555179
      this.b1 = 0.99332 * this.b1 + w * 0.0750759
      this.b2 = 0.969 * this.b2 + w * 0.153852
      this.b3 = 0.8665 * this.b3 + w * 0.3104856
      this.b4 = 0.55 * this.b4 + w * 0.5329522
      this.b5 = -0.7616 * this.b5 - w * 0.016898
      // 0.325, measured rather than taken from Kellet — his suggested 0.11 leaves pink 9dB quieter
      // than the white outlet next to it, and two outlets on one module at different levels is a
      // trap for anybody patching between them. This lands both at the same RMS: uniform noise in
      // ±1 has an RMS of 1/sqrt(3), and `noise.test.ts` asserts the two agree to within 15%.
      pink[i] =
        (this.b0 + this.b1 + this.b2 + this.b3 + this.b4 + this.b5 + this.b6 + w * 0.5362) * 0.325
      this.b6 = w * 0.115926
    }
  }
}

export const NOISE_MODULE: ModuleDef = {
  type: 'noise',
  version: 1,
  name: 'Noise',
  inlets: [],
  outlets: [
    { id: 'white', name: 'White' },
    { id: 'pink', name: 'Pink' },
  ],
  params: [],
  processor: NoiseProcessor,
  deps: { Random },
}
