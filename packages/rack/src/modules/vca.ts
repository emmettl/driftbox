import type { ModuleDef, Processor } from '../types.js'

// A voltage-controlled amplifier: the module that turns an envelope into a note.
//
// Two decisions worth knowing.
//
// **The gain knob and the CV inlet ADD.** In Eurorack a VCA with nothing patched to its CV is
// shut, which is correct and is also the single most common reason a beginner's patch is
// silent. Here the knob is an offset the CV rides on, and it defaults to fully open — so a VCA
// dropped into a patch passes audio, and pulling the knob down is how you hand control to the
// envelope. The behaviour every Eurorack VCA has is still one knob-turn away.
//
// **The curve is square-law, and it is not called exponential.** A real exponential VCA is
// `exp(k(cv-1))` and costs a transcendental per sample for a difference most people would
// describe as "the quiet part is quieter". Squaring gets most of that — half the CV is a
// quarter of the amplitude, about -12dB — for one multiply. Calling it what it is rather than
// what it approximates seemed better than the reverse.
//
// This class is SELF-CONTAINED — see the comment in `worklet.ts`.

export class VcaProcessor implements Processor {
  process(
    inlets: Float32Array[],
    outlets: Float32Array[],
    params: Float32Array[],
    frames: number,
  ): void {
    const input = inlets[0]
    const cv = inlets[1]
    const out = outlets[0]
    const gain = params[0]
    const curve = params[1]

    // Squaring is only correct for a non-negative level, so the clamp comes first: a negative
    // CV would otherwise come back out as a positive gain and the module would open when it was
    // asked to shut.
    if ((curve[0] | 0) === 1) {
      for (let i = 0; i < frames; i++) {
        let level = gain[i] + cv[i]
        if (level < 0) level = 0
        else if (level > 1) level = 1
        out[i] = input[i] * level * level
      }
      return
    }

    for (let i = 0; i < frames; i++) {
      let level = gain[i] + cv[i]
      if (level < 0) level = 0
      else if (level > 1) level = 1
      out[i] = input[i] * level
    }
  }
}

export const VCA_MODULE: ModuleDef = {
  type: 'vca',
  version: 1,
  name: 'VCA',
  inlets: [
    { id: 'in', name: 'In' },
    { id: 'cv', name: 'CV' },
  ],
  outlets: [{ id: 'out', name: 'Out' }],
  params: [
    { id: 'gain', name: 'Gain', min: 0, max: 1, default: 1 },
    // Stepped: the curve is a choice between two behaviours, not a blend of them.
    { id: 'curve', name: 'Curve', min: 0, max: 1, default: 0, stepped: true },
  ],
  processor: VcaProcessor,
}
