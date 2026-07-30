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

function render(instance: Instance, blocks: number): Float64Array {
  const out = new Float64Array(blocks * FRAMES)
  for (let block = 0; block < blocks; block++) {
    const channels = [new Float32Array(FRAMES), new Float32Array(FRAMES)]
    expect(instance.process([], [channels])).toBe(true)
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
