import type { ModuleData, ModuleDef, Processor } from '../types.js'

// A sampler, and the reason it exists is slicing.
//
// A break you can only loop is a drum loop. A break you can **retrigger by slice** is jungle — chopping is the
// technique the entire genre is built on, and it is why `docs/DNB.md` treats this as the genre-defining module
// rather than as a nice extra. Everything else here is in service of that.
//
// The slices are equal divisions rather than transient-detected, which sounds like a shortcut and is actually
// how people chop: set sixteen slices on a one-bar break and each slice is a sixteenth. That only lines up
// because the break is rendered at the patch's tempo — which the app does, so the arithmetic is exact rather
// than approximately right.
//
// **This is the first module to take bulk data.** It reads its buffer every block and compares by identity,
// which is the whole change-detection protocol from `types.ts` — a different array means a different break, so
// re-slicing costs one comparison and no subscription.
//
// This class is SELF-CONTAINED — see the comment in `worklet.ts`.

export class SamplerProcessor implements Processor {
  private readonly data: ModuleData

  /** The buffer as last seen, by identity. A different array means new data and a re-slice. */
  private sample: Float32Array | undefined
  private length = 0

  /** Where in the buffer the playhead is, fractional. Negative means idle. */
  private position = -1
  /** The slice being played, latched at the trigger so that moving the knob mid-slice does not jump. */
  private from = 0
  private to = 0
  private backwards = false

  private lastTrig = 0
  private trigLeft = 0
  private readonly trigSamples: number

  private lastRatio = 1
  private lastOctaves = Number.NaN

  constructor(sampleRate: number, _deps: Record<string, unknown>, _id: string, data: ModuleData) {
    this.data = data
    this.trigSamples = Math.max(1, Math.ceil(sampleRate * 0.001))
  }

  process(
    inlets: Float32Array[],
    outlets: Float32Array[],
    params: Float32Array[],
    frames: number,
  ): void {
    const trigIn = inlets[0]
    const sliceCv = inlets[1]
    const pitchCv = inlets[2]
    const out = outlets[0]
    const eoc = outlets[1]

    const sliceCount = params[0]
    const sliceParam = params[1]
    const startParam = params[2]
    const loopParam = params[3]
    const reverseParam = params[4]

    // Identity, not content. A different array is a different break.
    const sample = this.data.get('sample')
    if (sample !== this.sample) {
      this.sample = sample
      this.length = sample ? sample.length : 0
      // A new break invalidates wherever the playhead was — it was an index into the old one.
      this.position = -1
    }

    if (!sample || this.length < 2) {
      // Silent rather than absent: a patch is often built before a break is loaded into it, and a module that
      // stopped writing its outlets would leave the previous block's audio in the tail.
      out.fill(0)
      eoc.fill(0)
      return
    }

    for (let i = 0; i < frames; i++) {
      const slices = Math.max(1, Math.min(32, Math.round(sliceCount[i])))
      const perSlice = this.length / slices

      const gate = trigIn[i] >= 0.5 ? 1 : 0
      if (gate === 1 && this.lastTrig === 0) {
        // The slice is latched here and nowhere else. Reading it per sample would make a slice change mid-play
        // jump the playhead into the middle of a different drum, which is a glitch rather than an edit.
        const cv = sliceCv[i] * slices
        let index = Math.round(sliceParam[i] + cv)
        // Wrapped rather than clamped, so a sequencer or a random source sweeping past the end comes back round
        // instead of hammering the last slice.
        index = ((index % slices) + slices) % slices
        this.from = index * perSlice
        this.to = Math.min(this.length, (index + 1) * perSlice)

        this.backwards = Math.round(reverseParam[i]) === 1
        const offset = Math.max(0, Math.min(1, startParam[i])) * (this.to - this.from)
        this.position = this.backwards ? this.to - 1 - offset : this.from + offset
      }
      this.lastTrig = gate

      if (this.position < 0) {
        out[i] = 0
        eoc[i] = this.trigLeft-- > 0 ? 1 : 0
        continue
      }

      // Octaves, like every other pitch inlet in the rack, so a break plays a fourth up from the same CV that
      // takes an oscillator up a fourth.
      const octaves = pitchCv[i]
      if (octaves !== this.lastOctaves) {
        this.lastOctaves = octaves
        this.lastRatio = octaves === 0 ? 1 : Math.pow(2, octaves)
      }

      const index = Math.floor(this.position)
      const fraction = this.position - index
      const a = sample[index] ?? 0
      const b = sample[index + 1 < this.length ? index + 1 : index] ?? 0
      // Linear interpolation, because the rate is not 1 in general — a break pitched down is the sound of the
      // genre, and stepping the read pointer by whole samples turns that into a buzz.
      out[i] = a + (b - a) * fraction

      this.position += this.backwards ? -this.lastRatio : this.lastRatio

      const done = this.backwards ? this.position <= this.from : this.position >= this.to
      if (done) {
        this.trigLeft = this.trigSamples
        if (Math.round(loopParam[i]) === 1) {
          this.position = this.backwards ? this.to - 1 : this.from
        } else {
          this.position = -1
        }
      }
      eoc[i] = this.trigLeft > 0 ? (this.trigLeft--, 1) : 0
    }
  }
}

export const SAMPLER_MODULE: ModuleDef = {
  type: 'sampler',
  version: 1,
  name: 'Sampler',
  group: 'Sources',
  blurb:
    'Plays a break, sliced. Retriggering by slice is what chopping is, and chopping is what jungle is made of.',
  logo: {
    paths: [
      'M4 21c4 0 4-11 8-11s4 20 8 20 4-15 8-15 4 11 8 11 4-18 8-18 4 24 8 24 4-11 8-11',
      'M16 7v26M32 7v26M48 7v26',
    ],
  },
  inlets: [
    { id: 'trig', name: 'Trig' },
    { id: 'slice', name: 'Slice' },
    { id: 'pitch', name: 'V/Oct' },
  ],
  outlets: [
    { id: 'out', name: 'Out' },
    // Fires when a slice finishes, so one slice can trigger the next thing — a hat, an envelope, another
    // sampler. Cheap, and it is what turns a chopped break into a pattern that plays itself.
    { id: 'eoc', name: 'EOC' },
  ],
  params: [
    // 16 by default: a one-bar break at sixteen slices is one slice per sixteenth, which is the chop everybody
    // starts from.
    { id: 'slices', name: 'Slices', min: 1, max: 32, default: 16, stepped: true },
    { id: 'slice', name: 'Slice', min: 0, max: 31, default: 0, stepped: true },
    { id: 'start', name: 'Start', min: 0, max: 1, default: 0 },
    { id: 'loop', name: 'Loop', min: 0, max: 1, default: 0, stepped: true, labels: ['Off', 'On'] },
    { id: 'reverse', name: 'Rev', min: 0, max: 1, default: 0, stepped: true, labels: ['Fwd', 'Rev'] },
  ],
  processor: SamplerProcessor,
}
