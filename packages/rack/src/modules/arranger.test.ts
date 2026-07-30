import { describe, expect, it } from 'vitest'
import { compile } from '../compile.js'
import { Graph } from '../graph.js'
import { MODULES } from './index.js'
import type { ModuleDef, Patch } from '../types.js'
import { ARRANGER_MODULE, ArrangerProcessor } from './arranger.js'

// A song is a list of sections, each a pattern and a number of bars. Most of these check the counting; the
// last one checks the only claim that really matters, which is that an Arranger patched to a Tracker
// actually changes what the Tracker plays.

const SR = 44100
/**
 * Samples per "bar" in these tests. Nothing here depends on a bar being musically long, but it does have to
 * outlast a trigger: the module's trig is a millisecond wide, which is 44 samples at this rate, and with a
 * bar shorter than that the first trigger is still high when the next section starts, so the edges never
 * come back down and cannot be counted.
 */
const BAR = 128

interface Options {
  patterns?: number[]
  repeats?: number[]
  length?: number
  reset?: (i: number) => boolean
}

/** Run the arranger for `frames`, clocking once per BAR, and report what it announced each bar. */
function run(frames: number, options: Options = {}) {
  const store = new Map<string, Float32Array>()
  if (options.patterns) store.set('patterns', Float32Array.from(options.patterns))
  if (options.repeats) store.set('repeats', Float32Array.from(options.repeats))
  const processor = new ArrangerProcessor(SR, {}, 'a', { get: (slot) => store.get(slot) })

  const clock = Float32Array.from({ length: frames }, (_, i) => (i % BAR < BAR / 2 ? 1 : 0))
  const reset = Float32Array.from({ length: frames }, (_, i) => (options.reset?.(i) ? 1 : 0))
  const params = ARRANGER_MODULE.params.map((p) => new Float32Array(frames).fill(p.default))
  if (options.length !== undefined) params[0].fill(options.length)

  const outlets = ARRANGER_MODULE.outlets.map(() => new Float32Array(frames))
  processor.process([clock, reset], outlets, params, frames)

  /** The pattern announced at the end of each bar, back in whole patterns. */
  const perBar: number[] = []
  for (let bar = 0; bar * BAR < frames; bar++) {
    const at = Math.min(frames - 1, bar * BAR + BAR - 1)
    perBar.push(Math.round(outlets[0][at] * 16))
  }
  return { perBar, outlets }
}

describe('the arranger', () => {
  it('holds a section for its repeat count, then moves on', () => {
    // Two bars of pattern 0, then two of pattern 3. The clock ticks once a bar and the section changes when
    // its bars are used up, which is the whole of what an arrangement is.
    const { perBar } = run(BAR * 5, { patterns: [0, 3], repeats: [2, 2], length: 2 })
    expect(perBar.slice(0, 4)).toEqual([0, 0, 3, 3])
  })

  it('loops back to the first section at the end of the song', () => {
    const { perBar } = run(BAR * 5, { patterns: [1, 2], repeats: [1, 1], length: 2 })
    expect(perBar.slice(0, 5)).toEqual([1, 2, 1, 2, 1])
  })

  it('only plays as many sections as its length says', () => {
    // The data can hold more than the song uses — shortening a song should not mean deleting the sections
    // past the end, any more than shortening a pattern deletes its steps.
    const { perBar } = run(BAR * 4, { patterns: [5, 6, 7], repeats: [1, 1, 1], length: 2 })
    expect(perBar.slice(0, 4)).toEqual([5, 6, 5, 6])
  })

  it('treats a section of zero bars as one', () => {
    // A section that lasts no bars cannot be heard, and is far more likely to be a gap in the data than an
    // intention. Skipping it silently would make the song shorter than it reads on the faceplate.
    const { perBar } = run(BAR * 3, { patterns: [1, 2], repeats: [0, 1], length: 2 })
    expect(perBar.slice(0, 3)).toEqual([1, 2, 1])
  })

  it('starts at the first section', () => {
    const { perBar } = run(BAR, { patterns: [4], repeats: [4], length: 1 })
    expect(perBar[0]).toBe(4)
  })

  it('goes back to the top of the song on reset, from that instant', () => {
    // A section is a place rather than an event, so unlike the Tracker — which winds back to *before* its
    // first step — the song is at section zero immediately and the next bar is its first, not its second.
    const { perBar } = run(BAR * 6, {
      patterns: [0, 5],
      repeats: [1, 1],
      length: 2,
      reset: (i) => i >= BAR * 3 && i < BAR * 3 + 2,
    })
    expect(perBar[3]).toBe(0)
  })

  it('fires a trigger when the song moves on', () => {
    // What you reset a Tracker with, so a new section starts at its first step rather than wherever the
    // last one left the playhead.
    const { outlets } = run(BAR * 4, { patterns: [0, 1], repeats: [1, 1], length: 2 })
    let edges = 0
    for (let i = 1; i < outlets[1].length; i++) {
      if (outlets[1][i] >= 0.5 && outlets[1][i - 1] < 0.5) edges++
    }
    expect(edges).toBeGreaterThanOrEqual(3)
  })

  it('announces a pattern the data does not have as zero rather than as nonsense', () => {
    const { perBar } = run(BAR * 2, { length: 2 })
    expect(perBar.slice(0, 2)).toEqual([0, 0])
  })

  it('clamps a pattern index outside the bank', () => {
    const { perBar } = run(BAR * 2, { patterns: [99, -4], repeats: [1, 1], length: 2 })
    expect(perBar.slice(0, 2)).toEqual([7, 0])
  })
})

describe('an arranger driving a tracker', () => {
  // The claim the whole module exists for, and the only one the unit tests above cannot make: one cable
  // from `pattern` to a Tracker's `pattern` inlet changes which of its patterns plays. The scaling has to
  // line up exactly — sixteenths on both sides — and nothing but a real graph checks that.
  it('changes which pattern the tracker plays, through one cable', () => {
    const patch: Patch = {
      modules: [
        { id: 'transport', type: 'transport' },
        {
          id: 'song',
          type: 'arranger',
          params: { length: 2 },
          // One bar of pattern 0, then one bar of pattern 1.
          data: { patterns: [0, 1], repeats: [1, 1] },
        },
        {
          id: 'tracker',
          type: 'tracker',
          params: { length: 4 },
          // Pattern 0 is four rests; pattern 1 is four notes.
          //
          // Silence against sound, rather than a quiet note against a loud one — because what reaches the
          // Out goes through the master limiter, which flattens anything above 0.95 and makes two loud
          // CVs indistinguishable. The first version of this compared 1 semitone against 24 and measured
          // the limiter rather than the arranger.
          data: { lane1: [0, 0, 0, 0, 12, 12, 12, 12] },
        },
        { id: 'out', type: 'out' },
      ],
      cables: [
        { from: ['transport', 'sixteenth'], to: ['tracker', 'clock'] },
        { from: ['transport', 'bar'], to: ['song', 'clock'] },
        { from: ['song', 'pattern'], to: ['tracker', 'pattern'] },
        { from: ['tracker', 'cv1'], to: ['out', 'in'] },
      ],
    }

    const modules: Record<string, ModuleDef['processor']> = {}
    const deps: Record<string, unknown> = {}
    for (const def of Object.values(MODULES)) {
      modules[def.type] = def.processor
      for (const [key, dep] of Object.entries(def.deps ?? {})) deps[key] = dep
    }
    const FRAMES = 128
    const graph = new Graph(SR, FRAMES, modules, deps)
    graph.setPlan(compile(patch, MODULES))
    // Fast, so a bar goes by in a manageable number of blocks.
    graph.setTransport(400, true)

    /** The loudest thing seen over `blocks`, which tells the two patterns apart: 1 semitone versus 24. */
    const peakOver = (blocks: number) => {
      let peak = 0
      for (let b = 0; b < blocks; b++) {
        const channels = [new Float32Array(FRAMES), new Float32Array(FRAMES)]
        graph.process(channels)
        for (const value of channels[0]) peak = Math.max(peak, Math.abs(value))
      }
      return peak
    }

    // A bar at 400bpm is 0.6s — about 207 blocks. Sample the first bar and the second.
    const first = peakOver(150)
    const second = peakOver(300)
    // Pattern 0 is silence; pattern 1 is not. Nothing about the limiter can blur that distinction.
    expect(first).toBeLessThan(0.01)
    expect(second).toBeGreaterThan(0.5)
  })
})
