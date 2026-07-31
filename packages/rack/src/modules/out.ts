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
// **Both its ports are stereo, and this is the module that had to be first.** Everything upstream can be as
// stereo as it likes and none of it is audible until the end of the rack can take a pair. A mono cable into
// a stereo inlet feeds both channels — `stereo.ts` has the three rules — so every patch written before this
// arrives centred and sounds exactly as it did.
//
// **Pan lives here and is applied by the Graph, not by this processor.** What this declares is
// `terminalPan`, and the Graph reads that param's buffer when it sums the terminal outlets, so the pan law
// lives in exactly one place. On a mono signal that is placement; on a stereo pair the same arithmetic is
// balance, which is what a pan control on a stereo channel means on any mixer. One knob, one name, and no
// second control that only sometimes applies.
//
// The `Thru` outlet is stereo too, and pre-pan. It was mono when nothing could carry a pair, with a note
// here saying a Thru that quietly carried only the left half would be a trap — which was right, and the fix
// was never to make the Thru mono for ever. Patched into something mono it folds to its left channel, and
// the compiler says so in `plan.notes`.
//
// This class is SELF-CONTAINED — see the comment in `worklet.ts`.

export class OutProcessor implements Processor {
  process(
    inlets: Float32Array[],
    outlets: Float32Array[],
    params: Float32Array[],
    frames: number,
  ): void {
    // Two slots per stereo port, in declaration order: in-left, in-right, then out-left, out-right.
    const left = inlets[0]
    const right = inlets[1]
    const outLeft = outlets[0]
    const outRight = outlets[1]
    const level = params[0]
    for (let i = 0; i < frames; i++) {
      const gain = level[i]
      outLeft[i] = left[i] * gain
      outRight[i] = right[i] * gain
    }
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
  // Stereo, and the ids are unchanged — which is the whole reason adding a channel is safe. Cables name
  // ports, so widening one moves no cable; renaming one would silently rewire every patch that used it.
  inlets: [{ id: 'in', name: 'In', stereo: true }],
  outlets: [{ id: 'out', name: 'Thru', stereo: true }],
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
