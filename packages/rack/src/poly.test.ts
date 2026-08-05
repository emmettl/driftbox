import { describe, expect, it } from 'vitest'
import { compile } from './compile.js'
import { Random } from './dsp/random.js'
import { Graph } from './graph.js'
import { MODULES } from './modules/index.js'
import type { ModuleDef, Patch, Processor, ProcessorVoice, Registry, Transport } from './types.js'

// Polyphony, which is entirely a property of the compiler and the Graph — no module changed to get it.
//
// The four cases from the table at the top of `graph.ts` are what these tests exist for. Three of them are
// easy to get right by accident and one of them, the collapse, is easy to get wrong in a way that only shows
// up as "the delay is quieter than it should be" long after anybody would connect it to this code.

const SR = 44100
const FRAMES = 128

/** A module that writes its `value` param, so a voice can be identified by what came out of it. */
class MarkProcessor implements Processor {
  process(
    _inlets: Float32Array[],
    outlets: Float32Array[],
    params: Float32Array[],
    frames: number,
  ): void {
    for (let i = 0; i < frames; i++) outlets[0][i] = params[0][i]
  }
}

/** Passes its inlet through, so a chain can be built out of them. */
class ThroughProcessor implements Processor {
  process(
    inlets: Float32Array[],
    outlets: Float32Array[],
    _params: Float32Array[],
    frames: number,
  ): void {
    for (let i = 0; i < frames; i++) outlets[0][i] = inlets[0][i]
  }
}

/** Records what it saw on its inlet, for asserting on the collapse. */
class SinkProcessor implements Processor {
  static seen: number[] = []
  process(
    inlets: Float32Array[],
    outlets: Float32Array[],
    _params: Float32Array[],
    frames: number,
  ): void {
    SinkProcessor.seen.push(inlets[0][0])
    for (let i = 0; i < frames; i++) outlets[0][i] = inlets[0][i]
  }
}

/** Records the ordinary collapse and the independent view a mono voice collector receives beside it. */
class CollectProcessor implements Processor {
  static collapsed: number[] = []
  static voices: number[][] = []

  process(
    inlets: Float32Array[],
    outlets: Float32Array[],
    _params: Float32Array[],
    frames: number,
    _transport?: Transport,
    _hostInputs?: Float32Array[][],
    voiceInlets?: Float32Array[][],
  ): void {
    CollectProcessor.collapsed.push(inlets[0][0])
    CollectProcessor.voices.push((voiceInlets?.[0] ?? []).map((voice) => voice[0]))
    for (let i = 0; i < frames; i++) outlets[0][i] = inlets[0][i]
  }
}

/** Adds a small lane mark so an expanded voice is measurable after ordinary downstream modules. */
class ExpandProcessor implements Processor {
  private readonly lane: number

  constructor(
    _sampleRate: number,
    _deps: Record<string, unknown>,
    _id: string,
    _data: unknown,
    voice?: ProcessorVoice,
  ) {
    this.lane = voice?.lane ?? 0
  }

  process(
    inlets: Float32Array[],
    outlets: Float32Array[],
    _params: Float32Array[],
    frames: number,
  ): void {
    for (let i = 0; i < frames; i++) outlets[0][i] = inlets[0][i] + this.lane * 0.01
  }
}

const def = (over: Partial<ModuleDef> & { type: string }): ModuleDef => ({
  version: 1,
  name: over.type,
  inlets: [{ id: 'in', name: 'In' }],
  outlets: [{ id: 'out', name: 'Out' }],
  params: [],
  processor: ThroughProcessor,
  ...over,
})

const REGISTRY: Registry = {
  ...MODULES,
  mark: def({
    type: 'mark',
    inlets: [],
    params: [{ id: 'value', name: 'Value', min: -8, max: 8, default: 0 }],
    processor: MarkProcessor,
  }),
  thru: def({ type: 'thru' }),
  monothru: def({ type: 'monothru', poly: false }),
  sink: def({ type: 'sink', poly: false, terminal: true, processor: SinkProcessor }),
  collector: def({
    type: 'collector',
    poly: false,
    terminal: true,
    voiceCollector: true,
    processor: CollectProcessor,
  }),
  polyout: def({ type: 'polyout', terminal: true }),
  expand3: def({ type: 'expand3', processor: ExpandProcessor, voiceExpansion: 3 }),
}

function build(patch: Patch, registry: Registry = REGISTRY) {
  const plan = compile(patch, registry)
  const modules: Record<string, ModuleDef['processor']> = {}
  const deps: Record<string, unknown> = { Random }
  for (const entry of Object.values(registry)) {
    modules[entry.type] = entry.processor
    for (const [name, dep] of Object.entries(entry.deps ?? {})) deps[name] = dep
  }
  const graph = new Graph(SR, FRAMES, modules, deps)
  graph.setPlan(plan)
  return { graph, plan }
}

function render(graph: Graph, blocks = 1): Float64Array {
  const channels = [new Float32Array(FRAMES), new Float32Array(FRAMES)]
  const out = new Float64Array(blocks * FRAMES)
  for (let block = 0; block < blocks; block++) {
    graph.process(channels)
    out.set(channels[0], block * FRAMES)
  }
  return out
}

const chain = (voices: number | undefined, modules: [string, string][], cables: [string, string, string, string][]): Patch => ({
  modules: modules.map(([id, type]) => ({ id, type })),
  cables: cables.map(([a, b, c, d]) => ({ from: [a, b], to: [c, d] })),
  ...(voices ? { voices } : {}),
})

describe('what the compiler says about voices', () => {
  it('is one voice for a patch that never mentioned them', () => {
    const plan = compile(chain(undefined, [['a', 'thru']], []), REGISTRY)
    expect(plan.voices).toBe(1)
  })

  it('clamps a voice count nobody should have asked for', () => {
    for (const [asked, got] of [[4, 4], [0, 1], [-3, 1], [900, 8], [2.6, 3]]) {
      expect(compile({ modules: [], cables: [], voices: asked }, REGISTRY).voices).toBe(got)
    }
  })

  it('marks a buffer polyphonic exactly when its writer is', () => {
    const plan = compile(
      chain(4, [['p', 'thru'], ['m', 'monothru']], []),
      REGISTRY,
    )
    const bufferOf = (id: string) => plan.nodes.find((n) => n.id === id)!.outlets[0]
    expect(plan.poly[bufferOf('p')]).toBe(true)
    expect(plan.poly[bufferOf('m')]).toBe(false)
    // The zero buffer belongs to nobody and is read by every unconnected inlet of every voice.
    expect(plan.poly[0]).toBe(false)
  })

  it('tells the Graph which nodes run once', () => {
    const plan = compile(chain(4, [['p', 'thru'], ['m', 'monothru']], []), REGISTRY)
    expect(plan.nodes.find((n) => n.id === 'p')!.poly).toBe(true)
    expect(plan.nodes.find((n) => n.id === 'm')!.poly).toBe(false)
  })

  it('marks the shipped modules that must run once, and nothing else', () => {
    // Transport joined this list: eight transports would agree with each other and cost eight times as much to
    // do it. So did the Combinator, for a sharper version of the same reason — a routing writes a *param*,
    // and `Rack.setParam` already spreads one of those across every voice, so a per-voice Combinator would
    // have nothing different to say. If a new module appears here, it should be because duplicating it would
    // be wrong rather than because nobody thought about it.
    //
    // The Line Mixer is the plainest case on the list and the one worth reading the rule from: a shared desk
    // is the entire point of it, so eight of them would be eight desks each hearing one note. Its neighbour
    // `mixer` is deliberately NOT here, and the contrast is the whole distinction — that one is a summing
    // utility you put *inside* a voice, this one is where voices arrive.
    const mono = Object.values(MODULES).filter((d) => d.poly === false).map((d) => d.type)
    expect(mono.sort()).toEqual([
      'arp', 'arranger', 'audio-input', 'cabinet', 'clock', 'combi', 'delay', 'distortion', 'groovebox', 'imager',
      'limiter', 'line-mixer', 'looper', 'meter', 'out', 'phaser', 'ping-pong', 'reverb', 'seq',
      'tracker', 'transport', 'tuner', 'vocoder',
    ])
  })
})

describe('the four cases', () => {
  // Values are kept small on purpose. The Graph clamps its output to ±4 so that a feedback patch cannot take
  // the tab with it, and the first version of these tests used 1, 2, 3, 4 — every assertion came back as
  // exactly 4 and looked like the summing was broken when it was the safety net doing its job.

  /** Set each voice's copy of a param to a different value, so voices are distinguishable. */
  const spread = (graph: Graph, plan: ReturnType<typeof compile>, id: string, values: number[]) => {
    values.forEach((value, voice) => graph.setParam(plan.slots[id].value, value, voice))
  }

  it('poly to poly: each voice keeps its own signal', () => {
    // The whole point. Four Marks with four different values arrive at four Thrus and stay apart.
    const { graph, plan } = build(
      chain(4, [['m', 'mark'], ['t', 'thru'], ['o', 'polyout']], [
        ['m', 'out', 't', 'in'],
        ['t', 'out', 'o', 'in'],
      ]),
    )
    // Kept under the master limiter's 0.95 threshold, here and below. These values are arbitrary and the
    // claim is about routing, not level — but a sum that trips the limiter is measuring the limiter.
    spread(graph, plan, 'm', [0.08, 0.16, 0.24, 0.32])
    // The output sums every voice of a polyphonic terminal, so 0.08+0.16+0.24+0.32.
    const audio = render(graph, 3)
    expect(audio[audio.length - 1]).toBeCloseTo(0.8, 4)
  })

  it('poly to mono: every voice is summed before the module runs', () => {
    // The collapse, and the one case that is easy to get wrong quietly. A Delay fed by four voices should
    // hear the chord, not one note of it and not four separate delays.
    SinkProcessor.seen = []
    const { graph, plan } = build(
      chain(4, [['m', 'mark'], ['s', 'sink']], [['m', 'out', 's', 'in']]),
    )
    spread(graph, plan, 'm', [0.1, 0.2, 0.3, 0.4])
    render(graph, 3)

    // One instance, so one call per block — not four.
    expect(SinkProcessor.seen.length).toBe(3)
    expect(SinkProcessor.seen[2]).toBeCloseTo(1, 4)
  })

  it('poly to collector: one mono processor also sees every independent voice', () => {
    CollectProcessor.collapsed = []
    CollectProcessor.voices = []
    const { graph, plan } = build(
      chain(4, [['m', 'mark'], ['c', 'collector']], [['m', 'out', 'c', 'in']]),
    )
    spread(graph, plan, 'm', [0.1, 0.2, 0.3, 0.4])
    render(graph, 3)

    expect(plan.nodes.find((node) => node.id === 'c')?.collectVoices).toBe(true)
    expect(CollectProcessor.collapsed[2]).toBeCloseTo(1, 4)
    expect(CollectProcessor.voices[2]).toEqual([
      expect.closeTo(0.1, 4),
      expect.closeTo(0.2, 4),
      expect.closeTo(0.3, 4),
      expect.closeTo(0.4, 4),
    ])
  })

  it('applies an inlet trim to every collected voice as well as the collapse', () => {
    CollectProcessor.collapsed = []
    CollectProcessor.voices = []
    const patch: Patch = {
      voices: 2,
      modules: [
        { id: 'm', type: 'mark' },
        { id: 'c', type: 'collector', inputTrims: { in: 0.5 } },
      ],
      cables: [{ from: ['m', 'out'], to: ['c', 'in'] }],
    }
    const { graph, plan } = build(patch)
    spread(graph, plan, 'm', [0.2, 0.4])
    render(graph, 3)

    expect(CollectProcessor.collapsed[2]).toBeCloseTo(0.3, 4)
    expect(CollectProcessor.voices[2]).toEqual([expect.closeTo(0.1, 4), expect.closeTo(0.2, 4)])
  })

  it('mono to poly: every voice reads the same buffer', () => {
    // A clock, a shared LFO, one sequence. Four voices must all see it, not just voice zero.
    const { graph, plan } = build(
      chain(4, [['m', 'mark'], ['one', 'monothru'], ['t', 'thru'], ['o', 'polyout']], [
        ['m', 'out', 'one', 'in'],
        ['one', 'out', 't', 'in'],
        ['t', 'out', 'o', 'in'],
      ]),
    )
    // Mark is polyphonic, so this sets four different values which the mono module sums to 0.2; every voice
    // of the Thru then reads that same 0.2, and the polyphonic output sums four of them.
    spread(graph, plan, 'm', [0.02, 0.04, 0.06, 0.08])
    const audio = render(graph, 3)
    expect(audio[audio.length - 1]).toBeCloseTo(0.8, 3)
  })

  it('mono to mono: one buffer, one instance, no summing', () => {
    SinkProcessor.seen = []
    const { graph, plan } = build(
      chain(4, [['m', 'mark'], ['one', 'monothru'], ['s', 'sink']], [
        ['m', 'out', 'one', 'in'],
        ['one', 'out', 's', 'in'],
      ]),
    )
    spread(graph, plan, 'm', [0.1, 0.2, 0.3, 0.4])
    render(graph, 3)
    expect(SinkProcessor.seen.length).toBe(3)
    expect(SinkProcessor.seen[2]).toBeCloseTo(1, 4)
  })
})

describe('variable-width voice streams', () => {
  it('compiles an expander and carries its width through ordinary polyphonic modules', () => {
    const plan = compile(
      chain(2, [['m', 'mark'], ['x', 'expand3'], ['t', 'thru']], [
        ['m', 'out', 'x', 'in'],
        ['x', 'out', 't', 'in'],
      ]),
      REGISTRY,
    )
    const x = plan.nodes.find((node) => node.id === 'x')!
    const t = plan.nodes.find((node) => node.id === 't')!
    expect(x.voices).toBe(6)
    expect(x.voiceLanes).toBe(3)
    expect(t.voices).toBe(6)
    expect(plan.voiceWidths?.[x.outlets[0]]).toBe(6)
    expect(plan.voiceWidths?.[t.outlets[0]]).toBe(6)
  })

  it('fans every input voice into measurable child lanes through a real graph', () => {
    const { graph, plan } = build(
      chain(2, [['m', 'mark'], ['x', 'expand3'], ['t', 'thru'], ['o', 'polyout']], [
        ['m', 'out', 'x', 'in'],
        ['x', 'out', 't', 'in'],
        ['t', 'out', 'o', 'in'],
      ]),
    )
    graph.setParam(plan.slots.m.value, 0.01, 0)
    graph.setParam(plan.slots.m.value, 0.02, 1)
    const audio = render(graph, 3)
    // 0.01+0.02+0.03 from source voice zero, then 0.02+0.03+0.04 from source voice one.
    expect(audio[audio.length - 1]).toBeCloseTo(0.15, 4)
  })

  it('collapses every expanded child before a shared module', () => {
    SinkProcessor.seen = []
    const { graph, plan } = build(
      chain(2, [['m', 'mark'], ['x', 'expand3'], ['s', 'sink']], [
        ['m', 'out', 'x', 'in'],
        ['x', 'out', 's', 'in'],
      ]),
    )
    graph.setParam(plan.slots.m.value, 0.01, 0)
    graph.setParam(plan.slots.m.value, 0.02, 1)
    render(graph, 3)
    expect(SinkProcessor.seen[2]).toBeCloseTo(0.15, 4)
  })

  it('bounds stacked expanders without allocating a partial chord', () => {
    const plan = compile(
      chain(8, [['a', 'expand3'], ['b', 'expand3']], [['a', 'out', 'b', 'in']]),
      REGISTRY,
    )
    expect(plan.nodes.find((node) => node.id === 'a')?.voices).toBe(24)
    expect(plan.nodes.find((node) => node.id === 'b')?.voices).toBe(24)
    expect(plan.nodes.find((node) => node.id === 'b')?.voiceLanes).toBe(1)
    expect(plan.notes.some((note) => note.kind === 'voice-cap' && note.module === 'b')).toBe(true)
  })
})

describe('params across voices', () => {
  it('sets every voice when no voice is named, which is what a knob means', () => {
    const { graph, plan } = build(
      chain(4, [['m', 'mark'], ['o', 'polyout']], [['m', 'out', 'o', 'in']]),
    )
    graph.setParam(plan.slots.m.value, 0.2)
    const audio = render(graph, 3)
    expect(audio[audio.length - 1]).toBeCloseTo(0.8, 4)
  })

  it('sets one voice when one is named, which is what a keyboard means', () => {
    const { graph, plan } = build(
      chain(4, [['m', 'mark'], ['o', 'polyout']], [['m', 'out', 'o', 'in']]),
    )
    graph.setParam(plan.slots.m.value, 0.8, 2)
    const audio = render(graph, 3)
    // One voice at 0.8, three at the default of 0.
    expect(audio[audio.length - 1]).toBeCloseTo(0.8, 4)
  })

  it('ignores a voice that does not exist rather than writing the wrong one', () => {
    const { graph, plan } = build(
      chain(2, [['m', 'mark'], ['o', 'polyout']], [['m', 'out', 'o', 'in']]),
    )
    graph.setParam(plan.slots.m.value, 0.8, 7)
    graph.setParam(plan.slots.m.value, 0.8, -1)
    expect(render(graph, 3)[FRAMES * 3 - 1]).toBeCloseTo(0, 4)
  })

  it('gives a mono module voice zero’s value', () => {
    // Its knob is set for every voice, so which one it reads only matters if they differ — and they only
    // differ when something like MIDI has written one. A mono module has no voice of its own to prefer.
    SinkProcessor.seen = []
    const { graph, plan } = build(
      chain(4, [['m', 'mark'], ['s', 'sink']], [['m', 'out', 's', 'in']]),
    )
    graph.setParam(plan.slots.m.value, 0.25)
    render(graph, 3)
    expect(SinkProcessor.seen[2]).toBeCloseTo(1, 4)
  })
})

describe('a polyphonic patch of real modules', () => {
  const patch = (voices: number): Patch => ({
    voices,
    modules: [
      { id: 'midi-1', type: 'midi' },
      { id: 'vco-1', type: 'vco', params: { tune: 0 } },
      { id: 'vca-1', type: 'vca', params: { gain: 0.2 } },
      { id: 'out-1', type: 'out', params: { level: 0.5 } },
    ],
    cables: [
      { from: ['midi-1', 'pitch'], to: ['vco-1', 'pitch'] },
      { from: ['vco-1', 'out'], to: ['vca-1', 'in'] },
      { from: ['vca-1', 'out'], to: ['out-1', 'in'] },
    ],
  })

  it('plays a chord: three voices at three pitches', () => {
    const { graph, plan } = build(patch(3), MODULES)
    // A major triad, one note per voice — the thing a monophonic rack could not do.
    ;[36, 40, 43].forEach((note, voice) => {
      graph.setParam(plan.slots['midi-1'].note, note, voice)
    })
    const audio = render(graph, Math.ceil(SR / FRAMES))

    const magnitudeAt = (frequency: number) => {
      let re = 0
      let im = 0
      for (let i = 0; i < audio.length; i++) {
        const phase = (2 * Math.PI * frequency * i) / SR
        re += audio[i] * Math.cos(phase)
        im += audio[i] * Math.sin(phase)
      }
      return (2 * Math.hypot(re, im)) / audio.length
    }
    // C2, E2 and G2 all present, and the tritone that is in none of them is not.
    const c = magnitudeAt(65.41)
    const e = magnitudeAt(82.41)
    const g = magnitudeAt(98.0)
    const tritone = magnitudeAt(92.5)
    for (const [name, level] of [['C', c], ['E', e], ['G', g]] as const) {
      expect(level, name).toBeGreaterThan(0.02)
    }
    expect(tritone).toBeLessThan(Math.min(c, e, g) / 4)
  })

  it('sounds identical to the monophonic version at one voice', () => {
    // The property that made this change safe: voice zero keeps the plain module id, and a mono buffer
    // behaves exactly as the single buffer did before polyphony existed.
    const withCount = build(patch(1), MODULES)
    const without = build({ ...patch(1), voices: undefined }, MODULES)
    withCount.graph.setParam(withCount.plan.slots['midi-1'].note, 48)
    without.graph.setParam(without.plan.slots['midi-1'].note, 48)
    expect([...render(withCount.graph, 4)]).toEqual([...render(without.graph, 4)])
  })

  it('gives each voice its own noise rather than one copy amplified', () => {
    // The seeding problem one level up. Eight voices of identical noise sum to one source 18dB louder, which
    // is audibly wrong and reads as a gain bug — so later voices get a suffixed id.
    const noise = (voices: number): Patch => ({
      voices,
      modules: [
        { id: 'noise-1', type: 'noise' },
        // Quiet enough that four voices of it stay under the master limiter. At level 1 the four-voice sum
        // was riding the limiter and the ratio came back as 1.18 — which measures the limiter working, not
        // the seeding, and would have gone on "passing" as a seeding test long after it stopped being one.
        { id: 'out-1', type: 'out', params: { level: 0.2 } },
      ],
      cables: [{ from: ['noise-1', 'white'], to: ['out-1', 'in'] }],
    })
    const rms = (d: Float64Array) => Math.sqrt(d.reduce((s, x) => s + x * x, 0) / d.length)

    const one = rms(render(build(noise(1), MODULES).graph, 8))
    const four = rms(render(build(noise(4), MODULES).graph, 8))
    // Four uncorrelated sources are twice as loud, not four times.
    expect(four / one).toBeGreaterThan(1.7)
    expect(four / one).toBeLessThan(2.4)
  })
})

describe('the patch format', () => {
  it('keeps a voice count through a round trip', async () => {
    const { decodePatch, encodePatch } = await import('./patch-io.js')
    const patch: Patch = { modules: [{ id: 'a', type: 'vco' }], cables: [], voices: 4 }
    expect(decodePatch(encodePatch(patch))).toEqual(patch)
  })

  it('leaves a monophonic patch without one, so an old patch is unchanged', async () => {
    const { decodePatch, encodePatch } = await import('./patch-io.js')
    const patch: Patch = { modules: [{ id: 'a', type: 'vco' }], cables: [] }
    const back = decodePatch(encodePatch(patch))
    expect(back).toEqual(patch)
    expect('voices' in back!).toBe(false)
  })

  it('drops a voice count that is not one', async () => {
    const { decodePatch } = await import('./patch-io.js')
    for (const voices of [0, -1, 2.5, 99, 'four', null]) {
      const back = decodePatch(JSON.stringify({ modules: [{ id: 'a', type: 'vco' }], cables: [], voices }))
      expect(back?.voices, String(voices)).toBeUndefined()
    }
  })
})
