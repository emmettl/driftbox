import type { ModuleDef, Processor } from '../types.js'

// An attenuverter and an offset. The least glamorous module here and one of the two or three
// most used.
//
// `out = in * gain + offset`, where gain goes negative — that is the "verter" half, and it is
// what turns a rising envelope into a falling one, or an LFO into its own inversion, without
// needing a module for either.
//
// With nothing patched to the inlet it is a **constant source**, because an unconnected inlet
// reads the zero buffer and `0 * gain + offset` is `offset`. That is the other reason it earns
// its place: it is how any fixed value gets into any inlet in the rack, which in a graph with
// one signal type means it is also the tuning knob, the bias, and the manual gate.
//
// This class is SELF-CONTAINED — see the comment in `worklet.ts`.

export class OffsetProcessor implements Processor {
  process(
    inlets: Float32Array[],
    outlets: Float32Array[],
    params: Float32Array[],
    frames: number,
  ): void {
    const input = inlets[0]
    const out = outlets[0]
    const gain = params[0]
    const offset = params[1]
    for (let i = 0; i < frames; i++) out[i] = input[i] * gain[i] + offset[i]
  }
}

export const OFFSET_MODULE: ModuleDef = {
  type: 'offset',
  version: 1,
  name: 'Offset',
  group: 'Modulation',
  blurb:
    'Scales, inverts and shifts a CV. The plainest module here and among the most used — an envelope upside down, an LFO in the right range.',
  logo: {
    paths: [
      'M5 31h54M12 36V5',
      'M16 28l15-15 13 8 14-14',
      'M18 13l14 9 12-7 14 12',
    ],
  },
  inlets: [{ id: 'in', name: 'In' }],
  outlets: [{ id: 'out', name: 'Out' }],
  params: [
    // Through zero and past -1, so it inverts and can also amplify a control signal that was
    // too polite to be useful.
    { id: 'gain', name: 'Gain', min: -2, max: 2, default: 1 },
    // Two octaves either way in pitch terms, which is the range that makes this usable as a
    // transpose control on a VCO's V/Oct inlet.
    { id: 'offset', name: 'Offset', min: -2, max: 2, default: 0 },
  ],
  processor: OffsetProcessor,
}
