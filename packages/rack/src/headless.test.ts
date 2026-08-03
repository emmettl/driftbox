import { describe, expect, it } from 'vitest'
import { compile } from './compile.js'
import { Graph } from './graph.js'
import { RackRenderer } from './headless.js'
import { MODULES } from './modules/index.js'
import { PATCHES } from './patches/index.js'
import type { Patch } from './types.js'

// The renderer with no browser under it.
//
// What these have to answer is not "does a saw come out at the right frequency" — `graph.test.ts` measures
// the DSP and this class adds none. It is the two things a facade can get wrong: whether it drives the
// Graph the way the worklet does, and whether the conveniences it adds over the top — a musical position, a
// whole-render call, a block size that follows the buffers — say what they mean.

const SR = 48000

/** A sine into an Out, at a level the tests can move. Small on purpose: nothing here is about the sound. */
function tonePatch(level = 0.5): Patch {
  return {
    modules: [
      { id: 'osc', type: 'vco', params: { tune: 0, shape: 0 } },
      { id: 'out', type: 'out', params: { level } },
    ],
    cables: [{ from: ['osc', 'out'], to: ['out', 'in'] }],
    tempo: 120,
  }
}

function rms(data: Float32Array, from = 0, to = data.length): number {
  let sum = 0
  for (let i = from; i < to; i++) sum += data[i] * data[i]
  return Math.sqrt(sum / Math.max(1, to - from))
}

describe('RackRenderer', () => {
  it('makes sound with no AudioContext anywhere', () => {
    // The claim the whole file exists for. No `Rack`, no worklet, no `OfflineAudioContext` — and vitest's
    // node project has none of them to accidentally lean on.
    expect(typeof globalThis.AudioContext).toBe('undefined')
    expect(typeof globalThis.OfflineAudioContext).toBe('undefined')

    const renderer = new RackRenderer({ sampleRate: SR })
    renderer.patch = tonePatch()
    const { channels, length } = renderer.render(0.25)

    expect(length).toBe(SR / 4)
    expect(rms(channels[0])).toBeGreaterThan(0.1)
    expect(rms(channels[1])).toBeGreaterThan(0.1)
  })

  it('is the same arithmetic as driving the Graph by hand', () => {
    // The property that makes this a facade rather than a second engine: byte-identical to the assembly
    // every test in this package already does, and therefore — via `worklet.test.ts` — to the worklet.
    const patch = tonePatch()
    const frames = 128

    const modules: Record<string, (typeof MODULES)[string]['processor']> = {}
    const deps: Record<string, unknown> = {}
    for (const def of Object.values(MODULES)) {
      modules[def.type] = def.processor
      for (const [name, dep] of Object.entries(def.deps ?? {})) deps[name] = dep
    }
    const graph = new Graph(SR, frames, modules, deps)
    graph.setPlan(compile(patch, MODULES))
    const byHand = [new Float32Array(frames), new Float32Array(frames)]
    for (let block = 0; block < 8; block++) graph.process(byHand)

    const renderer = new RackRenderer({ sampleRate: SR, frames })
    renderer.patch = patch
    const viaFacade = [new Float32Array(frames), new Float32Array(frames)]
    for (let block = 0; block < 8; block++) renderer.process(viaFacade)

    expect(Array.from(viaFacade[0])).toEqual(Array.from(byHand[0]))
  })

  it('renders a shipped patch, twice, identically', () => {
    // Determinism is the property `render.ts` claims for the browser path — anything random seeds from its
    // module id — and it is worth pinning here because a game leaning on this for a cutscene needs the same
    // music each time. It is also what makes a regression in any module visible as a diff.
    const preset = PATCHES.find((entry) => entry.id === 'generative')
    expect(preset).toBeDefined()

    const once = new RackRenderer({ sampleRate: SR })
    once.patch = preset!.build()
    once.setTransport(once.patch.tempo ?? 120, true)
    const a = once.render(1)

    const twice = new RackRenderer({ sampleRate: SR })
    twice.patch = preset!.build()
    twice.setTransport(twice.patch.tempo ?? 120, true)
    const b = twice.render(1)

    expect(rms(a.channels[0])).toBeGreaterThan(0.01)
    expect(Array.from(a.channels[0])).toEqual(Array.from(b.channels[0]))
  })

  it('moves a knob, and ignores one the patch does not have', () => {
    const renderer = new RackRenderer({ sampleRate: SR })
    renderer.patch = tonePatch(0.5)
    const loud = renderer.render(0.1)

    renderer.setParam('out', 'level', 0.05)
    const quiet = renderer.render(0.1)
    expect(rms(quiet.channels[0])).toBeLessThan(rms(loud.channels[0]) / 4)

    // A host holding a stale reference across a patch change does this, and it must not throw.
    expect(() => renderer.setParam('nothing', 'here', 1)).not.toThrow()
    expect(() => renderer.setParam('out', 'nonsense', 1)).not.toThrow()
  })

  it('lands a scheduled change on the frame asked for', () => {
    // The reason `scheduleParam` exists at all: a change that arrives at the next block boundary is up to a
    // block late, which is inaudible on a sweep and quite audible on a cut. Here the cut is to silence, so
    // the sample it happens at is measurable.
    const renderer = new RackRenderer({ sampleRate: SR, frames: 128 })
    renderer.patch = tonePatch(0.8)
    const at = renderer.frameFor(0.05)
    expect(at).toBe(2400)
    // Mid-block on purpose — 2400 is not a multiple of 128, so a block-boundary implementation lands
    // somewhere else and this fails.
    renderer.scheduleParam('out', 'level', 0, at)

    const { channels } = renderer.render(0.1)
    expect(rms(channels[0], 0, at - 128)).toBeGreaterThan(0.1)
    // One block of ramp after the moment, then nothing.
    expect(rms(channels[0], at + 128)).toBeLessThan(1e-6)
  })

  it('keeps a musical position that does not jump when the tempo changes', () => {
    const renderer = new RackRenderer({ sampleRate: SR })
    renderer.patch = tonePatch()

    expect(renderer.beat).toBe(0)
    renderer.render(1)
    expect(renderer.beat).toBe(0) // stopped: no beats pass

    renderer.setTransport(120, true)
    renderer.render(2)
    expect(renderer.beat).toBeCloseTo(4, 1) // 120bpm, two seconds

    // Doubling the tempo carries on from where the music was rather than recomputing the past at the new
    // rate — the mistake `playhead.ts` records, which would move every position already passed.
    renderer.setTransport(240, true)
    renderer.render(1)
    expect(renderer.beat).toBeCloseTo(8, 1)
  })

  it('follows the block size it is handed', () => {
    // A host with its own buffer size says so by handing over buffers of it. The Graph reallocates; the
    // audio is the same music either way, so the check is that it is still music — non-silent and finite.
    const renderer = new RackRenderer({ sampleRate: SR, frames: 128 })
    renderer.patch = tonePatch()
    const big = [new Float32Array(1024), new Float32Array(1024)]
    renderer.process(big)
    renderer.process(big)

    expect(rms(big[0])).toBeGreaterThan(0.1)
    expect(big[0].every((sample) => Number.isFinite(sample))).toBe(true)
  })

  it('reports what the compiler decided', () => {
    const renderer = new RackRenderer({ sampleRate: SR })
    renderer.patch = {
      modules: [{ id: 'mystery', type: 'not-a-module' }],
      cables: [],
    }
    expect(renderer.notes.some((note) => note.kind === 'placeholder')).toBe(true)
    expect(renderer.plan).not.toBeNull()
  })
})
