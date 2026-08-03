import { Ladder } from '@driftbox/engine'
import { describe, expect, it } from 'vitest'
import { compile } from './compile.js'
import { Graph } from './graph.js'
import { MODULES } from './modules/index.js'
import { LADDER_MODULE } from './modules/ladder.js'
import type { Patch, Registry } from './types.js'
import { RACK_PROCESSOR, rackSource } from './worklet.js'

// The assembled worklet source is the artefact that either works or does not, and the failure
// mode for getting it wrong is a ReferenceError on the audio thread the first time somebody
// loads a patch — which is a browser away from anywhere a test normally looks.
//
// So it is checked here by evaluating it. `new Function` gives the source a scope of its own
// with nothing of this module in it, which is exactly the deal an AudioWorkletGlobalScope
// offers. Every class the rack serialises passes through this.

const SR = 44100
const FRAMES = 128

const PATCH: Patch = {
  modules: [
    { id: 'osc', type: 'vco', params: { tune: 12 } },
    { id: 'filter', type: 'ladder', params: { cutoff: 1200, resonance: 0.6 } },
    { id: 'out', type: 'out' },
  ],
  cables: [
    { from: ['osc', 'out'], to: ['filter', 'in'] },
    { from: ['filter', 'out'], to: ['out', 'in'] },
  ],
}

interface Instance {
  process(inputs: unknown[], outputs: Float32Array[][]): boolean
  port: { onmessage: ((event: { data: unknown }) => void) | null; postMessage(message: unknown): void }
}

/** Evaluate the assembled source the way the browser would, and hand back the processor it
 *  registered along with everything it posted back to the host. */
function instantiate(registry: Registry): { instance: Instance; posted: unknown[] } {
  const posted: unknown[] = []

  class FakeAudioWorkletProcessor {
    port = {
      onmessage: null as ((event: { data: unknown }) => void) | null,
      postMessage: (message: unknown) => {
        posted.push(message)
      },
    }
  }

  const registered = new Map<string, new () => Instance>()
  // `currentFrame` is a live global in an AudioWorkletGlobalScope — it is a different number every block,
  // not something bound once when the scope is created. So it goes on `globalThis`, which a bare identifier
  // in the assembled source resolves to through the scope chain, and `render` advances it per block. Passing
  // it as a `new Function` argument would freeze it at zero, and every scheduling test would then pass by
  // measuring a clock that never moved.
  const evaluate = new Function(
    'AudioWorkletProcessor',
    'registerProcessor',
    'sampleRate',
    rackSource(registry),
  )
  evaluate(
    FakeAudioWorkletProcessor,
    (name: string, Constructor: new () => Instance) => registered.set(name, Constructor),
    SR,
  )

  const Processor = registered.get(RACK_PROCESSOR)
  expect(Processor).toBeDefined()
  return { instance: new Processor!(), posted }
}

/** The first index where `ok` fails, or −1. Reads better in a failure than a bare boolean. */
function firstBad(data: ArrayLike<number>, ok: (x: number) => boolean): number {
  for (let i = 0; i < data.length; i++) if (!ok(data[i])) return i
  return -1
}

/** The audio thread's clock, as the assembled source sees it. Reset per render so blocks line up with frames. */
declare global {
  // eslint-disable-next-line no-var
  var currentFrame: number
}

function render(
  instance: Instance,
  blocks: number,
  inputs: Float32Array[][] = [],
): Float64Array {
  const out = new Float64Array(blocks * FRAMES)
  for (let block = 0; block < blocks; block++) {
    globalThis.currentFrame = block * FRAMES
    const channels = [new Float32Array(FRAMES), new Float32Array(FRAMES)]
    expect(instance.process(inputs, [channels])).toBe(true)
    out.set(channels[0], block * FRAMES)
  }
  return out
}

/** The same patch, run by a Graph in this scope — the answer the worklet has to match. */
function locally(patch: Patch, registry: Registry, blocks: number): Float64Array {
  const modules: Record<string, Registry[string]['processor']> = {}
  const deps: Record<string, unknown> = {}
  for (const def of Object.values(registry)) {
    modules[def.type] = def.processor
    for (const [name, dep] of Object.entries(def.deps ?? {})) deps[name] = dep
  }
  const graph = new Graph(SR, FRAMES, modules, deps)
  graph.setPlan(compile(patch, registry))

  const out = new Float64Array(blocks * FRAMES)
  const channels = [new Float32Array(FRAMES), new Float32Array(FRAMES)]
  for (let block = 0; block < blocks; block++) {
    graph.process(channels)
    out.set(channels[0], block * FRAMES)
  }
  return out
}

function rms(data: Float64Array): number {
  let sum = 0
  for (let i = 0; i < data.length; i++) sum += data[i] * data[i]
  return Math.sqrt(sum / data.length)
}

describe('the assembled worklet', () => {
  it('registers a processor and plays a patch', () => {
    const { instance } = instantiate(MODULES)
    // Silent until it has a plan. An AudioWorkletNode starts pulling immediately, before any
    // message can have arrived, so this is the first block the browser ever asks for.
    expect(rms(render(instance, 2))).toBe(0)

    instance.port.onmessage?.({ data: { kind: 'plan', plan: compile(PATCH, MODULES) } })
    expect(rms(render(instance, 8))).toBeGreaterThan(0.05)
  })

  it('produces exactly what the same graph produces in this scope', () => {
    // The strongest form of the claim `worklet.ts` makes: the audio thread runs THAT code,
    // not a second copy of it that can drift. Sample for sample, not approximately.
    const { instance } = instantiate(MODULES)
    instance.port.onmessage?.({ data: { kind: 'plan', plan: compile(PATCH, MODULES) } })

    const fromWorklet = render(instance, 16)
    const fromHere = locally(PATCH, MODULES, 16)
    expect([...fromWorklet]).toEqual([...fromHere])
    expect(rms(fromHere)).toBeGreaterThan(0.05)
  })

  it('turns a host input into an ordinary patchable groovebox outlet', () => {
    const patch: Patch = {
      modules: [
        { id: 'song', type: 'groovebox' },
        { id: 'out', type: 'out', params: { level: 1 } },
      ],
      cables: [{ from: ['song', 'tr808-l'], to: ['out', 'in'] }],
    }
    const { instance } = instantiate(MODULES)
    instance.port.onmessage?.({ data: { kind: 'plan', plan: compile(patch, MODULES) } })
    const left = new Float32Array(FRAMES).fill(0.25)
    const right = new Float32Array(FRAMES).fill(0.5)

    expect([...render(instance, 1, [[left, right]])]).toEqual(
      new Array(FRAMES).fill(0.25),
    )
  })

  it('turns the fifth host bus into the patchable live input', () => {
    const patch: Patch = {
      modules: [
        { id: 'live', type: 'audio-input', params: { level: 2, channel: 1 } },
        { id: 'out', type: 'out', params: { level: 1 } },
      ],
      cables: [{ from: ['live', 'out'], to: ['out', 'in'] }],
    }
    const { instance } = instantiate(MODULES)
    instance.port.onmessage?.({ data: { kind: 'plan', plan: compile(patch, MODULES) } })
    const inputs = Array.from({ length: 5 }, () => [] as Float32Array[])
    inputs[4] = [
      new Float32Array(FRAMES).fill(0.1),
      new Float32Array(FRAMES).fill(0.25),
    ]

    expect([...render(instance, 1, inputs)]).toEqual(new Array(FRAMES).fill(0.5))
  })

  it('carries the ladder across without the ladder knowing its own name', () => {
    // This is the minifier hazard, reproduced. A bundler may rename a class, its binding, or
    // both, and if the module body referenced `Ladder` by identifier the two halves could
    // disagree and the worklet would throw at the first note. Dependencies go through
    // `deps.Ladder` — a string key, which a minifier does not touch — so a class with a
    // completely different name has to work identically.
    const Mangled = new Function(
      `"use strict"; return ${Ladder.toString().replace(/^class\s+\w+/, 'class q')}`,
    )() as typeof Ladder
    expect(Mangled.name).toBe('q')

    const registry: Registry = {
      ...MODULES,
      ladder: { ...LADDER_MODULE, deps: { Ladder: Mangled } },
    }
    const { instance } = instantiate(registry)
    instance.port.onmessage?.({ data: { kind: 'plan', plan: compile(PATCH, registry) } })

    expect([...render(instance, 16)]).toEqual([...locally(PATCH, MODULES, 16)])
  })

  it('moves a knob from a message', () => {
    const { instance } = instantiate(MODULES)
    const plan = compile(PATCH, MODULES)
    instance.port.onmessage?.({ data: { kind: 'plan', plan } })
    render(instance, 4)

    instance.port.onmessage?.({ data: { kind: 'param', slot: plan.slots.out.level, value: 0 } })
    // One block to ramp down, then silence.
    render(instance, 1)
    expect(rms(render(instance, 4))).toBe(0)
  })

  it('reports meter modules only while a host is listening', () => {
    const patch: Patch = {
      modules: [
        { id: 'osc', type: 'vco' },
        { id: 'meter', type: 'meter' },
        { id: 'out', type: 'out', params: { level: 1 } },
      ],
      cables: [
        { from: ['osc', 'out'], to: ['meter', 'in'] },
        { from: ['meter', 'thru'], to: ['out', 'in'] },
      ],
    }
    const { instance, posted } = instantiate(MODULES)
    instance.port.onmessage?.({ data: { kind: 'plan', plan: compile(patch, MODULES) } })

    render(instance, 8)
    expect(posted).toEqual([])

    instance.port.onmessage?.({ data: { kind: 'monitor', enabled: true } })
    render(instance, 8)
    expect(posted).toHaveLength(1)
    expect(posted[0]).toMatchObject({
      kind: 'meters',
      readings: [{ id: 'meter' }],
    })

    instance.port.onmessage?.({ data: { kind: 'monitor', enabled: false } })
    render(instance, 8)
    expect(posted).toHaveLength(1)
  })

  it('reports all four hosted groovebox strips without hidden meter modules', () => {
    const patch: Patch = {
      modules: [{ id: 'song', type: 'groovebox' }],
      cables: [],
    }
    const inputs = Array.from({ length: 4 }, (_, section) => [
      new Float32Array(FRAMES).fill((section + 1) * 0.1),
      new Float32Array(FRAMES).fill((section + 1) * 0.1),
    ])
    const { instance, posted } = instantiate(MODULES)
    instance.port.onmessage?.({ data: { kind: 'plan', plan: compile(patch, MODULES) } })
    instance.port.onmessage?.({ data: { kind: 'monitor', enabled: true } })

    render(instance, 8, inputs)

    expect(posted).toHaveLength(1)
    expect(posted[0]).toMatchObject({
      kind: 'meters',
      readings: [
        { id: 'song:tr808' },
        { id: 'song:tr909' },
        { id: 'song:303.a' },
        { id: 'song:303.b' },
      ],
    })
  })

  it('ignores a message it does not understand', () => {
    // The port is reachable from anywhere with a handle on the node. A message from a future
    // build, or from nothing at all, must not take the audio thread down.
    const { instance } = instantiate(MODULES)
    for (const data of [null, undefined, {}, { kind: 'nonsense' }, { kind: 'param' }, 7]) {
      expect(() => instance.port.onmessage?.({ data })).not.toThrow()
    }
    expect(rms(render(instance, 2))).toBe(0)
  })

  it('says so when it was built from a different module set', () => {
    const { instance, posted } = instantiate({ out: MODULES.out })
    instance.port.onmessage?.({ data: { kind: 'plan', plan: compile(PATCH, MODULES) } })

    expect(posted).toEqual([{ kind: 'missing', types: ['vco', 'ladder'] }])
  })

  it('refuses to assemble modules that disagree about a dependency', () => {
    // A developer error, and a silent one if it were allowed: one of the two modules would
    // get the wrong DSP class and there would be nothing to see but a wrong sound.
    const registry: Registry = {
      ...MODULES,
      other: { ...LADDER_MODULE, type: 'other', deps: { Ladder: class Impostor {} } },
    }
    expect(() => rackSource(registry)).toThrow(/disagree/)
  })
})

describe('the transport and bulk data across the message boundary', () => {
  // Both are new message kinds, and the worklet is where a message shape mistake actually bites — the host and
  // the audio thread agree by convention only.

  const TICKING: Patch = {
    modules: [
      { id: 't', type: 'transport' },
      { id: 'out', type: 'out', params: { level: 1 } },
    ],
    cables: [{ from: ['t', 'sixteenth'], to: ['out', 'in'] }],
  }

  it('does not run until told to, then does', () => {
    const { instance } = instantiate(MODULES)
    instance.port.onmessage?.({ data: { kind: 'plan', plan: compile(TICKING, MODULES) } })
    // The plan alone is not a transport: a patch that started playing the moment it compiled would start
    // playing every time it was edited.
    expect(rms(render(instance, 8))).toBe(0)

    instance.port.onmessage?.({ data: { kind: 'transport', tempo: 174, running: true } })
    expect(rms(render(instance, 8))).toBeGreaterThan(0)
  })

  it('stops when told to stop', () => {
    const { instance } = instantiate(MODULES)
    instance.port.onmessage?.({ data: { kind: 'plan', plan: compile(TICKING, MODULES) } })
    instance.port.onmessage?.({ data: { kind: 'transport', tempo: 174, running: true } })
    render(instance, 8)
    instance.port.onmessage?.({ data: { kind: 'transport', tempo: 174, running: false } })
    expect(rms(render(instance, 40))).toBe(0)
  })

  it('carries a scheduled frame all the way to the graph', () => {
    // The one claim only this harness can make. `frame` is an optional field on a message the host and the
    // audio thread agree about by convention, so a typo in either half is silent — the change would simply
    // land at the block boundary, which is what it did before the field existed and looks like nothing at
    // all going wrong. Checked by asking for a frame partway through the second block and reading the seam.
    // An Offset with nothing patched in is a DC source — `in * gain + offset` at silence is the knob — so
    // moving its knob is a signal you can point at, and the seam is visible in the samples.
    const PATCH: Patch = {
      modules: [
        { id: 'o', type: 'offset' },
        { id: 'out', type: 'out', params: { level: 1 } },
      ],
      cables: [{ from: ['o', 'out'], to: ['out', 'in'] }],
    }
    const plan = compile(PATCH, MODULES)
    const { instance } = instantiate(MODULES)
    instance.port.onmessage?.({ data: { kind: 'plan', plan } })

    instance.port.onmessage?.({
      data: { kind: 'param', slot: plan.slots.o.offset, value: 0.5, frame: FRAMES + 64 },
    })
    const audio = render(instance, 2)

    // Silent right up to the frame asked for, and moved by the end of that block. Drop the field on either
    // side of the boundary and the change lands at sample 0 of block 0 instead, which this catches.
    expect(firstBad(audio.subarray(0, FRAMES + 64), (x) => x === 0)).toBe(-1)
    expect(audio[2 * FRAMES - 1]).toBeGreaterThan(0.4)
  })

  it('accepts bulk data for a module', () => {
    // No module uses data yet — the sampler is phase B — so this checks the message is understood and does not
    // throw, which is what would break the moment one does.
    const { instance } = instantiate(MODULES)
    instance.port.onmessage?.({ data: { kind: 'plan', plan: compile(TICKING, MODULES) } })
    expect(() =>
      instance.port.onmessage?.({
        data: { kind: 'data', module: 't', slot: 'table', data: Float32Array.from([1, 2, 3]) },
      }),
    ).not.toThrow()
    instance.port.onmessage?.({ data: { kind: 'transport', tempo: 174, running: true } })
    expect(rms(render(instance, 8))).toBeGreaterThan(0)
  })

  it('still ignores a message it does not understand', () => {
    const { instance } = instantiate(MODULES)
    for (const data of [{ kind: 'transport' }, { kind: 'data' }, { kind: 'data', module: 't' }]) {
      expect(() => instance.port.onmessage?.({ data })).not.toThrow()
    }
  })
})
