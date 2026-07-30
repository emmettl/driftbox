import { describe, expect, it } from 'vitest'
import { compile } from './compile.js'
import { Random } from './dsp/random.js'
import { Graph } from './graph.js'
import { MODULES } from './modules/index.js'
import type { ModuleDef, Patch, Processor, Registry } from './types.js'

// The transport, and bulk data into modules. Phase A of `docs/DNB.md` — neither is much use on its own and
// nothing rhythmic is possible without the first.

const SR = 44100
const FRAMES = 128

/** Records the bulk data it was handed, so the mechanism can be tested before a sampler exists to use it. */
class DataProbeProcessor implements Processor {
  static seen: (Float32Array | undefined)[] = []
  private readonly data: { get(slot: string): Float32Array | undefined }

  constructor(
    _sampleRate: number,
    _deps: Record<string, unknown>,
    _id: string,
    data: { get(slot: string): Float32Array | undefined },
  ) {
    this.data = data
  }

  process(
    _inlets: Float32Array[],
    outlets: Float32Array[],
    _params: Float32Array[],
    frames: number,
  ): void {
    const table = this.data.get('table')
    DataProbeProcessor.seen.push(table)
    // Output the first value, so the data can be observed through the audio as well as directly.
    for (let i = 0; i < frames; i++) outlets[0][i] = table ? table[0] : 0
  }
}

const PROBE: ModuleDef = {
  type: 'probe',
  version: 1,
  name: 'Probe',
  inlets: [],
  outlets: [{ id: 'out', name: 'Out' }],
  params: [],
  processor: DataProbeProcessor,
  terminal: true,
  poly: false,
}

const REGISTRY: Registry = { ...MODULES, probe: PROBE }

function build(patch: Patch, registry: Registry = REGISTRY) {
  const modules: Record<string, ModuleDef['processor']> = {}
  const deps: Record<string, unknown> = { Random }
  for (const def of Object.values(registry)) {
    modules[def.type] = def.processor
    for (const [name, dep] of Object.entries(def.deps ?? {})) deps[name] = dep
  }
  const graph = new Graph(SR, FRAMES, modules, deps)
  const plan = compile(patch, registry)
  graph.setPlan(plan)
  return { graph, plan }
}

/** Every sample of one outlet across several blocks. */
function render(graph: Graph, blocks: number): Float64Array {
  const channels = [new Float32Array(FRAMES), new Float32Array(FRAMES)]
  const out = new Float64Array(blocks * FRAMES)
  for (let block = 0; block < blocks; block++) {
    graph.process(channels)
    out.set(channels[0], block * FRAMES)
  }
  return out
}

function pulses(data: Float64Array): number {
  let count = 0
  for (let i = 0; i < data.length; i++) {
    if (data[i] >= 0.5 && (i === 0 || data[i - 1] < 0.5)) count++
  }
  return count
}

const clocked = (params: Record<string, number> = {}): Patch => ({
  modules: [
    { id: 't', type: 'transport', params },
    { id: 'out', type: 'out', params: { level: 1 } },
  ],
  cables: [{ from: ['t', 'sixteenth'], to: ['out', 'in'] }],
})

describe('the transport', () => {
  it('does nothing until it is running', () => {
    const { graph } = build(clocked())
    graph.setTransport(174, false)
    expect(pulses(render(graph, 40))).toBe(0)
  })

  it('ticks sixteenths at the tempo it was given', () => {
    // 174bpm is drum and bass. A sixteenth at 174 is 86.2ms, so a second holds 11.6 of them.
    const { graph } = build(clocked())
    graph.setTransport(174, true)
    const seconds = 2
    const counted = pulses(render(graph, Math.ceil((seconds * SR) / FRAMES)))
    expect(counted).toBeCloseTo((174 / 60) * 4 * seconds, -1)
  })

  it('fires the downbeat when play is pressed', () => {
    // The same decision the Clock makes by arming itself at construction. A transport that stays silent until
    // one whole beat has gone by reads as broken, and at 60bpm that is a second of nothing.
    const { graph } = build(clocked())
    graph.setTransport(120, true)
    expect(render(graph, 1)[0]).toBe(1)
  })

  it('ticks quarters four times slower than sixteenths', () => {
    // 120bpm for four seconds is exactly eight beats, which matters: over a fractional number of beats the two
    // integer counts do not divide cleanly. At 174 over two seconds it is 23 sixteenths to 5 quarters — a ratio
    // of 4.6, with both counts correct. That was the first version of this test and the arithmetic was mine.
    //
    // Eight and thirty-two counting the downbeat, which the transport fires when play is pressed.
    const quarterPatch: Patch = {
      modules: [
        { id: 't', type: 'transport' },
        { id: 'out', type: 'out', params: { level: 1 } },
      ],
      cables: [{ from: ['t', 'quarter'], to: ['out', 'in'] }],
    }
    const blocks = Math.floor((4 * SR) / FRAMES)

    const { graph } = build(quarterPatch)
    graph.setTransport(120, true)
    const quarters = pulses(render(graph, blocks))

    const { graph: other } = build(clocked())
    other.setTransport(120, true)
    const sixteenths = pulses(render(other, blocks))

    expect(quarters).toBe(8)
    expect(sixteenths).toBe(32)
  })

  it('carries on from where the music was when the tempo changes', () => {
    // The reason `beat` is accumulated per block rather than derived from an absolute frame count. Deriving it
    // would make a tempo change jump to wherever the new arithmetic lands, which mid-bar is a stumble.
    const { graph } = build(clocked())
    graph.setTransport(120, true)
    render(graph, 60)
    graph.setTransport(174, true)
    // No double-trigger and no gap at the changeover: two seconds at the new tempo counts as two seconds.
    const after = pulses(render(graph, Math.ceil((2 * SR) / FRAMES)))
    expect(after).toBeCloseTo((174 / 60) * 4 * 2, -1)
  })

  it('rewinds when it is started, and not when the tempo moves', () => {
    const { graph } = build({
      modules: [
        { id: 't', type: 'transport' },
        { id: 'out', type: 'out', params: { level: 1 } },
      ],
      cables: [{ from: ['t', 'bar'], to: ['out', 'in'] }],
    })
    graph.setTransport(120, true)
    render(graph, 40)
    // Stop and start: back to the top of the bar.
    graph.setTransport(120, false)
    graph.setTransport(120, true)
    expect(render(graph, 1)[0]).toBeLessThan(0.02)
  })

  it('holds its position while stopped', () => {
    const patch: Patch = {
      modules: [
        { id: 't', type: 'transport' },
        { id: 'out', type: 'out', params: { level: 1 } },
      ],
      cables: [{ from: ['t', 'bar'], to: ['out', 'in'] }],
    }
    const { graph } = build(patch)
    graph.setTransport(120, true)
    render(graph, 30)
    graph.setTransport(120, false)
    const first = render(graph, 1)[0]
    const later = render(graph, 10)
    expect(later[later.length - 1]).toBeCloseTo(first, 5)
  })

  it('runs a bar ramp from 0 to 1 across four beats', () => {
    const patch: Patch = {
      modules: [
        { id: 't', type: 'transport', params: { beatsPerBar: 4 } },
        { id: 'out', type: 'out', params: { level: 1 } },
      ],
      cables: [{ from: ['t', 'bar'], to: ['out', 'in'] }],
    }
    const { graph } = build(patch)
    graph.setTransport(120, true)
    // 120bpm, four beats to a bar: a bar is two seconds.
    const audio = render(graph, Math.ceil((2 * SR) / FRAMES))
    expect(audio[0]).toBeCloseTo(0, 2)
    expect(audio[Math.floor(SR)]).toBeCloseTo(0.5, 1)
    // And it wraps rather than climbing forever.
    let peak = 0
    for (const x of audio) peak = Math.max(peak, x)
    expect(peak).toBeLessThanOrEqual(1.001)
  })

  it('says nothing at all with no transport, rather than crashing', () => {
    // Reachable from a test that constructs a processor directly, which `modules.test.ts` does for all of them.
    const outs = [0, 1, 2, 3, 4, 5].map(() => new Float32Array(FRAMES).fill(-1))
    new MODULES.transport.processor(SR, {}, 't', { get: () => undefined }).process(
      [],
      outs,
      [new Float32Array(FRAMES).fill(4)],
      FRAMES,
    )
    for (const out of outs) for (const x of out) expect(x).toBe(0)
  })
})

describe('bulk data into a module', () => {
  it('arrives from the patch, because a pattern is part of the document', () => {
    DataProbeProcessor.seen = []
    const { graph } = build({
      modules: [{ id: 'p', type: 'probe', data: { table: [0.25, 0.5] } }],
      cables: [],
    })
    render(graph, 2)
    expect([...(DataProbeProcessor.seen[0] ?? [])]).toEqual([0.25, 0.5])
  })

  it('arrives from a push, because a sample is not', () => {
    DataProbeProcessor.seen = []
    const { graph } = build({ modules: [{ id: 'p', type: 'probe' }], cables: [] })
    render(graph, 1)
    expect(DataProbeProcessor.seen[0]).toBeUndefined()

    graph.setData('p', 'table', Float32Array.from([0.75]))
    render(graph, 1)
    expect(DataProbeProcessor.seen[1]?.[0]).toBeCloseTo(0.75, 5)
  })

  it('reaches a module built before the data existed', () => {
    // Somebody loads a break into a patch that is already playing. A snapshot handed at construction would
    // never see it, which is why the module gets a live view.
    DataProbeProcessor.seen = []
    const { graph } = build({ modules: [{ id: 'p', type: 'probe' }], cables: [] })
    render(graph, 3)
    graph.setData('p', 'table', Float32Array.from([0.5]))
    const audio = render(graph, 1)
    expect(audio[0]).toBeCloseTo(0.5, 5)
  })

  it('survives a patch edit, because it is not part of the patch', () => {
    // The reason pushed and seeded data are separate layers. Recompiling must not throw away a break somebody
    // loaded, and every structural edit recompiles.
    DataProbeProcessor.seen = []
    const { graph } = build({ modules: [{ id: 'p', type: 'probe' }], cables: [] })
    graph.setData('p', 'table', Float32Array.from([0.6]))
    render(graph, 1)

    graph.setPlan(
      compile({ modules: [{ id: 'p', type: 'probe' }, { id: 'x', type: 'vco' }], cables: [] }, REGISTRY),
    )
    expect(render(graph, 1)[0]).toBeCloseTo(0.6, 5)
  })

  it('lets a push win over what the patch carried', () => {
    DataProbeProcessor.seen = []
    const { graph } = build({
      modules: [{ id: 'p', type: 'probe', data: { table: [0.1] } }],
      cables: [],
    })
    expect(render(graph, 1)[0]).toBeCloseTo(0.1, 5)
    graph.setData('p', 'table', Float32Array.from([0.9]))
    expect(render(graph, 1)[0]).toBeCloseTo(0.9, 5)
  })

  it('is a new array when it changes, so identity is enough to notice', () => {
    // The whole change-detection protocol, and deliberately that crude: nothing subscribes to anything.
    DataProbeProcessor.seen = []
    const { graph } = build({ modules: [{ id: 'p', type: 'probe' }], cables: [] })
    graph.setData('p', 'table', Float32Array.from([1]))
    render(graph, 2)
    const first = DataProbeProcessor.seen[0]
    expect(DataProbeProcessor.seen[1]).toBe(first)

    graph.setData('p', 'table', Float32Array.from([2]))
    render(graph, 1)
    expect(DataProbeProcessor.seen[2]).not.toBe(first)
  })

  it('keeps data through the patch format', async () => {
    const { decodePatch, encodePatch } = await import('./patch-io.js')
    const patch: Patch = {
      modules: [{ id: 'p', type: 'probe', data: { pattern: [1, 0, 2, 0], pitch: [0, 7, 12] } }],
      cables: [],
    }
    expect(decodePatch(encodePatch(patch))).toEqual(patch)
  })

  it('drops data it cannot read rather than guessing at it', async () => {
    const { decodePatch } = await import('./patch-io.js')
    const back = decodePatch(
      JSON.stringify({
        modules: [
          { id: 'p', type: 'probe', data: { good: [1, 2], notArray: 7, holes: [1, null, 3], text: ['a'] } },
        ],
        cables: [],
      }),
    )
    // A partly-numeric array is refused whole: half a pattern is worse than none, because it would play.
    expect(back?.modules[0].data).toEqual({ good: [1, 2] })
  })
})

describe('a chopped break, end to end', () => {
  // Transport, module data and the sampler together — the three things phase A and B exist to make possible.
  // Everything here has its own tests; what this checks is that they agree with each other, which is where the
  // conventions between modules actually get exercised.

  /** A stand-in break: sixteen slices, each a short burst at its own amplitude, so a slice is identifiable. */
  function fakeBreak(perSlice: number): Float32Array {
    const out = new Float32Array(perSlice * 16)
    for (let slice = 0; slice < 16; slice++) {
      // A decaying burst at the top of each slice, amplitude rising with the index.
      const level = (slice + 1) / 16
      for (let i = 0; i < Math.floor(perSlice / 4); i++) {
        out[slice * perSlice + i] = level * Math.exp(-i / (perSlice / 16)) * (i % 2 ? 1 : -1)
      }
    }
    return out
  }

  const patch: Patch = {
    tempo: 174,
    modules: [
      { id: 't', type: 'transport' },
      { id: 's', type: 'sampler', params: { slices: 16, slice: 0 } },
      { id: 'out', type: 'out', params: { level: 1 } },
    ],
    cables: [
      // A sixteenth trigger into the sampler is the chop: one slice per sixteenth, which only lines up because
      // the break was rendered at this tempo.
      { from: ['t', 'sixteenth'], to: ['s', 'trig'] },
      { from: ['s', 'out'], to: ['out', 'in'] },
    ],
  }

  it('is silent until a break is loaded, then plays', () => {
    const { graph } = build(patch, MODULES)
    graph.setTransport(174, true)

    let sum = 0
    for (const x of render(graph, 40)) sum += Math.abs(x)
    expect(sum).toBe(0)

    graph.setData('s', 'sample', fakeBreak(Math.round((44100 * 60 * 4) / 174 / 16)))
    let after = 0
    for (const x of render(graph, 40)) after += Math.abs(x)
    expect(after).toBeGreaterThan(0)
  })

  it('advances one slice per sixteenth when the slice CV comes from the transport bar', () => {
    // The bar ramp runs 0 to 1 across the bar and the slice inlet takes 0..1 across the whole set, so patching
    // one into the other steps through the break in order — which is what "play the break normally" is, built
    // out of two modules that know nothing about each other.
    const stepping: Patch = {
      ...patch,
      cables: [...patch.cables, { from: ['t', 'bar'], to: ['s', 'slice'] }],
    }
    const perSlice = Math.round((44100 * 60 * 4) / 174 / 16)
    const { graph } = build(stepping, MODULES)
    graph.setData('s', 'sample', fakeBreak(perSlice))
    graph.setTransport(174, true)

    // A bar's worth. Each slice's burst has a distinct amplitude, so the peak of each sixteenth says which slice
    // played — and they should climb, because the fake break's slices do.
    const audio = render(graph, Math.ceil((perSlice * 16) / FRAMES))
    const peakOf = (slice: number) => {
      let peak = 0
      for (let i = slice * perSlice; i < (slice + 1) * perSlice && i < audio.length; i++) {
        peak = Math.max(peak, Math.abs(audio[i]))
      }
      return peak
    }
    // Later slices are louder in the fake break, so the sequence has to be increasing rather than all the same —
    // all the same would mean the slice CV was being ignored and slice 0 played sixteen times.
    expect(peakOf(12)).toBeGreaterThan(peakOf(2))
    expect(peakOf(8)).toBeGreaterThan(peakOf(1))
  })

  it('keeps the break through a patch edit', () => {
    // The two-layer data split, exercised the way it will actually be hit: somebody loads a break and then moves
    // a cable. Losing it there would be indefensible.
    const perSlice = Math.round((44100 * 60 * 4) / 174 / 16)
    const { graph } = build(patch, MODULES)
    graph.setData('s', 'sample', fakeBreak(perSlice))
    graph.setTransport(174, true)
    render(graph, 20)

    graph.setPlan(
      compile({ ...patch, modules: [...patch.modules, { id: 'extra', type: 'vco' }] }, MODULES),
    )
    let after = 0
    for (const x of render(graph, 40)) after += Math.abs(x)
    expect(after).toBeGreaterThan(0)
  })

  it('stays finite with the break pitched down and looping', () => {
    // The sound of the genre, and the setting most likely to walk the read pointer off the end of the buffer.
    const perSlice = Math.round((44100 * 60 * 4) / 174 / 16)
    const pitched: Patch = {
      ...patch,
      modules: patch.modules.map((m) =>
        m.id === 's' ? { ...m, params: { slices: 16, slice: 0, loop: 1 } } : m,
      ),
      cables: [...patch.cables, { from: ['t', 'run'], to: ['s', 'pitch'] }],
    }
    const { graph } = build(pitched, MODULES)
    graph.setData('s', 'sample', fakeBreak(perSlice))
    graph.setTransport(174, true)
    const audio = render(graph, 200)
    for (let i = 0; i < audio.length; i++) expect(Number.isFinite(audio[i])).toBe(true)
  })
})
