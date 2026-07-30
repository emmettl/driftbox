import type { ModuleDef, Processor } from '../types.js'

// A state-variable filter, and deliberately not another ladder.
//
// The Ladder module is four poles, saturating, and self-oscillates — a 303's filter, with all
// the character that implies. This is the opposite and the rack needs both: two poles, clean,
// linear, and stable at any cutoff you can name. It is what you reach for when the filter is
// supposed to shape a sound rather than be the sound.
//
// **All four responses come out at once**, on four outlets, rather than being chosen with a mode
// knob. They are computed together anyway — the topology produces them as intermediate values —
// so a knob would be hiding three of them for nothing. Patching lowpass and highpass to opposite
// ends of a mixer is then a crossover, which is a thing you can only do if both exist at the
// same time.
//
// The topology is the topology-preserving transform (Zavalishin, in Simper's formulation) rather
// than the older Chamberlin one. Chamberlin's is two multiplies cheaper and falls apart above
// about a sixth of the sample rate, which means a cutoff sweep that goes wrong exactly where a
// filter sweep is most exciting. This one is unconditionally stable — the `tan` prewarping is
// what buys that, and it is cached because the common case is a knob sitting still.
//
// This class is SELF-CONTAINED — see the comment in `worklet.ts`.

export class SvfProcessor implements Processor {
  private readonly sampleRate: number

  /** The two integrator states. */
  private ic1 = 0
  private ic2 = 0

  private lastFrequency = Number.NaN
  private lastDamping = Number.NaN
  private a1 = 0
  private a2 = 0
  private a3 = 0
  private k = 0

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
    const cutoffCv = inlets[1]
    const resonanceCv = inlets[2]
    const low = outlets[0]
    const high = outlets[1]
    const band = outlets[2]
    const notch = outlets[3]
    const cutoff = params[0]
    const resonance = params[1]

    const ceiling = this.sampleRate * 0.45

    for (let i = 0; i < frames; i++) {
      // Octaves on the CV inlet, like every other pitch-shaped inlet in the rack.
      let frequency = cutoff[i]
      const octaves = cutoffCv[i]
      if (octaves !== 0) frequency *= Math.pow(2, octaves)
      if (frequency < 20) frequency = 20
      else if (frequency > ceiling) frequency = ceiling

      let res = resonance[i] + resonanceCv[i]
      if (res < 0) res = 0
      else if (res > 1) res = 1
      // Damping, not Q. 2 is heavily damped and 0.04 is a Q of 25 — deliberately short of zero,
      // because a damping of zero is an undamped resonator and an undamped resonator is an
      // infinity waiting for a transient.
      const damping = 2 - 1.96 * res

      if (frequency !== this.lastFrequency || damping !== this.lastDamping) {
        this.lastFrequency = frequency
        this.lastDamping = damping
        const g = Math.tan((Math.PI * frequency) / this.sampleRate)
        this.k = damping
        this.a1 = 1 / (1 + g * (g + damping))
        this.a2 = g * this.a1
        this.a3 = g * this.a2
      }

      const v0 = input[i]
      const v3 = v0 - this.ic2
      const v1 = this.a1 * this.ic1 + this.a2 * v3
      const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3
      this.ic1 = 2 * v1 - this.ic1
      this.ic2 = 2 * v2 - this.ic2

      const hp = v0 - this.k * v1 - v2
      low[i] = v2
      high[i] = hp
      band[i] = v1
      // Highpass plus lowpass, which is what a notch is — written out rather than added, because
      // the sum form is the one that makes the identity obvious to whoever reads it next.
      notch[i] = v0 - this.k * v1
    }
  }
}

export const SVF_MODULE: ModuleDef = {
  type: 'svf',
  version: 1,
  name: 'SVF',
  inlets: [
    { id: 'in', name: 'In' },
    { id: 'cutoff', name: 'Cutoff' },
    { id: 'res', name: 'Res' },
  ],
  outlets: [
    { id: 'lp', name: 'LP' },
    { id: 'hp', name: 'HP' },
    { id: 'bp', name: 'BP' },
    { id: 'notch', name: 'Notch' },
  ],
  params: [
    { id: 'cutoff', name: 'Cutoff', min: 20, max: 18000, default: 1000 },
    { id: 'resonance', name: 'Res', min: 0, max: 1, default: 0 },
  ],
  processor: SvfProcessor,
}
