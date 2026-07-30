import type { ModuleDef, Processor } from '../types.js'

// Sample and hold. Twelve lines, and it is what turns noise into a melody.
//
// Noise into the inlet, a clock into the trigger, the output into a quantizer and then a VCO: that
// is a generative sequence, out of four modules none of which is a sequencer. It is the clearest
// demonstration in the rack of why one signal type is worth having — the thing being sampled is
// audio, the thing it becomes is pitch, and nothing had to be told about the change.
//
// This class is SELF-CONTAINED — see the comment in `worklet.ts`.

export class SampleHoldProcessor implements Processor {
  private held = 0
  private lastTrig = 0

  process(
    inlets: Float32Array[],
    outlets: Float32Array[],
    _params: Float32Array[],
    frames: number,
  ): void {
    const input = inlets[0]
    const trig = inlets[1]
    const out = outlets[0]

    for (let i = 0; i < frames; i++) {
      const gate = trig[i] >= 0.5 ? 1 : 0
      // The rising edge only. Sampling for as long as the trigger is high would make this a gate
      // rather than a sample, and the output would follow the input instead of holding it.
      if (gate === 1 && this.lastTrig === 0) this.held = input[i]
      this.lastTrig = gate
      out[i] = this.held
    }
  }
}

export const SAMPLE_HOLD_MODULE: ModuleDef = {
  type: 'sample-hold',
  version: 1,
  name: 'S&H',
  inlets: [
    { id: 'in', name: 'In' },
    { id: 'trig', name: 'Trig' },
  ],
  outlets: [{ id: 'out', name: 'Out' }],
  params: [],
  processor: SampleHoldProcessor,
}
