import type { ModuleDef, Processor } from '../types.js'

// The end of the rack.
//
// `terminal: true` is the whole of what makes this special, and it is one line in the def
// rather than a special case in the compiler: a terminal module's first outlet is summed
// into the audio output. So an empty rack is silence, a rack with two of these is a mix of
// both, and none of that needed a reserved buffer index or a hard-coded module type.
//
// It still has a real outlet, which means it can be patched onward like anything else — an
// Out feeding a Delay feeding another Out is a legal patch and does what it looks like.
//
// This class is SELF-CONTAINED — see the comment in `worklet.ts`.

export class OutProcessor implements Processor {
  process(
    inlets: Float32Array[],
    outlets: Float32Array[],
    params: Float32Array[],
    frames: number,
  ): void {
    const input = inlets[0]
    const out = outlets[0]
    const level = params[0]
    for (let i = 0; i < frames; i++) out[i] = input[i] * level[i]
  }
}

export const OUT_MODULE: ModuleDef = {
  type: 'out',
  version: 1,
  name: 'Out',
  inlets: [{ id: 'in', name: 'In' }],
  outlets: [{ id: 'out', name: 'Thru' }],
  params: [{ id: 'level', name: 'Level', min: 0, max: 1, default: 0.7 }],
  processor: OutProcessor,
  terminal: true,
}
