import type { ModuleDef, Processor } from '../types.js'

// A two-band stereo imager: split the side signal at one crossover, then give the low and high
// bands independent widths.
//
// **Mid/side rather than gain-and-pan.** Width is the level of L - R while the centre, L + R, is
// left alone. That makes zero mono, one the signal exactly as it arrived, and two twice the
// difference between the speakers. A panner cannot do that: it moves the centre as well as the
// sides, which makes an imager on a mix bus change the balance anybody already set upstream.
//
// **Two bands because bass and width want opposite things.** Keeping the low end centred while the
// top opens out is the useful mastering operation; one full-band width knob makes the kick wander
// with the hats. The side is split by a one-pole lowpass and its exact residual (`side - low`), so
// the two bands sum back to the original sample. With both widths at one the module is therefore
// transparent even while its crossover state is warming up.
//
// The crossover is deliberately gentle. It is not an EQ and the split is never heard on its own:
// it only decides which width control owns a difference signal. A steeper crossover would cost
// more state, more phase shift, and still reconstruct the same side at the transparent defaults.
//
// This class is SELF-CONTAINED — see the comment in `worklet.ts`.

export class ImagerProcessor implements Processor {
  private readonly sampleRate: number
  private sideLow = 0
  private lastCrossover = Number.NaN
  private coefficient = 0

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate > 0 ? sampleRate : 44100
  }

  process(
    inlets: Float32Array[],
    outlets: Float32Array[],
    params: Float32Array[],
    frames: number,
  ): void {
    const inLeft = inlets[0]
    const inRight = inlets[1]
    const outLeft = outlets[0]
    const outRight = outlets[1]
    const lowWidth = params[0]
    const highWidth = params[1]
    const crossover = params[2]

    let sideLow = this.sideLow
    let coefficient = this.coefficient

    for (let i = 0; i < frames; i++) {
      let frequency = crossover[i]
      if (!(frequency > 20)) frequency = 20
      const ceiling = this.sampleRate * 0.45
      if (frequency > ceiling) frequency = ceiling

      if (frequency !== this.lastCrossover) {
        this.lastCrossover = frequency
        // The exact discrete-time coefficient of a one-pole RC lowpass. Computing it only while the
        // knob moves follows the same bargain as the EQ and Reverb: one comparison per sample at rest.
        coefficient = 1 - Math.exp((-2 * Math.PI * frequency) / this.sampleRate)
      }

      const left = inLeft[i]
      const right = inRight[i]
      const mid = (left + right) * 0.5
      const side = (left - right) * 0.5

      sideLow += coefficient * (side - sideLow)
      const sideHigh = side - sideLow
      const widened = sideLow * lowWidth[i] + sideHigh * highWidth[i]
      let outputLeft = mid + widened
      let outputRight = mid - widened

      // A hostile inlet or param must not poison the crossover state for the lifetime of the patch.
      // Resetting lets the next finite block recover instead of merely replacing NaN at the outlets.
      if (!Number.isFinite(outputLeft) || !Number.isFinite(outputRight) || !Number.isFinite(sideLow)) {
        sideLow = 0
        outputLeft = 0
        outputRight = 0
      }

      outLeft[i] = outputLeft
      outRight[i] = outputRight
    }

    this.sideLow = sideLow
    this.coefficient = coefficient
  }
}

export const IMAGER_MODULE: ModuleDef = {
  type: 'imager',
  version: 1,
  name: 'Stereo Imager',
  group: 'Shaping',
  blurb:
    'Keep the bottom centred while the top opens out. Independent low and high width meet at one crossover.',
  logo: {
    paths: [
      'M32 7v30',
      'M29 20L15 11v22l14-9',
      'M35 20l14-9v22l-14-9',
      'M8 38h48',
    ],
  },
  inlets: [{ id: 'in', name: 'In', stereo: true }],
  outlets: [{ id: 'out', name: 'Out', stereo: true }],
  params: [
    { id: 'lowWidth', name: 'Low Width', min: 0, max: 2, default: 1 },
    { id: 'highWidth', name: 'High Width', min: 0, max: 2, default: 1 },
    { id: 'crossover', name: 'X-Over Hz', min: 60, max: 2000, default: 250 },
  ],
  processor: ImagerProcessor,
  // Width belongs to the mixed stereo bus. Running a separate imager per voice would make each voice
  // wide before the polyphonic collapse, which becomes mono and throws the result away.
  poly: false,
}
