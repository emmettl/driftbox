import { Random } from '../dsp/random.js'
import type { ModuleDef, Processor } from '../types.js'

// A low-frequency oscillator, with a bipolar and a unipolar outlet.
//
// Both outlets, for the reason the SVF gives about its four: the conversion is one multiply and
// one add, and a knob that picked between them would be a knob spent on hiding something. It also
// removes the single most common piece of patch furniture in a modular — the offset module whose
// only job is turning ±1 into 0..1 so it can drive a VCA.
//
// The shapes are NOT band-limited, unlike the VCO's. That is a deliberate difference rather than
// an oversight: at 3Hz there is nothing above Nyquist to alias, and PolyBLEP's correction is two
// samples wide, so at LFO rates it would be spending arithmetic to alter a waveform by an amount
// no modulation destination could resolve. The rate goes up to 40Hz, which is inside the audio
// band, and a square wave up there patched to an audio destination will buzz — that is what the
// VCO is for, and the ceiling exists so that an LFO can be a rhythm rather than a drone.
//
// This class is SELF-CONTAINED — see the comment in `worklet.ts`. `Random` arrives through `deps`.

export class LfoProcessor implements Processor {
  private readonly sampleRate: number
  private readonly random: { next(): number }

  private phase = 0
  private lastReset = 0
  /** The held value for the random shape, resampled once per cycle. */
  private held = 0

  constructor(sampleRate: number, deps: Record<string, unknown>, id: string) {
    this.sampleRate = sampleRate
    const Rng = deps.Random as new (seed: string | number) => { next(): number }
    this.random = new Rng(id)
    this.held = this.random.next()
  }

  process(
    inlets: Float32Array[],
    outlets: Float32Array[],
    params: Float32Array[],
    frames: number,
  ): void {
    const rateCv = inlets[0]
    const reset = inlets[1]
    const bi = outlets[0]
    const uni = outlets[1]
    const rate = params[0]
    const shape = params[1]

    for (let i = 0; i < frames; i++) {
      // A rising edge on reset restarts the cycle. Threshold at 0.5 rather than 0 so that an
      // audio-rate signal patched here does not retrigger on its own noise floor.
      const gate = reset[i] >= 0.5 ? 1 : 0
      if (gate === 1 && this.lastReset === 0) {
        this.phase = 0
        this.held = this.random.next()
      }
      this.lastReset = gate

      // Octaves, like every other frequency-shaped inlet in the rack: +1 is twice the rate. An LFO
      // whose CV inlet were in Hz would sweep unusably fast at the top and not at all at the
      // bottom.
      let frequency = rate[i]
      const octaves = rateCv[i]
      if (octaves !== 0) frequency *= Math.pow(2, octaves)
      if (frequency < 0) frequency = 0
      else if (frequency > 40) frequency = 40

      this.phase += frequency / this.sampleRate
      if (this.phase >= 1) {
        this.phase -= 1
        if (this.phase >= 1) this.phase = 0
        this.held = this.random.next()
      }
      const t = this.phase

      let value: number
      switch (shape[i] | 0) {
        case 1:
          // Triangle, rising from -1 at phase 0 to 1 at the half point.
          value = t < 0.5 ? 4 * t - 1 : 3 - 4 * t
          break
        case 2:
          value = 2 * t - 1
          break
        case 3:
          value = t < 0.5 ? 1 : -1
          break
        case 4:
          value = this.held
          break
        default:
          value = Math.sin(2 * Math.PI * t)
      }

      bi[i] = value
      uni[i] = value * 0.5 + 0.5
    }
  }
}

export const LFO_MODULE: ModuleDef = {
  type: 'lfo',
  version: 1,
  name: 'LFO',
  group: 'Modulation',
  blurb:
    'A slow oscillator, bipolar and unipolar at the same time. Wobble on a filter, tremolo on a level, drift on anything.',
  inlets: [
    { id: 'rate', name: 'Rate' },
    { id: 'reset', name: 'Reset' },
  ],
  outlets: [
    { id: 'bi', name: 'Bi' },
    { id: 'uni', name: 'Uni' },
  ],
  params: [
    // A hundred seconds a cycle at the bottom, which is slow enough to be a structure rather than
    // a wobble.
    { id: 'rate', name: 'Rate', min: 0.01, max: 40, default: 2 },
    { id: 'shape', name: 'Shape', min: 0, max: 4, default: 0, stepped: true,
      labels: ['Sine', 'Tri', 'Saw', 'Square', 'Random'] },
  ],
  processor: LfoProcessor,
  deps: { Random },
}
