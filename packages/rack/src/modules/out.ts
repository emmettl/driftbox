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
// **Pan lives here and is applied by the Graph, not by this processor.** A module's outlets are mono and
// staying that way — see the note on `process` in `graph.ts` — so this module cannot place itself in the
// field even if it wanted to. What it does instead is declare `terminalPan`, and the Graph reads that
// param's buffer when it sums the terminal outlets. The pan law then lives in exactly one place, which is
// what it should be: it is a property of the mix, not of the module.
//
// The `Thru` outlet stays MONO and pre-pan. It is a patch cable, and a patch cable in this rack carries one
// signal; a Thru that quietly carried only the left half would be a trap.
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
  group: 'Mixing',
  blurb:
    'The end of a chain, with level, pan, mute and solo. Two of them is a two-channel mix; none of them is silence.',
  logo: {
    paths: [
      'M5 20h14l16-13v26L19 20',
      'M41 14c5 3 5 9 0 12',
      'M47 9c10 6 10 16 0 22',
      'M18 16v8',
    ],
  },
  inlets: [{ id: 'in', name: 'In' }],
  outlets: [{ id: 'out', name: 'Thru' }],
  params: [
    { id: 'level', name: 'Level', min: 0, max: 1, default: 0.7 },
    // Centre by default, which is what every Out was before stereo existed — so a patch shared before this
    // is byte-identical and sounds identical after it.
    { id: 'pan', name: 'Pan', min: -1, max: 1, default: 0 },
    // Mute and solo are applied by the Graph, like pan, because they are facts about the mix. Solo could
    // not live in this processor even in principle: one channel soloed silences the OTHERS, and a module
    // has no idea the others exist.
    { id: 'mute', name: 'Mute', min: 0, max: 1, default: 0, stepped: true, labels: ['On', 'Mute'] },
    { id: 'solo', name: 'Solo', min: 0, max: 1, default: 0, stepped: true, labels: ['—', 'Solo'] },
  ],
  processor: OutProcessor,
  terminal: true,
  terminalPan: 'pan',
  terminalMute: 'mute',
  terminalSolo: 'solo',
  // One master bus. Eight copies would each apply the level knob to their own voice and then be summed,
  // which is the same arithmetic — but the collapse has to happen somewhere obvious, and the end of the
  // rack is where anybody would look for it.
  poly: false,
}
