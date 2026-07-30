import type { ModuleDef, Processor } from '../types.js'

// Snap a pitch CV to a scale.
//
// The highest musical return per line of code in the whole list. Noise into a sample-and-hold is
// random voltage; random voltage into a VCO is a siren; random voltage through this is a melody in
// A minor. Nothing else here changes what a patch *is* for so little arithmetic.
//
// The `trig` outlet is what makes it more than a filter: it fires when the output note actually
// changes, so an envelope can be struck on each new note rather than on each clock. A quantizer
// without it makes a sequence of pitches; a quantizer with it makes a sequence of notes.
//
// This class is SELF-CONTAINED — see the comment in `worklet.ts`. The scale table is built in the
// constructor rather than held as a static, because reaching a static needs either the class's own
// name — which a minifier removes entirely — or `this.constructor`, and an array of six small
// arrays is not worth either.

export class QuantizerProcessor implements Processor {
  private readonly scales: number[][]
  private readonly trigSamples: number

  private lastNote = Number.NaN
  private trigLeft = 0

  constructor(sampleRate: number) {
    this.trigSamples = Math.max(1, Math.ceil(sampleRate * 0.001))
    this.scales = [
      [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], // chromatic
      [0, 2, 4, 5, 7, 9, 11], // major
      [0, 2, 3, 5, 7, 8, 10], // natural minor
      [0, 3, 5, 7, 10], // minor pentatonic
      [0, 2, 3, 5, 7, 9, 10], // dorian
      [0, 2, 4, 6, 8, 10], // whole tone
    ]
  }

  process(
    inlets: Float32Array[],
    outlets: Float32Array[],
    params: Float32Array[],
    frames: number,
  ): void {
    const input = inlets[0]
    const out = outlets[0]
    const trigOut = outlets[1]
    const scale = params[0]
    const root = params[1]

    for (let i = 0; i < frames; i++) {
      let which = scale[i] | 0
      if (which < 0) which = 0
      else if (which >= this.scales.length) which = this.scales.length - 1
      const degrees = this.scales[which]
      const offset = Math.round(root[i])

      // Octaves in, semitones to work in, octaves out.
      const semitones = input[i] * 12 - offset
      const octave = Math.floor(semitones / 12)
      const within = semitones - octave * 12

      let best = degrees[0]
      let closest = Math.abs(within - degrees[0])
      for (let d = 1; d < degrees.length; d++) {
        const distance = Math.abs(within - degrees[d])
        if (distance < closest) {
          closest = distance
          best = degrees[d]
        }
      }
      // The root of the octave above is also a candidate, and forgetting it is why naive quantizers
      // have a dead zone at the top of every octave: a value at 11.5 semitones in a major scale is
      // nearer to 12 than to 11, and without this it would snap down a semitone instead of up.
      if (Math.abs(within - 12) < closest) best = 12

      const note = offset + octave * 12 + best
      out[i] = note / 12

      if (note !== this.lastNote) {
        this.lastNote = note
        this.trigLeft = this.trigSamples
      }
      if (this.trigLeft > 0) {
        this.trigLeft--
        trigOut[i] = 1
      } else {
        trigOut[i] = 0
      }
    }
  }
}

export const QUANTIZER_MODULE: ModuleDef = {
  type: 'quantizer',
  version: 1,
  name: 'Quantizer',
  inlets: [{ id: 'in', name: 'In' }],
  outlets: [
    { id: 'out', name: 'Out' },
    { id: 'trig', name: 'Trig' },
  ],
  params: [
    { id: 'scale', name: 'Scale', min: 0, max: 5, default: 2, stepped: true,
      labels: ['Chrom', 'Major', 'Minor', 'Pent', 'Dorian', 'Whole'] },
    { id: 'root', name: 'Root', min: 0, max: 11, default: 0, stepped: true,
      labels: ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] },
  ],
  processor: QuantizerProcessor,
}
