import type { ModuleDef, Processor } from '../types.js'

// A three-band equaliser: low shelf, parametric mid, high shelf.
//
// **The rack had no EQ at all, and that was the most conspicuous absence in it.** There were two filters and
// neither is one: the Ladder is a 303's filter and the SVF is a clean two-pole, and both of them *remove* a
// part of the spectrum. Nothing could add 2dB at 80Hz or take 3dB out at 400Hz, which is not a filter
// operation — it is the operation a mixing desk does on every channel, and this rack grew mixer strips
// before it grew the thing that goes on one.
//
// Approximating it was possible and is the reason this is worth a module rather than a chunk: split an SVF's
// four outlets into a Mixer with signed levels and you have a three-band tone control, at the cost of six
// modules, a page of cables, and no control over where the bands sit. A device earns its place by making one
// arrangement effortless — the same argument `alligator.ts` makes for its fixed band split.
//
// **Shelves at the ends, a parametric in the middle.** That is the channel strip every desk converged on,
// and the reason is that the two jobs are different: the ends are tone and want to move everything above or
// below a corner, while the problem in the middle is always a specific frequency and wants a Q. Three
// parametric bands would be more capable and would spend three more knobs to be worse at the two jobs
// anybody actually has.
//
// **Stereo in and out**, unlike the two filters. Not because an EQ is a stereo effect — it is not; the curve
// is the point and it applies to both channels equally — but because of where it sits. An EQ goes at the end
// of a chain, and a mono module there folds whatever reached it, so a mono EQ after the Reverb would throw
// away the width that stereo cables exist to carry. Each channel keeps its own filter states and shares the
// coefficients, which is what "the same curve on both" means arithmetically.
//
// The coefficients are the RBJ cookbook's, computed in a **transposed direct form II** — better numerics
// than direct form I at the low corner frequencies a shelf actually uses, and two state variables per
// section rather than four.
//
// **Recomputed only when a knob has moved**, which is the same trade `reverb.ts` makes for its damping and
// `svf.ts` makes for its prewarped `tan`. A knob sitting still costs one comparison per sample; a knob being
// dragged ramps across the block and so recomputes per sample for the length of that gesture, which is the
// honest price of a control that responds at audio rate rather than at block rate.
//
// This class is SELF-CONTAINED — see the comment in `worklet.ts`.

export class EqProcessor implements Processor {
  private readonly sampleRate: number

  /** Per band, per channel: the two states of a transposed direct form II biquad. */
  private readonly z1: number[]
  private readonly z2: number[]

  /** Per band: the five coefficients, already divided through by a0. */
  private readonly b0: number[]
  private readonly b1: number[]
  private readonly b2: number[]
  private readonly a1: number[]
  private readonly a2: number[]

  /** What the knobs were when the coefficients were last computed. NaN forces the first pass. */
  private lastLow = Number.NaN
  private lastLowFreq = Number.NaN
  private lastMid = Number.NaN
  private lastMidFreq = Number.NaN
  private lastQ = Number.NaN
  private lastHigh = Number.NaN
  private lastHighFreq = Number.NaN

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate > 0 ? sampleRate : 44100
    // Three bands, two channels: six pairs of states, flattened as band * 2 + channel.
    this.z1 = [0, 0, 0, 0, 0, 0]
    this.z2 = [0, 0, 0, 0, 0, 0]
    this.b0 = [1, 1, 1]
    this.b1 = [0, 0, 0]
    this.b2 = [0, 0, 0]
    this.a1 = [0, 0, 0]
    this.a2 = [0, 0, 0]
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

    const lowParam = params[0]
    const lowFreqParam = params[1]
    const midParam = params[2]
    const midFreqParam = params[3]
    const qParam = params[4]
    const highParam = params[5]
    const highFreqParam = params[6]

    const b0 = this.b0
    const b1 = this.b1
    const b2 = this.b2
    const a1 = this.a1
    const a2 = this.a2
    const z1 = this.z1
    const z2 = this.z2
    const nyquist = this.sampleRate / 2

    for (let i = 0; i < frames; i++) {
      const low = lowParam[i]
      const lowFreq = lowFreqParam[i]
      const mid = midParam[i]
      const midFreq = midFreqParam[i]
      const q = qParam[i]
      const high = highParam[i]
      const highFreq = highFreqParam[i]

      if (
        low !== this.lastLow ||
        lowFreq !== this.lastLowFreq ||
        mid !== this.lastMid ||
        midFreq !== this.lastMidFreq ||
        q !== this.lastQ ||
        high !== this.lastHigh ||
        highFreq !== this.lastHighFreq
      ) {
        this.lastLow = low
        this.lastLowFreq = lowFreq
        this.lastMid = mid
        this.lastMidFreq = midFreq
        this.lastQ = q
        this.lastHigh = high
        this.lastHighFreq = highFreq

        for (let band = 0; band < 3; band++) {
          const gainDb = band === 0 ? low : band === 1 ? mid : high
          let frequency = band === 0 ? lowFreq : band === 1 ? midFreq : highFreq

          // Kept clear of both ends: a corner at zero has no meaning and one at Nyquist makes `tan` blow
          // up. 0.49 rather than 0.5 because the cookbook's `cos(w0)` is already inaccurate as w0 nears π.
          if (!(frequency > 20)) frequency = 20
          const ceiling = nyquist * 0.98
          if (frequency > ceiling) frequency = ceiling

          const w0 = (2 * Math.PI * frequency) / this.sampleRate
          const cos = Math.cos(w0)
          const sin = Math.sin(w0)
          // A is the square root of the linear gain, which is what makes a peaking filter's midpoint the
          // number on the knob. `10 ** (dB / 40)`, not `/ 20`.
          const A = Math.pow(10, gainDb / 40)

          let n0 = 1
          let n1 = 0
          let n2 = 0
          let d0 = 1
          let d1 = 0
          let d2 = 0

          if (band === 1) {
            // Peaking. Q is the knob, and it is the one control the shelves deliberately do not have.
            let shape = q
            if (!(shape > 0.1)) shape = 0.1
            const alpha = sin / (2 * shape)
            n0 = 1 + alpha * A
            n1 = -2 * cos
            n2 = 1 - alpha * A
            d0 = 1 + alpha / A
            d1 = -2 * cos
            d2 = 1 - alpha / A
          } else {
            // Shelves, at S = 1 — the steepest slope that cannot overshoot into a resonant bump. A shelf
            // with a Q knob is a thing some desks have and every one of them uses it to make a mistake.
            const alpha = (sin / 2) * Math.SQRT2
            const twoRootA = 2 * Math.sqrt(A) * alpha
            const plus = A + 1
            const minus = A - 1
            if (band === 0) {
              n0 = A * (plus - minus * cos + twoRootA)
              n1 = 2 * A * (minus - plus * cos)
              n2 = A * (plus - minus * cos - twoRootA)
              d0 = plus + minus * cos + twoRootA
              d1 = -2 * (minus + plus * cos)
              d2 = plus + minus * cos - twoRootA
            } else {
              n0 = A * (plus + minus * cos + twoRootA)
              n1 = -2 * A * (minus + plus * cos)
              n2 = A * (plus + minus * cos - twoRootA)
              d0 = plus - minus * cos + twoRootA
              d1 = 2 * (minus - plus * cos)
              d2 = plus - minus * cos - twoRootA
            }
          }

          // Normalised once here rather than per sample, and guarded: a d0 of zero is not reachable from
          // the declared param ranges, but a plan that crossed postMessage is not a promise about that.
          const scale = d0 === 0 || !Number.isFinite(d0) ? 1 : 1 / d0
          b0[band] = n0 * scale
          b1[band] = n1 * scale
          b2[band] = n2 * scale
          a1[band] = d1 * scale
          a2[band] = d2 * scale
        }
      }

      // Three sections in series, per channel. The state index is `band * 2 + channel`, so the two
      // channels interleave rather than living in two arrays — one allocation, and the pair stays adjacent
      // in memory, which is where it is read.
      let left = inLeft[i]
      let right = inRight[i]
      for (let band = 0; band < 3; band++) {
        const nb0 = b0[band]
        const nb1 = b1[band]
        const nb2 = b2[band]
        const na1 = a1[band]
        const na2 = a2[band]

        const l = band * 2
        const outL = nb0 * left + z1[l]
        z1[l] = nb1 * left - na1 * outL + z2[l]
        z2[l] = nb2 * left - na2 * outL
        left = outL

        const r = l + 1
        const outR = nb0 * right + z1[r]
        z1[r] = nb1 * right - na1 * outR + z2[r]
        z2[r] = nb2 * right - na2 * outR
        right = outR
      }

      // A biquad given a hostile coefficient can run away, and a NaN reaching an AudioNode silences it for
      // the life of the context. Cheaper to catch it here than to make the Graph's final clamp the only
      // thing standing between a bad patch and a dead tab — and unlike that clamp, this also resets the
      // state, so the filter recovers instead of staying poisoned for ever.
      if (!Number.isFinite(left) || !Number.isFinite(right)) {
        for (let s = 0; s < 6; s++) {
          z1[s] = 0
          z2[s] = 0
        }
        left = 0
        right = 0
      }

      outLeft[i] = left
      outRight[i] = right
    }
  }
}

export const EQ_MODULE: ModuleDef = {
  type: 'eq',
  version: 1,
  name: 'EQ',
  group: 'Shaping',
  blurb:
    'Three bands: a low shelf, a sweepable mid with a Q, and a high shelf. Add or take away rather than cut off.',
  logo: {
    paths: ['M6 32h52', 'M14 32c6 0 6-14 12-14s6 20 12 20 6-10 12-10', 'M14 44v-24', 'M50 44v-24'],
  },
  inlets: [{ id: 'in', name: 'In', stereo: true }],
  outlets: [{ id: 'out', name: 'Out', stereo: true }],
  params: [
    // Flat by default, every band. An EQ dropped into a chain must not change the sound until it is asked
    // to — the same promise the Reverb's dry default makes.
    { id: 'low', name: 'Low', min: -18, max: 18, default: 0 },
    { id: 'lowFreq', name: 'Low Hz', min: 40, max: 500, default: 120 },
    { id: 'mid', name: 'Mid', min: -18, max: 18, default: 0 },
    { id: 'midFreq', name: 'Mid Hz', min: 100, max: 8000, default: 1000 },
    // Wide enough to be a tone control, narrow enough to notch a resonance. Below about 0.4 a peaking
    // filter stops being an EQ band and starts being a tilt.
    { id: 'q', name: 'Q', min: 0.3, max: 8, default: 0.9 },
    { id: 'high', name: 'High', min: -18, max: 18, default: 0 },
    { id: 'highFreq', name: 'High Hz', min: 1500, max: 16000, default: 6000 },
  ],
  processor: EqProcessor,
}
