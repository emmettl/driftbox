import { Ladder } from '@driftbox/engine'
import type { ModuleDef, Processor } from '../types.js'

// The 303's filter, as a rack module.
//
// The DSP is not here. `Ladder` lives in `@driftbox/engine`, where it is already
// Huovilainen's model, already tuned by measurement, and already covered by a test suite
// that knows what its self-oscillation frequency should be. Copying it would give the rack
// a filter that drifts from the one the drum machines use, and the engine's own README says
// why that is not on: two copies of a synthesis engine would diverge.
//
// So this module is a wrapper, and the filter arrives through `deps` rather than as an
// identifier — see the comment in `worklet.ts` for why that indirection is not decoration.

/** What this module needs of `Ladder`, structurally. A type-only reference: it is erased,
 *  so it does not break the self-containment rule. */
interface LadderLike {
  process(input: number, cutoff: number, resonance: number): number
}

export class LadderProcessor implements Processor {
  private readonly filter: LadderLike

  constructor(sampleRate: number, deps: Record<string, unknown>) {
    const Filter = deps.Ladder as new (sampleRate: number) => LadderLike
    this.filter = new Filter(sampleRate)
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
    const out = outlets[0]
    const cutoff = params[0]
    const resonance = params[1]

    for (let i = 0; i < frames; i++) {
      // The cutoff CV is in octaves, like the VCO's pitch inlet, so an envelope patched
      // here sweeps by a musical interval rather than by a number of Hz — which is what
      // makes the same envelope depth sound the same at the bottom and top of the knob.
      let frequency = cutoff[i]
      const octaves = cutoffCv[i]
      if (octaves !== 0) frequency *= Math.pow(2, octaves)

      let q = resonance[i] + resonanceCv[i]
      if (q < 0) q = 0
      else if (q > 1) q = 1

      out[i] = this.filter.process(input[i], frequency, q)
    }
  }
}

export const LADDER_MODULE: ModuleDef = {
  type: 'ladder',
  version: 1,
  name: 'Ladder',
  inlets: [
    { id: 'in', name: 'In' },
    { id: 'cutoff', name: 'Cutoff' },
    { id: 'res', name: 'Res' },
  ],
  outlets: [{ id: 'out', name: 'Out' }],
  params: [
    // In Hz. The knob's taper is the faceplate's business — a linear sweep from 20 to 12000
    // spends four fifths of its travel above the interesting part, but a `curve` field on
    // ParamDef would be a guess at what a faceplate needs before there is a faceplate.
    { id: 'cutoff', name: 'Cutoff', min: 20, max: 12000, default: 800 },
    { id: 'resonance', name: 'Res', min: 0, max: 1, default: 0.4 },
  ],
  processor: LadderProcessor,
  deps: { Ladder },
}
