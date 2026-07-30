import type { ModuleDef, Processor } from '../types.js'

// A keyboard, for a rack that could previously only be played by its own sequencer.
//
// This module is unlike every other one here: **its input comes from outside the audio thread.** An
// `AudioWorkletGlobalScope` has no `navigator`, so `requestMIDIAccess` is not reachable from where the
// processing happens, and there is no inlet a keyboard could be patched into.
//
// It needed no addition to the message ABI, which was a surprise worth writing down. The host already
// sends `{ kind: 'param', slot, value }`, and a param is already a per-sample `Float32Array` that ramps
// across one block. So the note, the gate and the velocity are simply **params the host writes**, and this
// processor does nothing but copy them to its outlets. The gate is `stepped` so that it steps rather than
// ramping — a gate that slid from 0 to 1 over 2.9ms would retrigger nothing and open slowly. The note is
// not stepped, and the 2.9ms it takes to arrive is a glide too short to hear.
//
// Those params are `hidden`, and that is the load-bearing part. A visible knob writing the same slot as
// incoming MIDI would fight it: the knob would read 0 while the audio thread held 3, and nudging it would
// snap the note back. Hidden means the faceplate does not offer them, so there is exactly one writer.
//
// **They also never travel through the store**, which is the other half of the same idea: a note somebody
// played is performance, not document. Routing it through the patch would autosave the last note anybody
// pressed into the file. The host writes these straight to `rack.setParam`, so `encodePatch` only ever sees
// their defaults.
//
// This class is SELF-CONTAINED — see the comment in `worklet.ts`.

export class MidiProcessor implements Processor {
  private readonly sampleRate: number
  private pitch = 0
  private lastGlide = Number.NaN
  private glideCoef = 0

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate
  }

  process(
    _inlets: Float32Array[],
    outlets: Float32Array[],
    params: Float32Array[],
    frames: number,
  ): void {
    const pitchOut = outlets[0]
    const gateOut = outlets[1]
    const velOut = outlets[2]
    const modOut = outlets[3]

    const note = params[0]
    const gate = params[1]
    const velocity = params[2]
    const mod = params[3]
    const transpose = params[4]
    const glide = params[5]

    for (let i = 0; i < frames; i++) {
      if (glide[i] !== this.lastGlide) {
        this.lastGlide = glide[i]
        // The same 99%-of-the-way-in-the-stated-time convention the envelope and the sequencer use, so a
        // glide knob marked in seconds means the same thing everywhere in the rack.
        this.glideCoef =
          glide[i] <= 0 ? 0 : Math.pow(0.01, 1 / Math.max(1, glide[i] * this.sampleRate))
      }

      // MIDI 36 is C2, which is where 0 V sits for every pitch inlet in this rack — so a C2 on the
      // keyboard plays a C2 on the VCO with the transpose at zero, which is the only mapping that would
      // not be a small lie.
      const target = (note[i] - 36 + transpose[i]) / 12
      this.pitch = target + (this.pitch - target) * this.glideCoef

      pitchOut[i] = this.pitch
      gateOut[i] = gate[i] >= 0.5 ? 1 : 0
      velOut[i] = velocity[i]
      modOut[i] = mod[i]
    }
  }
}

export const MIDI_MODULE: ModuleDef = {
  type: 'midi',
  version: 1,
  name: 'MIDI',
  group: 'Sequencing',
  blurb:
    'Your keyboard, as pitch and a gate. The only module here whose input does not arrive down a cable.',
  inlets: [],
  outlets: [
    { id: 'pitch', name: 'V/Oct' },
    { id: 'gate', name: 'Gate' },
    { id: 'vel', name: 'Vel' },
    { id: 'mod', name: 'Mod' },
  ],
  params: [
    // Written by the host from Web MIDI, never by a knob. See the comment above for why these are hidden
    // rather than merely unlabelled.
    { id: 'note', name: 'Note', min: 0, max: 127, default: 36, hidden: true },
    { id: 'gate', name: 'Gate', min: 0, max: 1, default: 0, stepped: true, hidden: true },
    { id: 'velocity', name: 'Velocity', min: 0, max: 1, default: 0.8, hidden: true },
    { id: 'mod', name: 'Mod', min: 0, max: 1, default: 0, hidden: true },
    // These two are real knobs.
    { id: 'transpose', name: 'Transpose', min: -24, max: 24, default: 0 },
    { id: 'glide', name: 'Glide', min: 0, max: 1, default: 0 },
    // Omni is 0. Two MIDI modules on different channels split a keyboard, which is how this stops being
    // one voice the moment polyphony arrives.
    { id: 'channel', name: 'Ch', min: 0, max: 16, default: 0, stepped: true },
  ],
  processor: MidiProcessor,
}

/** Which param slots the host writes from incoming MIDI, by id. Exported so the host does not have to
 *  hardcode the names of things it is driving. */
export const MIDI_INPUTS = ['note', 'gate', 'velocity', 'mod'] as const
