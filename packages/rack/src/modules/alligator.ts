import type { ModuleDef, Processor } from '../types.js'

// Three filtered gates across one signal. Reason's Alligator.
//
// It is the one device in Reason that is hard to describe and instantly recognisable: a pad goes in, three
// gates chop it at different rhythms, each through a different band, and what comes out is a rhythm part
// made of something that had no rhythm in it. Nothing in this rack does that. A VCA and a filter give you
// one band gated once; the Alligator's whole point is that the *bands are gated independently*, so the
// low end can hold while the top is stuttering.
//
// **Fixed lowpass, bandpass, highpass — not three configurable filters.** That is the difference between
// this and patching three SVFs into three VCAs, which you can already do. A device is worth having when it
// makes one arrangement effortless, and the fixed split is the arrangement.
//
// **Gates arrive on cables; there is no pattern sequencer inside.** Reason's has three, and here that would
// be the same mistake `docs/RACK.md` records for Clock and Seq: a gate that comes from a cable can come
// from the Tracker, a Clock division, an envelope, a Follower on the kick, or another Alligator. Building
// the sequencer in would have made every one of those a special case.
//
// **Three outlets, not a mix.** Reason sums to a stereo pair with a pan per band; panning here belongs to
// the Out, and three separate outlets are worth more than a mix you would have to unpick — send the low
// band dry and the high band to a delay, which is what people actually do with this device. A Mixer is one
// module away if you want them summed.
//
// **Each band has its own envelope on the gate**, and that is what stops it sounding like a broken cable.
// A raw gate multiplied into audio clicks on every edge, twice; the per-band attack and decay are what make
// it a rhythm rather than a fault. Shared attack, per-band decay: the attack is what stops the click and one
// value does that for all three, while the decay is the actual musical control — a short low and a long high
// is a completely different part from the reverse.
//
// This class is SELF-CONTAINED — see the comment in `worklet.ts`.

/**
 * How many bands. Three, and it is not a number to tune: lowpass, bandpass, highpass *is* the device.
 *
 * Used by the **def** only. The processor derives its own count from `outlets.length`, because a class
 * serialised into an AudioWorkletGlobalScope cannot reference anything at module scope — the same rule and
 * the same derivation `tracker.ts` and `combi.ts` document.
 */
const BANDS = 3

export class AlligatorProcessor implements Processor {
  private readonly sampleRate: number

  /** Two integrator states per band, for the state-variable filters. */
  private ic1 = [0, 0, 0]
  private ic2 = [0, 0, 0]
  /** Where each band's gate envelope currently is. */
  private level = [0, 0, 0]

  private lastFrequency = [Number.NaN, Number.NaN, Number.NaN]
  private a1 = [0, 0, 0]
  private a2 = [0, 0, 0]
  private a3 = [0, 0, 0]
  private k = [0, 0, 0]

  private lastAttack = Number.NaN
  private attackCoefficient = 0
  private lastDecay = [Number.NaN, Number.NaN, Number.NaN]
  private decayCoefficient = [0, 0, 0]

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate
  }

  process(
    inlets: Float32Array[],
    outlets: Float32Array[],
    params: Float32Array[],
    frames: number,
  ): void {
    const input = inlets[0]
    // Derived, not a constant: this class is stringified into a scope that shares nothing with this module.
    const bands = outlets.length
    const attackParam = params[0]
    const ceiling = this.sampleRate * 0.45

    for (let i = 0; i < frames; i++) {
      const attack = attackParam[i]
      if (attack !== this.lastAttack) {
        this.lastAttack = attack
        // The same 99%-in-the-stated-time convention as every other timed knob in the rack.
        this.attackCoefficient =
          attack <= 0 ? 0 : Math.pow(0.01, 1 / Math.max(1, attack * this.sampleRate))
      }

      const sample = input[i]

      for (let band = 0; band < bands; band++) {
        // params: [0] attack, then a frequency, a resonance, a decay and a level per band.
        const frequency0 = params[1 + band][i]
        const resonance = params[1 + bands + band][i]
        const decay = params[1 + bands * 2 + band][i]
        const gain = params[1 + bands * 3 + band][i]

        let frequency = frequency0
        if (frequency < 20) frequency = 20
        else if (frequency > ceiling) frequency = ceiling

        let res = resonance
        if (res < 0) res = 0
        else if (res > 1) res = 1
        // Damping, not Q, and short of zero — an undamped resonator is an infinity waiting for a transient.
        // Same reasoning and the same numbers as `svf.ts`, which is the filter this borrows wholesale.
        const damping = 2 - 1.96 * res

        if (frequency !== this.lastFrequency[band]) {
          this.lastFrequency[band] = frequency
          const g = Math.tan((Math.PI * frequency) / this.sampleRate)
          this.k[band] = damping
          this.a1[band] = 1 / (1 + g * (g + damping))
          this.a2[band] = g * this.a1[band]
          this.a3[band] = g * this.a2[band]
        } else if (damping !== this.k[band]) {
          // Resonance moved but the frequency did not. Recomputing only what changed keeps a knob sitting
          // still off the `tan`, which is the whole reason `svf.ts` caches these at all.
          const g = this.a2[band] / this.a1[band]
          this.k[band] = damping
          this.a1[band] = 1 / (1 + g * (g + damping))
          this.a2[band] = g * this.a1[band]
          this.a3[band] = g * this.a2[band]
        }

        // The topology-preserving transform, as in `svf.ts`. Written out here rather than shared through
        // `deps` because a dep is a whole class and this is six lines of arithmetic — and because the
        // Alligator needs three independent copies of the state, which a shared instance could not give it.
        const v3 = sample - this.ic2[band]
        const v1 = this.a1[band] * this.ic1[band] + this.a2[band] * v3
        const v2 = this.ic2[band] + this.a2[band] * this.ic1[band] + this.a3[band] * v3
        this.ic1[band] = 2 * v1 - this.ic1[band]
        this.ic2[band] = 2 * v2 - this.ic2[band]

        // Band 0 is the lowpass, 1 the bandpass, 2 the highpass — fixed, because that split is the device.
        // A band beyond the third (which no def declares) falls back to the lowpass rather than to silence.
        const filtered =
          band === 1 ? v1 : band === 2 ? sample - this.k[band] * v1 - v2 : v2

        if (decay !== this.lastDecay[band]) {
          this.lastDecay[band] = decay
          this.decayCoefficient[band] =
            decay <= 0 ? 0 : Math.pow(0.01, 1 / Math.max(1, decay * this.sampleRate))
        }

        // The gate, enveloped. Rising towards 1 while the gate is high and falling towards 0 when it drops,
        // which is an AR envelope with no sustain stage — and an AR is exactly right here, because the gate
        // holding the level up *is* the sustain.
        const gate = inlets[1 + band][i] >= 0.5 ? 1 : 0
        const target = gate
        const coefficient = target > this.level[band] ? this.attackCoefficient : this.decayCoefficient[band]
        this.level[band] = target + (this.level[band] - target) * coefficient

        outlets[band][i] = filtered * this.level[band] * gain
      }
    }
  }
}

const perBand = <T>(make: (band: number) => T): T[] => Array.from({ length: BANDS }, (_, i) => make(i))

const NAMES = ['Low', 'Band', 'High'] as const

export const ALLIGATOR_MODULE: ModuleDef = {
  type: 'alligator',
  version: 1,
  name: 'Alligator',
  inlets: [
    { id: 'in', name: 'In' },
    ...perBand((band) => ({ id: `gate${band + 1}`, name: `${NAMES[band]} Gate` })),
  ],
  outlets: perBand((band) => ({ id: `out${band + 1}`, name: NAMES[band] })),
  // Order is load-bearing: the processor reads params[0] as the shared attack, then a frequency, a
  // resonance, a decay and a level per band, each in a block of `bands`. `alligator.test.ts` asserts the
  // layout, so inserting one at the front fails a test rather than silently retuning a band.
  params: [
    // Shared, and short: this exists to stop the click on a gate edge, not to be a musical control. The
    // per-band decay is the one you actually play with.
    { id: 'attack', name: 'Attack', min: 0.0005, max: 0.2, default: 0.003 },
    // Defaults that put the three bands somewhere sensible without being asked: a low, a mid and a top.
    ...perBand((band) => ({
      id: `freq${band + 1}`,
      name: `${NAMES[band]} Freq`,
      min: 20,
      max: 18000,
      default: [220, 1200, 4000][band],
    })),
    ...perBand((band) => ({
      id: `res${band + 1}`,
      name: `${NAMES[band]} Res`,
      min: 0,
      max: 1,
      // Some resonance by default on the band-pass, because a bandpass with none is a gentle hump and the
      // point of the middle band is that it is a voice of its own.
      default: [0.2, 0.5, 0.2][band],
    })),
    ...perBand((band) => ({
      id: `decay${band + 1}`,
      name: `${NAMES[band]} Decay`,
      min: 0.001,
      max: 2,
      // Long at the bottom, short at the top, which is the shape that reads as a rhythm rather than as
      // three copies of one. It is also the way round a room behaves.
      default: [0.25, 0.12, 0.06][band],
    })),
    ...perBand((band) => ({
      id: `level${band + 1}`,
      name: `${NAMES[band]} Level`,
      min: 0,
      max: 2,
      default: 1,
    })),
  ],
  processor: AlligatorProcessor,
}

/** So a host does not have to hardcode how many bands there are. */
export const ALLIGATOR_BANDS = BANDS
