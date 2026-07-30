import type { ModuleDef, Processor } from '../types.js'

// Saturation. `tanh`, normalised so the knob changes the sound and not the level.
//
// The normalisation is the part worth explaining. `tanh(x * drive)` gets louder as drive rises
// until it saturates, so turning the knob up reads as "louder" rather than "dirtier" and every A/B
// comparison is worthless. Dividing by `tanh(drive)` maps an input of 1.0 back to an output of 1.0
// at every setting, so the knob only changes what happens *between* silence and full scale. That is
// the same argument the engine makes about applying trim after its waveshaper rather than before —
// a soft-clipping curve maps ±1 to ±1, so scaling its input changes saturation and scaling its
// output changes level, and confusing the two costs you a knob that appears to do nothing.
//
// It is also why the knob bottoms out at 0.1 rather than at 1. At a drive of 1 a full-scale sine
// already picks up about 7% third harmonic, which is not a bypass by any reasonable definition. At
// 0.1 the curve is linear to within a thousandth across the whole range and the normalisation puts
// the level back, so the bottom of the knob is genuinely clean.
//
// `bias` shifts the signal before the curve, so the two halves of the waveform saturate
// differently. That is where even harmonics come from, and it is the difference between a
// symmetrical fuzz and something that sounds like a valve.
//
// **Asymmetry generates DC, and it cannot be subtracted out.** The first version of this removed
// `tanh(bias * drive)` from the output, on the theory that the offset's own contribution was the
// problem. It is not: an asymmetric nonlinearity rectifies, so the DC it produces depends on the
// signal going through it and changes as the signal does. Measured on a 0.6 sine at a bias of 0.4,
// what came out had an offset of 0.51 with the static term already removed. So there is a DC
// blocker on the output instead, at 5Hz, which is what every real distortion circuit does and for
// this reason.
//
// The consequence: **this is an audio module.** Run a control voltage through it and the blocker
// will drain it away over about a fifth of a second. Use `offset` for shaping CV.
//
// This class is SELF-CONTAINED — see the comment in `worklet.ts`.

export class DriveProcessor implements Processor {
  /** The DC blocker's pole. 5Hz: below anything anybody would call a note, above the rate at which
   *  an asymmetric curve's offset wanders. */
  private readonly pole: number

  /** The last drive value and the reciprocal computed from it. A static knob is the common case and
   *  `tanh` is not cheap; this turns 128 of them a block into 128 compares. */
  private lastDrive = Number.NaN
  private scale = 1

  private lastIn = 0
  private lastOut = 0

  constructor(sampleRate: number) {
    this.pole = Math.exp((-2 * Math.PI * 5) / sampleRate)
  }

  process(
    inlets: Float32Array[],
    outlets: Float32Array[],
    params: Float32Array[],
    frames: number,
  ): void {
    const input = inlets[0]
    const cv = inlets[1]
    const out = outlets[0]
    const drive = params[0]
    const bias = params[1]

    for (let i = 0; i < frames; i++) {
      let amount = drive[i] + cv[i] * 20
      if (amount < 0.1) amount = 0.1
      else if (amount > 40) amount = 40

      if (amount !== this.lastDrive) {
        this.lastDrive = amount
        this.scale = 1 / Math.tanh(amount)
      }

      const shaped = Math.tanh((input[i] + bias[i]) * amount) * this.scale

      // One-pole DC blocker: a differentiator with a pole put back just under unity.
      const blocked = shaped - this.lastIn + this.pole * this.lastOut
      this.lastIn = shaped
      this.lastOut = blocked
      out[i] = blocked
    }
  }
}

export const DRIVE_MODULE: ModuleDef = {
  type: 'drive',
  version: 1,
  name: 'Drive',
  inlets: [
    { id: 'in', name: 'In' },
    { id: 'cv', name: 'CV' },
  ],
  outlets: [{ id: 'out', name: 'Out' }],
  params: [
    // 0.1 is a bypass — see above, this used to be 1 and 1 is not. 40 is squarewave territory.
    { id: 'drive', name: 'Drive', min: 0.1, max: 40, default: 2 },
    { id: 'bias', name: 'Bias', min: -1, max: 1, default: 0 },
  ],
  processor: DriveProcessor,
}
