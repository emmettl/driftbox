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

/** The first index where `ok` fails, or −1. One assertion per array rather than one per sample —
 *  see the comment on the same helper in `modules/svf.test.ts`. */
function firstBad(data: ArrayLike<number>, ok: (x: number) => boolean): number {
  for (let i = 0; i < data.length; i++) if (!ok(data[i])) return i
  return -1
}

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

it('collects several named meter readings from one hosted source', () => {
  const graph = graphFor({
    modules: [{ id: 'song', type: 'groovebox' }],
    cables: [],
  })
  const channels = [new Float32Array(FRAMES), new Float32Array(FRAMES)]
  const hostInputs = Array.from({ length: 4 }, (_, section) => [
    new Float32Array(FRAMES).fill((section + 1) * 0.1),
    new Float32Array(FRAMES).fill((section + 1) * 0.1),
  ])

  graph.process(channels, hostInputs)

  expect(graph.meters().map((reading) => reading.id)).toEqual([
    'song:tr808',
    'song:tr909',
    'song:303.a',
    'song:303.b',
  ])
})

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

  it('applies a saved inlet trim without changing an old patch at unity', () => {
    const withTrim = (inputTrim: number | undefined): Patch => ({
      modules: [
        { id: 'osc', type: 'vco' },
        {
          id: 'out',
          type: 'out',
          params: { level: 0.1 },
          ...(inputTrim === undefined ? {} : { inputTrims: { in: inputTrim } }),
        },
      ],
      cables: [{ from: ['osc', 'out'], to: ['out', 'in'] }],
    })
    const unity = rms(run(withTrim(undefined), 32), FRAMES * 8)
    const quarter = rms(run(withTrim(0.25), 32), FRAMES * 8)
    expect(quarter).toBeCloseTo(unity * 0.25, 4)
  })

  it('gives an inlet no slot at all while its pot sits at unity', () => {
    // Unity is exactly what the direct buffer path already does, so paying a buffer and a multiply per
    // sample to reproduce it is waste — measured at 3–5% of render time across `graph.bench.ts`. The
    // consequence is that engaging a trim rebuilds once; every turn after that is a message.
    const plan = compile(
      chain(
        [
          { id: 'osc', type: 'vco' },
          { id: 'out', type: 'out' },
        ],
        [['osc', 'out', 'out', 'in']],
      ),
      MODULES,
    )
    expect(plan.inputTrims!.out).toEqual({})
    expect(plan.nodes.find((node) => node.id === 'out')!.inletTrims?.[0]).toBeUndefined()
  })

  it('moves an inlet trim through its hidden ramped slot without rebuilding', () => {
    const patch = chain(
      [
        { id: 'osc', type: 'vco' },
        // Already off unity, so the slot exists. Turning it from here is what a drag does, and it must not
        // rebuild — a rebuild resets every oscillator's phase and every filter's history.
        { id: 'out', type: 'out', params: { level: 0.1 }, inputTrims: { in: 0.5 } },
      ],
      [['osc', 'out', 'out', 'in']],
    )
    const plan = compile(patch, MODULES)
    const { modules, deps } = build(MODULES)
    const graph = new Graph(SR, FRAMES, modules, deps)
    graph.setPlan(plan)
    graph.setParam(plan.inputTrims!.out.in, 0)
    const faded = render(graph, 1)
    const silent = render(graph, 1)
    expect(rms(faded)).toBeGreaterThan(0)
    expect(rms(silent)).toBe(0)
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
    expect(firstBad(audio, (x) => Number.isFinite(x) && Math.abs(x) <= 4)).toBe(-1)
  })

  it('keeps a module that has gone bad off the output bus', () => {
    // Not a rescue — a patch that produces infinities will sound wrong, and it should. The
    // point is narrower: the tab must survive it, because a NaN in an AudioNode is
    // permanent and a reload would be the only way back.
    const audio = run({ modules: [{ id: 'x', type: 'hostile' }], cables: [] }, 4, PROBES)
    expect(firstBad(audio, (x) => Number.isFinite(x) && Math.abs(x) <= 4)).toBe(-1)
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
    // 0.75 rather than 1, and below the master's soft ceiling for the same reason these values sit below the
    // limiter's threshold: a probe pinned where the master is shaping it measures the master, not the ramp.
    graph.setParam(plan.slots.p.value, 0.75)

    const first = render(graph, 1)
    expect(first[0]).toBeCloseTo(0.75 / FRAMES, 5)
    expect(first[FRAMES - 1]).toBeCloseTo(0.75, 5)
    let monotonic = true
    for (let i = 1; i < FRAMES; i++) if (first[i] <= first[i - 1]) monotonic = false
    expect(monotonic).toBe(true)
  })

  it('flattens out once it has arrived', () => {
    // The ramp must not be replayed for as long as the knob sits still. This was the whole
    // reason for the `ramped` flag in the Graph, and without it a static knob would sound
    // like a sawtooth LFO at the block rate — 344Hz, and very audible.
    const graph = graphFor(probePatch, PROBES)
    // 0.75, not 1: the master limiter starts working at 0.95, so a probe pinned above it would be measuring
    // the limiter rather than the ramp. 0.75 rather than 0.8 because this compares for exact equality and
    // three quarters survives the trip through a Float32Array; 0.8 comes back as 0.800000011920929.
    graph.setParam(compile(probePatch, PROBES).slots.p.value, 0.75)
    render(graph, 1)

    const settled = render(graph, 4)
    expect(firstBad(settled, (x) => x === 0.75)).toBe(-1)
  })

  it('steps a stepped param immediately', () => {
    // A waveform selector interpolated two thirds of the way between saw and pulse is not a
    // sound, and a ramp would make it flicker across the changeover for a block.
    const patch: Patch = { modules: [{ id: 'p', type: 'probe-stepped' }], cables: [] }
    const graph = graphFor(patch, PROBES)
    graph.setParam(compile(patch, PROBES).slots.p.value, 0.75)

    const first = render(graph, 1)
    expect(firstBad(first, (x) => x === 0.75)).toBe(-1)
  })

  it('ignores a slot or a value that makes no sense', () => {
    const graph = graphFor(probePatch, PROBES)
    const slot = compile(probePatch, PROBES).slots.p.value
    graph.setParam(slot, Number.NaN)
    graph.setParam(-1, 1)
    graph.setParam(9999, 1)

    const audio = render(graph, 2)
    expect(firstBad(audio, (x) => x === 0)).toBe(-1)
  })
})

describe('moving a knob at a moment', () => {
  // What recorded automation needed. A param change lands at the next block boundary, which is up to 2.9ms
  // out at 44.1kHz — inaudible on a slow sweep and quite audible on a filter meant to open on the downbeat.
  // These pin the timing; `values` is where the arithmetic is.

  const probePatch: Patch = { modules: [{ id: 'p', type: 'probe' }], cables: [] }
  const slotOf = (patch: Patch) => compile(patch, PROBES).slots.p.value

  /** Render `blocks` blocks, telling the Graph where each one sits on the context clock. */
  function renderAt(graph: Graph, blocks: number, from = 0): Float64Array {
    const channels = [new Float32Array(FRAMES), new Float32Array(FRAMES)]
    const out = new Float64Array(blocks * FRAMES)
    for (let block = 0; block < blocks; block++) {
      graph.process(channels, [], from + block * FRAMES)
      out.set(channels[0], block * FRAMES)
    }
    return out
  }

  it('holds the old value until the frame asked for, then moves', () => {
    // The whole feature in one assertion: silence up to the sample, sound from it.
    const graph = graphFor(probePatch, PROBES)
    graph.setParam(slotOf(probePatch), 0.75, undefined, 200)

    const audio = renderAt(graph, 2)
    // Frame 200 is 72 samples into the second block.
    expect(firstBad(audio.subarray(0, 200), (x) => x === 0)).toBe(-1)
    expect(audio[255]).toBeCloseTo(0.75, 5)
  })

  it('ramps from the frame rather than stepping at it', () => {
    // A scheduled change is still a change, so it still must not click. It ramps over what is left of the
    // block instead of over all of it, which is the only difference from a knob.
    const graph = graphFor(probePatch, PROBES)
    graph.setParam(slotOf(probePatch), 0.75, undefined, 64)

    const audio = renderAt(graph, 1)
    expect(audio[63]).toBe(0)
    // The first sample of the ramp, so the change starts at the frame asked for and not one after it.
    expect(audio[64]).toBeGreaterThan(0)
    let monotonic = true
    for (let i = 65; i < FRAMES; i++) if (audio[i] <= audio[i - 1]) monotonic = false
    expect(monotonic).toBe(true)
    expect(audio[FRAMES - 1]).toBeCloseTo(0.75, 5)
  })

  it('steps a stepped param exactly at the frame, with nothing in between', () => {
    // A selector caught between two settings is not a sound. There is nothing to interpolate — only a
    // moment to change at, which is precisely what this buys.
    const patch: Patch = { modules: [{ id: 'p', type: 'probe-stepped' }], cables: [] }
    const graph = graphFor(patch, PROBES)
    graph.setParam(slotOf(patch), 0.75, undefined, 100)

    const audio = renderAt(graph, 1)
    expect(firstBad(audio.subarray(0, 100), (x) => x === 0)).toBe(-1)
    expect(firstBad(audio.subarray(100), (x) => x === 0.75)).toBe(-1)
  })

  it('applies a frame that has already gone by rather than dropping it', () => {
    // Late is a timing error somebody can hear and reason about. Vanishing is a mystery, and a host reading
    // a lane a block late is an ordinary thing to happen under load.
    const graph = graphFor(probePatch, PROBES)
    graph.setParam(slotOf(probePatch), 0.75, undefined, 10)

    const audio = renderAt(graph, 2, 1000)
    expect(audio[FRAMES - 1]).toBeCloseTo(0.75, 5)
  })

  it('keeps the last change when two land in one block, by frame and not by arrival', () => {
    // "Later wins" is only defensible if later means later in time. A host posting a lane out of order
    // would otherwise hear whichever message happened to be delivered last.
    const graph = graphFor(probePatch, PROBES)
    const slot = slotOf(probePatch)
    graph.setParam(slot, 0.75, undefined, 90)
    graph.setParam(slot, 0.25, undefined, 30)

    const audio = renderAt(graph, 2)
    expect(audio[FRAMES - 1]).toBeCloseTo(0.75, 5)
  })

  it('does not offset the next knob turn', () => {
    // `rampAt` is per slot and persists unless cleared, so a scheduled move followed by an ordinary one is
    // exactly where a stale offset would show up — as a knob that hesitates before moving.
    const graph = graphFor(probePatch, PROBES)
    const slot = slotOf(probePatch)
    graph.setParam(slot, 0.25, undefined, 100)
    renderAt(graph, 1)

    graph.setParam(slot, 0.75)
    const audio = renderAt(graph, 1, FRAMES)
    // A knob ramps from the very first sample, so it has already left where it started.
    expect(audio[0]).toBeGreaterThan(0.25)
    expect(audio[FRAMES - 1]).toBeCloseTo(0.75, 5)
  })

  it('leaves an unscheduled knob byte-identical to before scheduling existed', () => {
    // The immediate path is an offset of zero through the same arithmetic, so this is the regression test
    // for the whole change: every existing patch must sound exactly as it did.
    const graph = graphFor(probePatch, PROBES)
    graph.setParam(slotOf(probePatch), 0.75)
    const audio = render(graph, 1)
    expect(audio[0]).toBeCloseTo(0.75 / FRAMES, 5)
    expect(audio[FRAMES - 1]).toBeCloseTo(0.75, 5)
  })

  it('treats a nonsense frame as a knob rather than losing the change', () => {
    const graph = graphFor(probePatch, PROBES)
    graph.setParam(slotOf(probePatch), 0.75, undefined, Number.NaN)
    const audio = render(graph, 1)
    expect(audio[FRAMES - 1]).toBeCloseTo(0.75, 5)
  })

  it('forgets what was scheduled against a patch that no longer exists', () => {
    // A rebuild renumbers the slots, so a change waiting on slot 3 would land on whatever parameter is
    // third in the new patch — a knob moving on its own, in a module nobody touched.
    const graph = graphFor(probePatch, PROBES)
    graph.setParam(slotOf(probePatch), 0.75, undefined, 5000)
    graph.setPlan(compile(probePatch, PROBES))

    const audio = renderAt(graph, 60)
    expect(firstBad(audio, (x) => x === 0)).toBe(-1)
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
    graph.setParam(compile(probePatchFor(), PROBES).slots.p.value, 0.75)
    render(graph, 2)

    const wide = [new Float32Array(256), new Float32Array(256)]
    graph.process(wide)
    expect(firstBad(wide[0], (x) => x === 0.75)).toBe(-1)
  })
})

function probePatchFor(): Patch {
  return { modules: [{ id: 'p', type: 'probe' }], cables: [] }
}

describe('a patch made of the whole rack', () => {
  // The point of step 3 is not sixteen modules; it is sixteen modules that work together. Each has
  // its own tests and every one of them passes with the module in isolation — this is the part that
  // would catch a convention nobody quite shares, a gate that is 0..1 at one end of a cable and ±1
  // at the other, or a pitch in semitones meeting an inlet expecting octaves.

  const patch = (
    modules: [string, string, Record<string, number>?][],
    cables: [string, string, string, string][],
  ): Patch => ({
    modules: modules.map(([id, type, params]) => ({ id, type, params })),
    cables: cables.map(([a, b, c, d]) => ({ from: [a, b], to: [c, d] })),
  })

  it('plays a sequence: clock into sequencer into envelope, oscillator through a filter', () => {
    const audio = run(
      patch(
        [
          ['clock', 'clock', { rate: 8, width: 0.4 }],
          ['seq', 'seq', { pitch1: 0, pitch2: 7, pitch3: 12, pitch4: 5, length: 4 }],
          ['env', 'adsr', { attack: 0.002, decay: 0.06, sustain: 0.2, release: 0.05 }],
          ['osc', 'vco', { tune: -12, shape: 0 }],
          ['filter', 'svf', { cutoff: 900, resonance: 0.5 }],
          ['amp', 'vca', { gain: 0 }],
          ['out', 'out', { level: 0.8 }],
        ],
        [
          ['clock', 'gate', 'seq', 'clock'],
          ['seq', 'pitch', 'osc', 'pitch'],
          ['seq', 'gate', 'env', 'gate'],
          ['osc', 'out', 'filter', 'in'],
          ['filter', 'lp', 'amp', 'in'],
          ['env', 'out', 'amp', 'cv'],
          ['amp', 'out', 'out', 'in'],
        ],
      ),
      SECOND,
    )

    // It makes a sound.
    expect(rms(audio)).toBeGreaterThan(0.02)

    // And it is a sequence rather than a drone: the envelope closes the VCA between notes, so the
    // level has to come back down eight times a second. Anything that broke the gate convention
    // between the sequencer and the envelope would show up as a continuous tone instead.
    const window = Math.floor(SR / 64)
    const levels: number[] = []
    for (let start = 0; start + window < audio.length; start += window) {
      levels.push(rms(audio.slice(start, start + window)))
    }
    const loud = Math.max(...levels)
    const quiet = Math.min(...levels)
    expect(loud / (quiet + 1e-9)).toBeGreaterThan(20)
  })

  it('plays a generative line: noise sampled on a clock, quantized to a scale', () => {
    // Four modules, none of which is a sequencer, making a melody. The clearest demonstration of one
    // signal type being worth having: what gets sampled is audio and what it becomes is pitch, and
    // nothing had to be told about the change.
    const audio = run(
      patch(
        [
          ['noise', 'noise'],
          ['clock', 'clock', { rate: 6 }],
          ['sh', 'sample-hold'],
          ['quant', 'quantizer', { scale: 3, root: 0 }],
          ['osc', 'vco', { tune: 0 }],
          ['env', 'adsr', { attack: 0.002, decay: 0.1, sustain: 0, release: 0.05 }],
          ['amp', 'vca', { gain: 0 }],
          ['out', 'out', { level: 0.7 }],
        ],
        [
          ['noise', 'white', 'sh', 'in'],
          ['clock', 'trig', 'sh', 'trig'],
          ['sh', 'out', 'quant', 'in'],
          ['quant', 'out', 'osc', 'pitch'],
          ['quant', 'trig', 'env', 'trig'],
          ['osc', 'out', 'amp', 'in'],
          ['env', 'out', 'amp', 'cv'],
          ['amp', 'out', 'out', 'in'],
        ],
      ),
      SECOND,
    )
    expect(rms(audio)).toBeGreaterThan(0.01)
    expect(firstBad(audio, Number.isFinite)).toBe(-1)
  })

  it('runs every module at once without going non-finite', () => {
    // Everything in the registry, patched into a chain, with the modulation sources wired to real
    // destinations. Not musical — a smoke test for the whole set together, including the two that
    // have somewhere to feed back to.
    const audio = run(
      patch(
        [
          ['lfo', 'lfo', { rate: 5, shape: 1 }],
          ['clock', 'clock', { rate: 4 }],
          ['seq', 'seq', {}],
          ['noise', 'noise'],
          ['sh', 'sample-hold'],
          ['quant', 'quantizer'],
          ['osc', 'vco'],
          ['ladder', 'ladder', { cutoff: 1200, resonance: 0.7 }],
          ['svf', 'svf', { cutoff: 2000, resonance: 0.6 }],
          ['drive', 'drive', { drive: 12, bias: 0.2 }],
          ['delay', 'delay', { time: 0.12, feedback: 0.6 }],
          ['env', 'adsr', {}],
          ['off', 'offset', { gain: 0.5, offset: 0.1 }],
          ['mix', 'mixer', { level1: 0.4, level2: 0.4, level3: 0.4, level4: 0.4 }],
          ['amp', 'vca', { gain: 0.5, curve: 1 }],
          ['out', 'out'],
        ],
        [
          ['clock', 'gate', 'seq', 'clock'],
          ['clock', 'trig', 'sh', 'trig'],
          ['noise', 'pink', 'sh', 'in'],
          ['sh', 'out', 'quant', 'in'],
          ['quant', 'out', 'osc', 'pitch'],
          ['seq', 'gate', 'env', 'gate'],
          ['lfo', 'bi', 'off', 'in'],
          ['off', 'out', 'osc', 'fm'],
          ['osc', 'out', 'ladder', 'in'],
          ['env', 'out', 'ladder', 'cutoff'],
          ['ladder', 'out', 'svf', 'in'],
          ['svf', 'lp', 'drive', 'in'],
          ['drive', 'out', 'delay', 'in'],
          ['drive', 'out', 'mix', 'in1'],
          ['delay', 'out', 'mix', 'in2'],
          ['noise', 'white', 'mix', 'in3'],
          ['svf', 'bp', 'mix', 'in4'],
          ['lfo', 'uni', 'mix', 'cv3'],
          ['mix', 'out', 'amp', 'in'],
          ['env', 'out', 'amp', 'cv'],
          ['amp', 'out', 'out', 'in'],
        ],
      ),
      SECOND,
    )

    expect(rms(audio)).toBeGreaterThan(0.001)
    expect(firstBad(audio, (x) => Number.isFinite(x) && Math.abs(x) <= 4)).toBe(-1)
  })
})

describe('where the rack ends up in the stereo field', () => {
  // Placing a mono terminal in the field is what `docs/DNB.md` argues for: two chains hard-panned give a
  // Reese that actually phases. A stereo terminal arrives as a pair instead, and the same pan knob then
  // means balance — both cases are below, because the arithmetic is shared and a change to one is a change
  // to the other.

  /** Render both channels, rather than only the left as `render` does. */
  const stereo = (patch: Patch, blocks = 3) => {
    const graph = graphFor(patch)
    const channels = [new Float32Array(FRAMES), new Float32Array(FRAMES)]
    for (let block = 0; block < blocks; block++) graph.process(channels)
    return { left: channels[0][FRAMES - 1], right: channels[1][FRAMES - 1] }
  }

  /** A DC source at a level the limiter leaves alone, through an Out with a given pan. */
  const panned = (pan: number): Patch => ({
    modules: [
      { id: 'o-1', type: 'offset', params: { offset: 0.5 } },
      { id: 'out-1', type: 'out', params: { level: 1, pan } },
    ],
    cables: [{ from: ['o-1', 'out'], to: ['out-1', 'in'] }],
  })

  it('is centred by default, at exactly the level it was before stereo existed', () => {
    // The reason the law is balance and not equal-power. Equal-power puts centre at 0.707 on both channels,
    // which would have made every patch shared before this quietly 3dB quieter — for a format whose whole
    // selling point is that a patch travels in a URL, that is not a cosmetic difference.
    const { left, right } = stereo(panned(0))
    expect(left).toBeCloseTo(0.5, 5)
    expect(right).toBeCloseTo(0.5, 5)
  })

  it('sends everything one way when hard panned', () => {
    const hardLeft = stereo(panned(-1))
    expect(hardLeft.left).toBeCloseTo(0.5, 5)
    expect(hardLeft.right).toBeCloseTo(0, 5)

    const hardRight = stereo(panned(1))
    expect(hardRight.left).toBeCloseTo(0, 5)
    expect(hardRight.right).toBeCloseTo(0.5, 5)
  })

  it('keeps the near side at full level while the far side fades', () => {
    // What a balance control does, and what makes hard-panning two chains give each one its channel at full
    // level rather than at 0.707 of it.
    const { left, right } = stereo(panned(-0.5))
    expect(left).toBeCloseTo(0.5, 5)
    expect(right).toBeCloseTo(0.25, 5)
  })

  it('carries a stereo source to the two channels without mixing them', () => {
    // The feature: one cable, two channels, different signals on each. Hard-panned Outs could already put
    // two SOURCES apart; nothing could carry one source's own width.
    const graph = graphFor({
      modules: [
        { id: 'rev', type: 'reverb', params: { mix: 1, decay: 0.9, size: 1 } },
        { id: 'imp', type: 'clock', params: { rate: 2 } },
        { id: 'out-1', type: 'out', params: { level: 1 } },
      ],
      cables: [
        { from: ['imp', 'trig'], to: ['rev', 'in'] },
        { from: ['rev', 'out'], to: ['out-1', 'in'] },
      ],
    })
    const channels = [new Float32Array(FRAMES), new Float32Array(FRAMES)]
    let apart = 0
    let energy = 0
    for (let block = 0; block < 200; block++) {
      graph.process(channels)
      for (let i = 0; i < FRAMES; i++) {
        apart += (channels[0][i] - channels[1][i]) ** 2
        energy += channels[0][i] ** 2 + channels[1][i] ** 2
      }
    }
    expect(energy).toBeGreaterThan(0)
    // Not merely non-zero: genuinely different signals. Two identical channels would give zero here, which
    // is exactly what this measured before the reverb's outlet became a pair.
    expect(apart / energy).toBeGreaterThan(0.1)
  })

  it('still centres a mono source into a stereo inlet, at the level it always had', () => {
    // Every patch written before stereo existed is this case. `wire` duplicates the one buffer, so both
    // channels get it and the pan law then does what it always did.
    const { left, right } = stereo(panned(0))
    expect(left).toBeCloseTo(right, 10)
  })

  it('places two Outs independently, which is the whole point', () => {
    // The Reese: two chains hard apart. One source per side, and neither leaks into the other.
    const { left, right } = stereo({
      modules: [
        { id: 'a', type: 'offset', params: { offset: 0.4 } },
        { id: 'b', type: 'offset', params: { offset: 0.2 } },
        { id: 'out-1', type: 'out', params: { level: 1, pan: -1 } },
        { id: 'out-2', type: 'out', params: { level: 1, pan: 1 } },
      ],
      cables: [
        { from: ['a', 'out'], to: ['out-1', 'in'] },
        { from: ['b', 'out'], to: ['out-2', 'in'] },
      ],
    })
    expect(left).toBeCloseTo(0.4, 5)
    expect(right).toBeCloseTo(0.2, 5)
  })

  it('leaves the Thru outlet mono and pre-pan', () => {
    // A patch cable in this rack carries one signal. A Thru that quietly carried only the left half would be
    // a trap, and it would make an Out feeding a Delay feeding another Out behave unlike its picture.
    const { left, right } = stereo({
      modules: [
        { id: 'o-1', type: 'offset', params: { offset: 0.3 } },
        { id: 'out-1', type: 'out', params: { level: 1, pan: -1 } },
        { id: 'out-2', type: 'out', params: { level: 1, pan: 1 } },
      ],
      cables: [
        { from: ['o-1', 'out'], to: ['out-1', 'in'] },
        // Fed from the hard-left Out's Thru. If Thru were post-pan this would be silent on the right.
        { from: ['out-1', 'out'], to: ['out-2', 'in'] },
      ],
    })
    expect(left).toBeCloseTo(0.3, 5)
    expect(right).toBeCloseTo(0.3, 5)
  })

  it('clamps a pan driven past its ends rather than inverting the signal', () => {
    // The param is declared −1..1, but nothing stops a patch file from carrying something else, and a pan of
    // 2 through a bare `1 - pan` would come out phase-inverted on the far side.
    for (const pan of [-4, 4]) {
      const { left, right } = stereo(panned(pan))
      expect(left).toBeGreaterThanOrEqual(0)
      expect(right).toBeGreaterThanOrEqual(0)
      expect(Math.max(left, right)).toBeCloseTo(0.5, 5)
      expect(Math.min(left, right)).toBeCloseTo(0, 5)
    }
  })
})

describe('the master limiter', () => {
  // It replaces a bare clamp at ±4. The clamp is still there behind it, because it is what keeps a feedback
  // patch from killing the tab — but a loud mix used to meet a brick wall.

  const loud = (offset: number): Patch => ({
    modules: [
      { id: 'o-1', type: 'offset', params: { offset } },
      { id: 'out-1', type: 'out', params: { level: 1 } },
    ],
    cables: [{ from: ['o-1', 'out'], to: ['out-1', 'in'] }],
  })

  it('leaves a signal under the threshold completely alone', () => {
    // The important half. A limiter that shaved a quiet mix would change the sound of every patch that never
    // needed it, and the two probe suites above rely on this being exact.
    const audio = run(loud(0.5), 4)
    expect(firstBad(audio, (x) => Math.abs(x - 0.5) < 1e-6)).toBe(-1)
  })

  it('holds a loud mix just under full scale instead of at the old brick wall', () => {
    const audio = run(loud(3), 8)
    const settled = audio.slice(audio.length - FRAMES)
    for (const x of settled) expect(x).toBeLessThanOrEqual(0.96)
    // And it is still loud: pulled down to the ceiling, not squashed to nothing.
    expect(settled[settled.length - 1]).toBeGreaterThan(0.9)
  })

  it('catches a sudden loud passage within a few milliseconds', () => {
    // A millisecond of attack, so a transient gets through briefly and is then held. What must not happen is
    // that it stays through — that is the difference between a limiter and a wish.
    const audio = run(loud(3), 8)
    const settleBy = Math.round(0.005 * SR)
    for (let i = settleBy; i < audio.length; i++) expect(audio[i]).toBeLessThanOrEqual(0.96)
  })

  it('still clamps rather than letting an infinity through', () => {
    // The limiter cannot save this: an infinite peak makes the gain zero and the arithmetic meaningless. The
    // clamp behind it is what keeps the tab alive, and a NaN in an AudioNode is permanent.
    const audio = run({ modules: [{ id: 'x', type: 'hostile' }], cables: [] }, 4, PROBES)
    expect(firstBad(audio, (x) => Number.isFinite(x) && Math.abs(x) <= 4)).toBe(-1)
  })

  it('recovers its gain after the loud part stops', () => {
    // Without a release it would duck once and stay ducked for the rest of the session.
    const patch = loud(3)
    const graph = graphFor(patch)
    const plan = compile(patch, MODULES)
    const channels = [new Float32Array(FRAMES), new Float32Array(FRAMES)]
    for (let block = 0; block < 8; block++) graph.process(channels)

    graph.setParam(plan.slots['o-1'].offset, 0.5)
    // Half a second: several release constants, and well short of forever.
    for (let block = 0; block < Math.ceil((0.5 * SR) / FRAMES); block++) graph.process(channels)
    expect(channels[0][FRAMES - 1]).toBeCloseTo(0.5, 2)
  })
})

describe('muting and soloing channels', () => {
  // The Out is a channel strip, and these two are the reason the mix rules live in the Graph rather than in
  // the module. Pan could arguably have gone either way; solo could not, because soloing one channel
  // silences the OTHERS and a module has no idea the others exist.

  const level = (patch: Patch) => {
    const graph = graphFor(patch)
    const channels = [new Float32Array(FRAMES), new Float32Array(FRAMES)]
    for (let block = 0; block < 3; block++) graph.process(channels)
    return { left: channels[0][FRAMES - 1], right: channels[1][FRAMES - 1] }
  }

  /** Two sources at different levels, each with its own Out, so they can be told apart in the mix. */
  const twoChannels = (a: Record<string, number>, b: Record<string, number>): Patch => ({
    modules: [
      { id: 'a', type: 'offset', params: { offset: 0.4 } },
      { id: 'b', type: 'offset', params: { offset: 0.2 } },
      { id: 'out-1', type: 'out', params: { level: 1, ...a } },
      { id: 'out-2', type: 'out', params: { level: 1, ...b } },
    ],
    cables: [
      { from: ['a', 'out'], to: ['out-1', 'in'] },
      { from: ['b', 'out'], to: ['out-2', 'in'] },
    ],
  })

  it('sums both channels when neither is touched', () => {
    expect(level(twoChannels({}, {})).left).toBeCloseTo(0.6, 5)
  })

  it('drops a muted channel out of the mix', () => {
    expect(level(twoChannels({ mute: 1 }, {})).left).toBeCloseTo(0.2, 5)
    expect(level(twoChannels({}, { mute: 1 })).left).toBeCloseTo(0.4, 5)
  })

  it('silences everything when every channel is muted', () => {
    expect(level(twoChannels({ mute: 1 }, { mute: 1 })).left).toBeCloseTo(0, 5)
  })

  it('silences the others when one is soloed', () => {
    // The whole point, and the thing that cannot be a property of a module.
    expect(level(twoChannels({ solo: 1 }, {})).left).toBeCloseTo(0.4, 5)
    expect(level(twoChannels({}, { solo: 1 })).left).toBeCloseTo(0.2, 5)
  })

  it('plays every soloed channel when more than one is', () => {
    // Solo is not radio-button exclusive. Soloing two channels means "these two", which is what every mixer
    // does and what anybody pressing a second solo expects.
    expect(level(twoChannels({ solo: 1 }, { solo: 1 })).left).toBeCloseTo(0.6, 5)
  })

  it('keeps a muted channel silent even when it is soloed', () => {
    // Contradictory, and mute has to win: mute is the deliberate one and solo is the temporary one, so
    // resolving it the other way would make a muted channel come back the moment anything was soloed.
    expect(level(twoChannels({ mute: 1, solo: 1 }, {})).left).toBeCloseTo(0, 5)
  })

  it('is neutral by default, so a patch from before this sounds the same', () => {
    // Both default to zero, which is why adding two params to the Out changes no existing patch.
    const out = MODULES.out.params
    expect(out.find((p) => p.id === 'mute')!.default).toBe(0)
    expect(out.find((p) => p.id === 'solo')!.default).toBe(0)
  })

  it('still pans what survives the mute and solo', () => {
    // The two rules compose: solo picks the channels, pan places them.
    const { left, right } = level(twoChannels({ solo: 1, pan: -1 }, { pan: 1 }))
    expect(left).toBeCloseTo(0.4, 5)
    expect(right).toBeCloseTo(0, 5)
  })
})

describe('the soft ceiling behind the limiter', () => {
  // The limiter reacts to a peak as it arrives, so it cannot catch the peak itself — the gain is only down a
  // sample later. Measured on an export of three chunks at once, that let through a peak of 1.17, which is
  // above full scale and clips audibly. A lookahead would fix it by construction and was tried; it costs
  // three milliseconds of latency on an instrument somebody plays with a keyboard, which is too much for a
  // defect this size. So the transients meet a curve.

  const loud = (offset: number): Patch => ({
    modules: [
      { id: 'o-1', type: 'offset', params: { offset } },
      { id: 'out-1', type: 'out', params: { level: 1 } },
    ],
    cables: [{ from: ['o-1', 'out'], to: ['out-1', 'in'] }],
  })

  it('never lets anything past full scale, however hard it is driven', () => {
    // The property the whole thing exists for. Checked well past anything musical, because a feedback patch
    // is exactly where this gets tested in practice.
    for (const offset of [1, 2, 8, 40]) {
      const audio = run(loud(offset), 8)
      const peak = Math.max(...[...audio].map(Math.abs))
      expect(peak, `offset ${offset}`).toBeLessThanOrEqual(1)
    }
  })

  it('leaves everything under the knee arithmetically untouched', () => {
    // The other half, and the more important one. A ceiling that coloured ordinary signals would change the
    // sound of every patch that never needed it — and the knee sits at the limiter's own threshold precisely
    // so that only what the limiter could not catch is bent.
    const audio = run(loud(0.5), 4)
    expect(firstBad(audio, (x) => Math.abs(x - 0.5) < 1e-6)).toBe(-1)
  })

  it('bends rather than clipping flat, so a transient keeps its shape', () => {
    // Hard clipping would take everything above the ceiling to the same value and turn a transient into a
    // square edge. Two different overshoots have to come out as two different numbers.
    const small = Math.max(...[...run(loud(1.05), 6)].map(Math.abs))
    const large = Math.max(...[...run(loud(1.6), 6)].map(Math.abs))
    expect(large).toBeGreaterThan(small)
    expect(large).toBeLessThanOrEqual(1)
  })

  it('is still monotonic, so louder in is never quieter out', () => {
    // A curve that folded back would make a loud patch quieter than a moderate one, which is the classic
    // wavefolder-by-accident bug.
    let previous = 0
    for (const offset of [0.2, 0.5, 0.9, 1, 1.5, 3]) {
      const peak = Math.max(...[...run(loud(offset), 6)].map(Math.abs))
      expect(peak, `offset ${offset}`).toBeGreaterThanOrEqual(previous - 1e-6)
      previous = peak
    }
  })

  it('keeps the two channels in step, so the image does not shift', () => {
    // Applied per channel but driven by a gain computed across the pair, so a peak on one side must not
    // move the other. Two identical sources hard apart come back matched.
    const graph = graphFor({
      modules: [
        { id: 'a', type: 'offset', params: { offset: 1.4 } },
        { id: 'out-1', type: 'out', params: { level: 1, pan: -1 } },
        { id: 'out-2', type: 'out', params: { level: 1, pan: 1 } },
      ],
      cables: [
        { from: ['a', 'out'], to: ['out-1', 'in'] },
        { from: ['a', 'out'], to: ['out-2', 'in'] },
      ],
    })
    const channels = [new Float32Array(FRAMES), new Float32Array(FRAMES)]
    for (let block = 0; block < 6; block++) graph.process(channels)
    expect(channels[0][FRAMES - 1]).toBeCloseTo(channels[1][FRAMES - 1], 6)
  })
})

describe('taking a module out of circuit', () => {
  // The compiler decides bypass and `compile.test.ts` proves the wiring. What that cannot show is that
  // the result is audibly the dry signal, which is the only thing anybody actually wants from a bypass.

  const patch = (bypassed?: true): Patch => ({
    modules: [
      { id: 'o-1', type: 'offset', params: { offset: 0.4 } },
      // A big boost, so "did it apply" is not a question about a fraction of a dB.
      { id: 'eq-1', type: 'eq', params: { low: 18, lowFreq: 500 }, ...(bypassed ? { bypassed } : {}) },
      { id: 'out-1', type: 'out', params: { level: 1 } },
    ],
    cables: [
      { from: ['o-1', 'out'], to: ['eq-1', 'in'] },
      { from: ['eq-1', 'out'], to: ['out-1', 'in'] },
    ],
  })

  it('is audibly the dry signal, sample for sample', () => {
    const wet = run(patch(), 8)
    const dry = run(patch(true), 8)
    // DC through an 18dB low shelf comes out well above the input; bypassed it must be the input itself.
    expect(rms(dry, FRAMES * 4)).toBeCloseTo(0.4, 3)
    expect(rms(wet, FRAMES * 4)).toBeGreaterThan(0.5)
  })

  it('is the same as never having patched it, once it is out', () => {
    const direct = run(
      {
        modules: [
          { id: 'o-1', type: 'offset', params: { offset: 0.4 } },
          { id: 'out-1', type: 'out', params: { level: 1 } },
        ],
        cables: [{ from: ['o-1', 'out'], to: ['out-1', 'in'] }],
      },
      8,
    )
    const bypassed = run(patch(true), 8)
    expect(rms(bypassed, FRAMES * 4)).toBeCloseTo(rms(direct, FRAMES * 4), 6)
  })
})
