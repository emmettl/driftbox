import { describe, expect, it } from 'vitest'
import { compile } from './compile.js'
import { Graph } from './graph.js'
import { MODULES } from './modules/index.js'
import type { ModuleDef, Patch, Processor, Registry } from './types.js'

// The graph runs in Node here. A Graph is arithmetic over Float32Arrays — no AudioContext,
// no browser — so the things that actually matter about it are measurable: that a saw comes
// out at the frequency asked for, that a filter attenuates, that a knob does not click, that
// a feedback patch does not take the tab with it.
//
// This is the same trick `ladder.test.ts` uses in the engine, one level up. What it cannot
// check is that the browser runs the same code; `worklet.test.ts` is for that.

const SR = 44100
const FRAMES = 128
const SECOND = Math.ceil(SR / FRAMES)

function build(registry: Registry): {
  modules: Record<string, ModuleDef['processor']>
  deps: Record<string, unknown>
} {
  const modules: Record<string, ModuleDef['processor']> = {}
  const deps: Record<string, unknown> = {}
  for (const def of Object.values(registry)) {
    modules[def.type] = def.processor
    for (const [name, dep] of Object.entries(def.deps ?? {})) deps[name] = dep
  }
  return { modules, deps }
}

function graphFor(patch: Patch, registry: Registry = MODULES): Graph {
  const { modules, deps } = build(registry)
  const graph = new Graph(SR, FRAMES, modules, deps)
  graph.setPlan(compile(patch, registry))
  return graph
}

/** Run `blocks` blocks and hand back the left channel, concatenated. */
function render(graph: Graph, blocks: number): Float64Array {
  const channels = [new Float32Array(FRAMES), new Float32Array(FRAMES)]
  const out = new Float64Array(blocks * FRAMES)
  for (let block = 0; block < blocks; block++) {
    graph.process(channels)
    out.set(channels[0], block * FRAMES)
  }
  return out
}

const run = (patch: Patch, blocks: number, registry: Registry = MODULES) =>
  render(graphFor(patch, registry), blocks)

function rms(data: Float64Array, from = 0): number {
  let sum = 0
  for (let i = from; i < data.length; i++) sum += data[i] * data[i]
  return Math.sqrt(sum / (data.length - from))
}

/** Upward zero crossings per second. A saw crosses upward exactly once per cycle. */
function fundamental(data: Float64Array, from = 0): number {
  let crossings = 0
  for (let i = from + 1; i < data.length; i++) {
    if (data[i - 1] <= 0 && data[i] > 0) crossings++
  }
  return (crossings * SR) / (data.length - from)
}

const chain = (
  modules: Patch['modules'],
  cables: [string, string, string, string][],
): Patch => ({
  modules,
  cables: cables.map(([a, b, c, d]) => ({ from: [a, b], to: [c, d] })),
})

// A pair of modules that exist only here. They also prove the registry is genuinely a
// parameter rather than decoration: nothing in the compiler or the graph knows the three
// shipped modules by name.

class ProbeProcessor implements Processor {
  process(
    _inlets: Float32Array[],
    outlets: Float32Array[],
    params: Float32Array[],
    frames: number,
  ): void {
    for (let i = 0; i < frames; i++) outlets[0][i] = params[0][i]
  }
}

const probe = (stepped: boolean): ModuleDef => ({
  type: stepped ? 'probe-stepped' : 'probe',
  version: 1,
  name: 'Probe',
  inlets: [],
  outlets: [{ id: 'out', name: 'Out' }],
  params: [{ id: 'value', name: 'Value', min: 0, max: 1, default: 0, stepped }],
  processor: ProbeProcessor,
  terminal: true,
})

class HostileProcessor implements Processor {
  process(
    _inlets: Float32Array[],
    outlets: Float32Array[],
    _params: Float32Array[],
    frames: number,
  ): void {
    for (let i = 0; i < frames; i++) {
      outlets[0][i] = i % 3 === 0 ? Number.NaN : i % 3 === 1 ? Number.POSITIVE_INFINITY : 1e9
    }
  }
}

const HOSTILE: ModuleDef = {
  type: 'hostile',
  version: 1,
  name: 'Hostile',
  inlets: [],
  outlets: [{ id: 'out', name: 'Out' }],
  params: [],
  processor: HostileProcessor,
  terminal: true,
}

const PROBES: Registry = {
  probe: probe(false),
  'probe-stepped': probe(true),
  hostile: HOSTILE,
}

describe('running a graph', () => {
  it('is silent with nothing in the rack', () => {
    expect(rms(run({ modules: [], cables: [] }, 4))).toBe(0)
  })

  it('is silent with modules but no output', () => {
    // An oscillator running into nothing is not a sound. It should still be *running* —
    // nothing here proves that, but nothing should leak to the speakers either.
    const patch = chain([{ id: 'osc', type: 'vco' }], [])
    expect(rms(run(patch, 4))).toBe(0)
  })

  it('plays an oscillator at the pitch it was asked for', () => {
    // 0 V and 0 semitones is C2, 65.41Hz. If this is wrong, every module downstream of a
    // VCO is being tested against the wrong thing.
    const patch = chain(
      [
        { id: 'osc', type: 'vco' },
        { id: 'out', type: 'out' },
      ],
      [['osc', 'out', 'out', 'in']],
    )
    const audio = run(patch, SECOND)
    expect(fundamental(audio)).toBeCloseTo(65.41, 0)
    expect(rms(audio)).toBeGreaterThan(0.1)
  })

  it('moves an octave for twelve semitones of tune', () => {
    const at = (tune: number) =>
      fundamental(
        run(
          chain(
            [
              { id: 'osc', type: 'vco', params: { tune } },
              { id: 'out', type: 'out' },
            ],
            [['osc', 'out', 'out', 'in']],
          ),
          SECOND,
        ),
      )
    expect(at(12) / at(0)).toBeCloseTo(2, 1)
    expect(at(-12) / at(0)).toBeCloseTo(0.5, 1)
  })

  it('filters what the oscillator sends it', () => {
    const audio = (cutoff: number) =>
      run(
        chain(
          [
            { id: 'osc', type: 'vco', params: { tune: 24 } },
            { id: 'filter', type: 'ladder', params: { cutoff, resonance: 0.2 } },
            { id: 'out', type: 'out' },
          ],
          [
            ['osc', 'out', 'filter', 'in'],
            ['filter', 'out', 'out', 'in'],
          ],
        ),
        SECOND,
      )

    // Two octaves above C2 is 261Hz; a 40Hz cutoff should leave almost nothing of it. This
    // is the end-to-end check that a cable actually carries audio between two modules.
    const open = rms(audio(8000), FRAMES * 8)
    const shut = rms(audio(40), FRAMES * 8)
    expect(open).toBeGreaterThan(0.1)
    expect(shut).toBeLessThan(open * 0.1)
  })

  it('sweeps a filter from a modulation cable', () => {
    // The cutoff inlet takes octaves, so an oscillator patched into it is an LFO-ish sweep.
    // What this really tests is that a module reads a CV inlet per sample: if the cutoff
    // only updated once a block, this would still pass — but if the inlet were not wired at
    // all, the two would be identical.
    const patch = (modulated: boolean) =>
      chain(
        [
          { id: 'osc', type: 'vco', params: { tune: 24 } },
          { id: 'lfo', type: 'vco', params: { tune: -24 } },
          { id: 'filter', type: 'ladder', params: { cutoff: 200, resonance: 0.2 } },
          { id: 'out', type: 'out' },
        ],
        [
          ['osc', 'out', 'filter', 'in'],
          ['filter', 'out', 'out', 'in'],
          ...(modulated ? ([['lfo', 'out', 'filter', 'cutoff']] as [string, string, string, string][]) : []),
        ],
      )

    const still = rms(run(patch(false), SECOND), FRAMES * 8)
    const swept = rms(run(patch(true), SECOND), FRAMES * 8)
    expect(swept).not.toBeCloseTo(still, 2)
  })

  it('reads an unconnected inlet as silence', () => {
    // A filter with nothing patched in and its resonance below self-oscillation has nothing
    // to say. If the zero buffer were ever written to, this is where it would show up.
    const patch = chain(
      [
        { id: 'filter', type: 'ladder', params: { resonance: 0.3 } },
        { id: 'out', type: 'out' },
      ],
      [['filter', 'out', 'out', 'in']],
    )
    expect(rms(run(patch, 8))).toBe(0)
  })

  it('sums two outputs', () => {
    const one = chain(
      [
        { id: 'osc', type: 'vco' },
        { id: 'a', type: 'out', params: { level: 0.5 } },
      ],
      [['osc', 'out', 'a', 'in']],
    )
    const two: Patch = {
      modules: [...one.modules, { id: 'b', type: 'out', params: { level: 0.5 } }],
      cables: [...one.cables, { from: ['osc', 'out'], to: ['b', 'in'] }],
    }
    expect(rms(run(two, SECOND))).toBeCloseTo(rms(run(one, SECOND)) * 2, 2)
  })

  it('puts the same thing in every channel', () => {
    const graph = graphFor(
      chain(
        [
          { id: 'osc', type: 'vco' },
          { id: 'out', type: 'out' },
        ],
        [['osc', 'out', 'out', 'in']],
      ),
    )
    const channels = [new Float32Array(FRAMES), new Float32Array(FRAMES)]
    graph.process(channels)
    expect([...channels[1]]).toEqual([...channels[0]])
  })

  it('runs a feedback patch without exploding', () => {
    // A filter whose output drives its own cutoff, with the resonance up. There is no order
    // that satisfies that cable, so it reads last block's buffer. What matters is that this
    // is finite, bounded, and does not hang — a NaN reaching an AudioNode silences it for
    // the lifetime of the context.
    const patch = chain(
      [
        { id: 'osc', type: 'vco', params: { tune: -12 } },
        { id: 'filter', type: 'ladder', params: { cutoff: 400, resonance: 0.9 } },
        { id: 'out', type: 'out' },
      ],
      [
        ['osc', 'out', 'filter', 'in'],
        ['filter', 'out', 'out', 'in'],
        ['out', 'out', 'filter', 'cutoff'],
      ],
    )
    const audio = run(patch, SECOND)
    expect(rms(audio)).toBeGreaterThan(0)
    for (let i = 0; i < audio.length; i++) {
      expect(Number.isFinite(audio[i])).toBe(true)
      expect(Math.abs(audio[i])).toBeLessThanOrEqual(4)
    }
  })

  it('keeps a module that has gone bad off the output bus', () => {
    // Not a rescue — a patch that produces infinities will sound wrong, and it should. The
    // point is narrower: the tab must survive it, because a NaN in an AudioNode is
    // permanent and a reload would be the only way back.
    const audio = run({ modules: [{ id: 'x', type: 'hostile' }], cables: [] }, 4, PROBES)
    for (let i = 0; i < audio.length; i++) {
      expect(Number.isFinite(audio[i])).toBe(true)
      expect(Math.abs(audio[i])).toBeLessThanOrEqual(4)
    }
  })
})

describe('moving a knob', () => {
  const probePatch: Patch = { modules: [{ id: 'p', type: 'probe' }], cables: [] }

  it('ramps across the block instead of stepping', () => {
    // A parameter that jumps lands a discontinuity in the audio, which is the click you hear
    // when a badly behaved synth's knob is turned. Same reasoning as the engine's a-rate
    // ladder cutoff, one level up.
    const graph = graphFor(probePatch, PROBES)
    const plan = compile(probePatch, PROBES)
    graph.setParam(plan.slots.p.value, 1)

    const first = render(graph, 1)
    expect(first[0]).toBeCloseTo(1 / FRAMES, 5)
    expect(first[FRAMES - 1]).toBeCloseTo(1, 5)
    for (let i = 1; i < FRAMES; i++) expect(first[i]).toBeGreaterThan(first[i - 1])
  })

  it('flattens out once it has arrived', () => {
    // The ramp must not be replayed for as long as the knob sits still. This was the whole
    // reason for the `ramped` flag in the Graph, and without it a static knob would sound
    // like a sawtooth LFO at the block rate — 344Hz, and very audible.
    const graph = graphFor(probePatch, PROBES)
    graph.setParam(compile(probePatch, PROBES).slots.p.value, 1)
    render(graph, 1)

    const settled = render(graph, 4)
    for (let i = 0; i < settled.length; i++) expect(settled[i]).toBe(1)
  })

  it('steps a stepped param immediately', () => {
    // A waveform selector interpolated two thirds of the way between saw and pulse is not a
    // sound, and a ramp would make it flicker across the changeover for a block.
    const patch: Patch = { modules: [{ id: 'p', type: 'probe-stepped' }], cables: [] }
    const graph = graphFor(patch, PROBES)
    graph.setParam(compile(patch, PROBES).slots.p.value, 1)

    const first = render(graph, 1)
    for (let i = 0; i < FRAMES; i++) expect(first[i]).toBe(1)
  })

  it('ignores a slot or a value that makes no sense', () => {
    const graph = graphFor(probePatch, PROBES)
    const slot = compile(probePatch, PROBES).slots.p.value
    graph.setParam(slot, Number.NaN)
    graph.setParam(-1, 1)
    graph.setParam(9999, 1)

    const audio = render(graph, 2)
    for (let i = 0; i < audio.length; i++) expect(audio[i]).toBe(0)
  })
})

describe('replacing a plan', () => {
  it('takes effect and does not carry the old patch over', () => {
    const graph = graphFor(
      chain(
        [
          { id: 'osc', type: 'vco' },
          { id: 'out', type: 'out' },
        ],
        [['osc', 'out', 'out', 'in']],
      ),
    )
    expect(rms(render(graph, SECOND))).toBeGreaterThan(0.1)

    graph.setPlan(compile({ modules: [], cables: [] }, MODULES))
    expect(rms(render(graph, 4))).toBe(0)
  })

  it('says so when the plan names a module it does not have', () => {
    // Only possible when the worklet was assembled from a different module set than the one
    // that compiled the plan. Silence would be a very confusing symptom for that.
    const { deps } = build(MODULES)
    const graph = new Graph(SR, FRAMES, {}, deps)
    graph.setPlan(
      compile(
        chain(
          [
            { id: 'osc', type: 'vco' },
            { id: 'out', type: 'out' },
          ],
          [['osc', 'out', 'out', 'in']],
        ),
        MODULES,
      ),
    )
    expect(graph.missing).toEqual(['vco', 'out'])
    expect(rms(render(graph, 2))).toBe(0)
  })

  it('survives a change of render quantum with the knobs where they were', () => {
    // 128 is the render quantum today and the spec reserves the right to change it. The
    // knobs must not jump back to where the patch was saved when it does.
    const graph = graphFor(probePatchFor(), PROBES)
    graph.setParam(compile(probePatchFor(), PROBES).slots.p.value, 1)
    render(graph, 2)

    const wide = [new Float32Array(256), new Float32Array(256)]
    graph.process(wide)
    for (let i = 0; i < 256; i++) expect(wide[0][i]).toBe(1)
  })
})

function probePatchFor(): Patch {
  return { modules: [{ id: 'p', type: 'probe' }], cables: [] }
}
