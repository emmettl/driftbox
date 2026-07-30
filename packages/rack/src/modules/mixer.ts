import type { ModuleDef, Processor } from '../types.js'

// Four in, one out, a level on each and a CV inlet for every level.
//
// This is the module that makes "one cable per inlet" a design decision rather than a
// limitation. `compile` takes the last cable into a contested inlet and drops the earlier one,
// which in Reason is what happens when you drag a cable onto an occupied input. The alternative —
// summing whatever arrives — turns every inlet in the rack into a hidden mixer, so you can never
// tell by looking whether an inlet has one thing patched to it or three. Making the summing
// visible costs one module and buys a patch you can read.
//
// It is also a four-channel attenuverter when nothing is patched to the outputs of anything, and
// a CV mixer when the signals are envelopes rather than audio. In a rack with one signal type
// those are the same module and there is no reason to build it twice.
//
// This class is SELF-CONTAINED — see the comment in `worklet.ts`.

export class MixerProcessor implements Processor {
  process(
    inlets: Float32Array[],
    outlets: Float32Array[],
    params: Float32Array[],
    frames: number,
  ): void {
    const out = outlets[0]
    for (let i = 0; i < frames; i++) {
      let sum = 0
      // Four channels, unrolled by the loop rather than by hand: inlets 0..3 are the signals and
      // 4..7 are their level CVs, so channel n is inlets[n] and inlets[n + 4].
      for (let channel = 0; channel < 4; channel++) {
        let level = params[channel][i] + inlets[channel + 4][i]
        if (level < -2) level = -2
        else if (level > 2) level = 2
        sum += inlets[channel][i] * level
      }
      out[i] = sum
    }
  }
}

export const MIXER_MODULE: ModuleDef = {
  type: 'mixer',
  version: 1,
  name: 'Mixer',
  group: 'Mixing',
  blurb:
    'Four in, one out, with a level and a CV inlet on each. Every crossfade in the rack is one of these, in plain sight.',
  inlets: [
    { id: 'in1', name: 'In 1' },
    { id: 'in2', name: 'In 2' },
    { id: 'in3', name: 'In 3' },
    { id: 'in4', name: 'In 4' },
    { id: 'cv1', name: 'CV 1' },
    { id: 'cv2', name: 'CV 2' },
    { id: 'cv3', name: 'CV 3' },
    { id: 'cv4', name: 'CV 4' },
  ],
  outlets: [{ id: 'out', name: 'Out' }],
  params: [
    // Through zero, so a channel can be subtracted rather than added. Two mixers and a negative
    // level is a difference, which is how you get a mid/side trick or a crossfade out of this
    // without a module for either.
    { id: 'level1', name: 'Level 1', min: -2, max: 2, default: 1 },
    { id: 'level2', name: 'Level 2', min: -2, max: 2, default: 1 },
    { id: 'level3', name: 'Level 3', min: -2, max: 2, default: 1 },
    { id: 'level4', name: 'Level 4', min: -2, max: 2, default: 1 },
  ],
  processor: MixerProcessor,
}
