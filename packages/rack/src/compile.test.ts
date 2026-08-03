import { describe, expect, it } from 'vitest'
import { compile } from './compile.js'
import { MODULES } from './modules/index.js'
import type { ModuleDef, Patch, PatchCable, Plan, PlanNote, Registry } from './types.js'

// The compiler is the part of the rack worth being careful about, and it is pure arithmetic
// on plain objects — so everything that makes a graph a graph is measurable here, with no
// audio device and no browser. If any of this is wrong, no amount of correct DSP saves it.

const patch = (
  modules: [string, string][],
  cables: [string, string, string, string][] = [],
): Patch => ({
  modules: modules.map(([id, type]) => ({ id, type })),
  cables: cables.map(([a, b, c, d]) => ({ from: [a, b], to: [c, d] }) as PatchCable),
})

const compiled = (
  modules: [string, string][],
  cables: [string, string, string, string][] = [],
) => compile(patch(modules, cables), MODULES)

const order = (plan: Plan) => plan.nodes.map((n) => n.id)
const kinds = (plan: Plan, kind: PlanNote['kind']) => plan.notes.filter((n) => n.kind === kind)

/** The buffer a named inlet of a named module reads from. */
function inlet(plan: Plan, moduleId: string, index: number): number | undefined {
  return plan.nodes.find((n) => n.id === moduleId)?.inlets[index]
}

describe('compiling a patch', () => {
  it('orders a chain so every module runs after the one feeding it', () => {
    // Deliberately listed backwards. The order has to come from the cables, not from the
    // order somebody happened to drag modules into the rack.
    const plan = compiled(
      [
        ['out', 'out'],
        ['filter', 'ladder'],
        ['osc', 'vco'],
      ],
      [
        ['osc', 'out', 'filter', 'in'],
        ['filter', 'out', 'out', 'in'],
      ],
    )

    expect(order(plan)).toEqual(['osc', 'filter', 'out'])
    expect(kinds(plan, 'delayed')).toEqual([])
  })

  it('is a function of the patch alone', () => {
    // Two hosts compiling the same patch must agree, or a shared URL is not a shared sound.
    // Independent modules are the case where an arbitrary order could creep in.
    const modules: [string, string][] = [
      ['a', 'vco'],
      ['b', 'vco'],
      ['c', 'vco'],
      ['out', 'out'],
    ]
    expect(order(compiled(modules))).toEqual(order(compiled(modules)))
    expect(order(compiled(modules))).toEqual(['a', 'b', 'c', 'out'])
  })

  it('reads silence from an unconnected inlet', () => {
    // Buffer 0 is the zero buffer. Every unconnected inlet in the patch points at it, which
    // is what saves each module from branching on whether it is patched.
    const plan = compiled([['filter', 'ladder']])
    expect(inlet(plan, 'filter', 0)).toBe(0)
    expect(inlet(plan, 'filter', 1)).toBe(0)
    expect(inlet(plan, 'filter', 2)).toBe(0)
  })

  it('never points an outlet at the zero buffer', () => {
    // A module writing to buffer 0 would invent a signal for every unconnected inlet in the
    // patch at once. Outlets get their own buffer whether or not anything is patched to one.
    const plan = compiled([
      ['a', 'vco'],
      ['b', 'ladder'],
      ['out', 'out'],
    ])
    for (const node of plan.nodes) {
      for (const buffer of node.outlets) expect(buffer).toBeGreaterThan(0)
    }
  })

  it('shares one buffer when an outlet feeds several inlets', () => {
    // A split is free in the buffer model: three readers, one buffer, no copy.
    const plan = compiled(
      [
        ['osc', 'vco'],
        ['filter', 'ladder'],
      ],
      [
        ['osc', 'out', 'filter', 'in'],
        ['osc', 'out', 'filter', 'cutoff'],
        ['osc', 'out', 'filter', 'res'],
      ],
    )
    const [input, cutoff, res] = plan.nodes.find((n) => n.id === 'filter')!.inlets
    expect(input).toBeGreaterThan(0)
    expect(cutoff).toBe(input)
    expect(res).toBe(input)
  })

  it('compiles a bounded hidden trim slot for a patched inlet', () => {
    const source: Patch = {
      modules: [
        { id: 'osc', type: 'vco' },
        { id: 'filter', type: 'ladder', inputTrims: { in: 9, cutoff: -0.4 } },
      ],
      cables: [{ from: ['osc', 'out'], to: ['filter', 'cutoff'] }],
    }
    const plan = compile(source, MODULES)
    const node = plan.nodes.find((candidate) => candidate.id === 'filter')!
    const slots = plan.inputTrims!.filter

    expect(plan.params[slots.cutoff].value).toBe(-0.4)
    expect(node.inletTrims).toEqual([undefined, slots.cutoff, undefined])
    // Kept out of the authored param namespace even if a third-party module uses an unfortunate id.
    expect(plan.slots.filter).not.toHaveProperty('cutoff', slots.cutoff)
  })

  it('spends nothing on an inlet with nothing patched to it', () => {
    // A slot is not free: the Graph gives a trimmed inlet a buffer of its own and multiplies it sample by
    // sample, where an untrimmed one just points at the source's buffer. Allocating for every inlet of
    // every module cost 4% of render time on the small bench patches and 10% on `pressure-system`, all of
    // it spent multiplying silence by one.
    const source: Patch = {
      modules: [
        { id: 'osc', type: 'vco' },
        { id: 'filter', type: 'ladder', inputTrims: { in: 0.5, res: 0.25, cutoff: -0.4 } },
      ],
      cables: [{ from: ['osc', 'out'], to: ['filter', 'cutoff'] }],
    }
    const plan = compile(source, MODULES)
    // `in` and `res` are unpatched: their pots are remembered in the patch and cost the graph nothing.
    expect(Object.keys(plan.inputTrims!.filter)).toEqual(['cutoff'])
    expect(plan.inputTrims!.osc).toEqual({})
  })

  it('bounds a trim however it was written down', () => {
    const source: Patch = {
      modules: [
        { id: 'osc', type: 'vco' },
        { id: 'filter', type: 'ladder', inputTrims: { in: -9 } },
      ],
      cables: [{ from: ['osc', 'out'], to: ['filter', 'in'] }],
    }
    const plan = compile(source, MODULES)
    expect(plan.params[plan.inputTrims!.filter.in].value).toBe(-1)
  })

  it('gives a trim slot the moment a cable arrives, without forgetting the setting', () => {
    // What makes the pot belong to the jack rather than to the cable: it is remembered while unpatched and
    // starts working when something is plugged in, because plugging one in rebuilds.
    const modules = [
      { id: 'osc', type: 'vco' },
      { id: 'filter', type: 'ladder', inputTrims: { in: -0.6 } },
    ]
    const unpatched = compile({ modules, cables: [] }, MODULES)
    expect(unpatched.inputTrims!.filter).toEqual({})

    const patched = compile(
      { modules, cables: [{ from: ['osc', 'out'], to: ['filter', 'in'] }] },
      MODULES,
    )
    expect(patched.params[patched.inputTrims!.filter.in].value).toBe(-0.6)
  })

  it('does not renumber a knob when a cable is patched', () => {
    // Trim slots are decided by what is patched, so they are allocated in a pass of their own after every
    // authored param. Interleaved, patching one thing would have shifted every knob after it — the
    // guarantee the slot ordering above exists to give.
    const modules = [
      { id: 'osc', type: 'vco' },
      { id: 'filter', type: 'ladder' },
      { id: 'out', type: 'out' },
    ]
    const before = compile({ modules, cables: [] }, MODULES)
    const after = compile(
      { modules, cables: [{ from: ['osc', 'out'], to: ['filter', 'in'] }] },
      MODULES,
    )
    expect(after.slots).toEqual(before.slots)
  })

  it('keeps a module whose type this build does not know, rather than deleting it', () => {
    // The important property: `compile` does not touch the patch. Open a newer patch in an
    // older build, re-save, and the module and its cables are still there — deleting it
    // would take every cable touching it too, and that is a demolition, not a repair.
    const source: Patch = {
      modules: [
        { id: 'osc', type: 'vco' },
        { id: 'mystery', type: 'wavefolder', params: { fold: 0.7 } },
        { id: 'out', type: 'out' },
      ],
      cables: [
        { from: ['osc', 'out'], to: ['mystery', 'in'] },
        { from: ['mystery', 'out'], to: ['out', 'in'] },
      ],
    }
    const plan = compile(source, MODULES)

    expect(order(plan)).toEqual(['osc', 'out'])
    expect(kinds(plan, 'placeholder')).toHaveLength(1)
    expect(kinds(plan, 'placeholder')[0].module).toBe('mystery')
    // A cable out of a placeholder is silence, not a dropped cable.
    expect(inlet(plan, 'out', 0)).toBe(0)
    expect(kinds(plan, 'dropped-cable')).toEqual([])
    expect(source.modules).toHaveLength(3)
    expect(source.cables).toHaveLength(2)
  })

  it('drops a cable that goes nowhere and says which', () => {
    const plan = compiled(
      [
        ['osc', 'vco'],
        ['out', 'out'],
      ],
      [
        ['osc', 'out', 'ghost', 'in'],
        ['ghost', 'out', 'out', 'in'],
        ['osc', 'nonexistent', 'out', 'in'],
        ['osc', 'out', 'out', 'nonexistent'],
      ],
    )
    expect(kinds(plan, 'dropped-cable')).toHaveLength(4)
    expect(inlet(plan, 'out', 0)).toBe(0)
  })

  it('takes the last cable into a contested inlet', () => {
    // What happens in Reason when you drag a cable onto an occupied input. Summing instead
    // would make every inlet a hidden mixer; the Mixer module is the visible one.
    const plan = compiled(
      [
        ['a', 'vco'],
        ['b', 'vco'],
        ['out', 'out'],
      ],
      [
        ['a', 'out', 'out', 'in'],
        ['b', 'out', 'out', 'in'],
      ],
    )
    const b = plan.nodes.find((n) => n.id === 'b')!.outlets[0]
    expect(inlet(plan, 'out', 0)).toBe(b)

    const replaced = kinds(plan, 'replaced-cable')
    expect(replaced).toHaveLength(1)
    expect(replaced[0].cable?.from).toEqual(['a', 'out'])
  })

  it('breaks a cycle rather than failing to order it', () => {
    // Two filters feeding each other. There is no order that satisfies both cables, so one
    // of them reads the buffer the other wrote last block — a 2.9ms delay, which is what
    // Reason did. What must not happen is a hang, a throw, or a dropped module.
    const plan = compiled(
      [
        ['a', 'ladder'],
        ['b', 'ladder'],
        ['out', 'out'],
      ],
      [
        ['a', 'out', 'b', 'in'],
        ['b', 'out', 'a', 'in'],
        ['b', 'out', 'out', 'in'],
      ],
    )

    expect(order(plan)).toHaveLength(3)
    expect(new Set(order(plan))).toEqual(new Set(['a', 'b', 'out']))

    const delayed = kinds(plan, 'delayed')
    expect(delayed).toHaveLength(1)
    expect(delayed[0].module).toBe('a')
    // Both cables still resolve to a real buffer: a delayed cable is an ordering decision,
    // not a disconnection.
    expect(inlet(plan, 'a', 0)).toBeGreaterThan(0)
    expect(inlet(plan, 'b', 0)).toBeGreaterThan(0)
  })

  it('reports a module patched into itself as delayed', () => {
    const plan = compiled([['a', 'ladder']], [['a', 'out', 'a', 'in']])
    expect(kinds(plan, 'delayed')).toHaveLength(1)
    expect(inlet(plan, 'a', 0)).toBeGreaterThan(0)
  })

  it('orders a diamond correctly and delays nothing', () => {
    // One source, two paths, rejoining. Neither branch is a cycle, so neither should be
    // delayed — a cycle-breaker that is too eager shows up here first.
    const plan = compiled(
      [
        ['osc', 'vco'],
        ['left', 'ladder'],
        ['right', 'ladder'],
        ['out', 'out'],
      ],
      [
        ['osc', 'out', 'left', 'in'],
        ['osc', 'out', 'right', 'in'],
        ['left', 'out', 'right', 'cutoff'],
        ['right', 'out', 'out', 'in'],
      ],
    )
    expect(order(plan)).toEqual(['osc', 'left', 'right', 'out'])
    expect(kinds(plan, 'delayed')).toEqual([])
  })

  it('gives every terminal module an output and an empty patch none', () => {
    expect(compile({ modules: [], cables: [] }, MODULES).outputs).toEqual([])

    const plan = compiled([
      ['a', 'out'],
      ['b', 'out'],
      ['osc', 'vco'],
    ])
    expect(plan.outputs).toHaveLength(2)
    expect(new Set(plan.outputs).size).toBe(2)
  })

  it('drops a duplicate id rather than letting two modules share one', () => {
    const plan = compiled([
      ['osc', 'vco'],
      ['osc', 'ladder'],
    ])
    expect(order(plan)).toEqual(['osc'])
    expect(plan.nodes[0].type).toBe('vco')
    expect(kinds(plan, 'duplicate-module')).toHaveLength(1)
  })

  it('takes saved param values and clamps them into range', () => {
    const plan = compile(
      {
        modules: [
          { id: 'osc', type: 'vco', params: { tune: 7, width: 40, shape: Number.NaN } },
          { id: 'out', type: 'out' },
        ],
        cables: [],
      },
      MODULES,
    )
    const at = (moduleId: string, paramId: string) => plan.params[plan.slots[moduleId][paramId]]

    expect(at('osc', 'tune').value).toBe(7)
    // Clamped, not rejected: a value from a build with a wider knob is still a wish about
    // where the knob should be.
    expect(at('osc', 'width').value).toBe(0.95)
    // Not coerced. Number(NaN-ish) tricks would put the shape selector at 0 by accident,
    // which is where it happens to belong — so this is checked on a param whose default is
    // not zero as well.
    expect(at('osc', 'shape').value).toBe(0)
    expect(at('out', 'level').value).toBe(0.7)
    expect(at('osc', 'shape').stepped).toBe(true)
    expect(at('osc', 'tune').stepped).toBe(false)
  })

  it('does not renumber param slots when a cable reorders execution', () => {
    // Slots are allocated in patch order for this reason: a UI holding a slot for a knob the
    // user is dragging must not have it mean a different knob because a cable was added.
    const modules: [string, string][] = [
      ['out', 'out'],
      ['osc', 'vco'],
    ]
    const before = compiled(modules)
    const after = compiled(modules, [['osc', 'out', 'out', 'in']])

    expect(order(before)).not.toEqual(order(after))
    expect(after.slots).toEqual(before.slots)
  })

  it('survives a patch that is not one', () => {
    // Straight from a URL somebody else sent. Never throw: the failure mode for trusting
    // this is the rack going silent with no way back.
    const junk = {
      modules: [null, { id: '' }, { id: 'ok', type: 'vco' }, 7],
      cables: [null, { from: 'nope' }, { from: ['ok'], to: ['ok', 'in'] }],
    }
    const plan = compile(junk as unknown as Patch, MODULES)
    expect(order(plan)).toEqual(['ok'])

    for (const empty of [{}, { modules: null, cables: 'no' }, null]) {
      expect(() => compile(empty as unknown as Patch, MODULES)).not.toThrow()
    }
  })
})

describe('migrating a module', () => {
  // A module that renamed a knob. This is what per-module versioning is for, and the repair
  // lives next to the module rather than in a central table — at forty modules a central table
  // is unmaintainable, and the person renaming the param is the one who knows what the old
  // value meant.
  const V2: ModuleDef = {
    ...MODULES.vco,
    version: 2,
    params: [{ id: 'pitch', name: 'Pitch', min: -24, max: 24, default: 0 }],
    migrate(params, from) {
      // v1 called it `tune`. Anything older still has to produce a v2 shape.
      return from < 2 && typeof params.tune === 'number' ? { pitch: params.tune } : params
    },
  }
  const REGISTRY: Registry = { ...MODULES, vco: V2 }

  const at = (plan: Plan, moduleId: string, paramId: string) =>
    plan.params[plan.slots[moduleId][paramId]]?.value

  it('runs when the patch was saved by an older version', () => {
    const plan = compile(
      { modules: [{ id: 'osc', type: 'vco', version: 1, params: { tune: 7 } }], cables: [] },
      REGISTRY,
    )
    expect(at(plan, 'osc', 'pitch')).toBe(7)
  })

  it('does not run when the version is absent, which means current', () => {
    // A patch written by hand should not have to declare a version, and guessing "oldest" would
    // migrate data that was never in the old shape.
    const plan = compile(
      { modules: [{ id: 'osc', type: 'vco', params: { pitch: 5 } }], cables: [] },
      REGISTRY,
    )
    expect(at(plan, 'osc', 'pitch')).toBe(5)
  })

  it('does not migrate a version newer than this build backwards', () => {
    const plan = compile(
      { modules: [{ id: 'osc', type: 'vco', version: 9, params: { pitch: 4 } }], cables: [] },
      REGISTRY,
    )
    expect(at(plan, 'osc', 'pitch')).toBe(4)
  })

  it('clamps what a migration returns, like any other saved value', () => {
    const plan = compile(
      { modules: [{ id: 'osc', type: 'vco', version: 1, params: { tune: 9999 } }], cables: [] },
      REGISTRY,
    )
    expect(at(plan, 'osc', 'pitch')).toBe(24)
  })

  it('does not touch the patch it was handed', () => {
    // `migrate` gets a copy. It is somebody's hand-written repair function, and one that
    // mutated its argument would corrupt the patch still held by the host — which is the copy
    // that gets saved.
    const patch: Patch = {
      modules: [{ id: 'osc', type: 'vco', version: 1, params: { tune: 7 } }],
      cables: [],
    }
    compile(patch, {
      ...MODULES,
      vco: {
        ...V2,
        migrate(params) {
          delete params.tune
          params.pitch = 0
          return params
        },
      },
    })
    expect(patch.modules[0].params).toEqual({ tune: 7 })
  })

  it('survives a migration that throws, and says so', () => {
    // Somebody's repair function running against data from an unknown build: the one input here
    // that might be wrong other than the patch. It costs that module's knobs and nothing else.
    const plan = compile(
      { modules: [{ id: 'osc', type: 'vco', version: 1, params: { tune: 7 } }], cables: [] },
      {
        ...MODULES,
        vco: {
          ...V2,
          migrate() {
            throw new Error('nope')
          },
        },
      },
    )
    expect(at(plan, 'osc', 'pitch')).toBe(0)
    expect(kinds(plan, 'migration-failed')).toHaveLength(1)
    expect(kinds(plan, 'migration-failed')[0].module).toBe('osc')
    expect(plan.nodes.map((n) => n.id)).toEqual(['osc'])
  })
})

describe('stereo ports', () => {
  // A stereo port owns two consecutive buffers and occupies two slots in its processor's arrays. The rules
  // themselves live in `stereo.ts` and are tested there; what matters here is that the compiler applies
  // them, because a wrong slot is an undefined read inside the audio thread rather than a failed assertion.

  const node = (plan: Plan, id: string) => plan.nodes.find((n) => n.id === id)!

  it('gives a stereo outlet two buffers and a mono one still gets one', () => {
    const plan = compiled([['rev', 'reverb']])
    // Reverb: one mono inlet, one stereo outlet.
    expect(node(plan, 'rev').inlets).toHaveLength(1)
    expect(node(plan, 'rev').outlets).toHaveLength(2)
    // Consecutive, so widening a port later moves only the numbers after it.
    expect(node(plan, 'rev').outlets[1]).toBe(node(plan, 'rev').outlets[0] + 1)
  })

  it('carries both channels between two stereo ports', () => {
    const plan = compiled(
      [
        ['rev', 'reverb'],
        ['out-1', 'out'],
      ],
      [['rev', 'out', 'out-1', 'in']],
    )
    expect(node(plan, 'out-1').inlets).toEqual(node(plan, 'rev').outlets)
  })

  it('centres a mono source into a stereo inlet', () => {
    // Every patch written before stereo existed is this case, and it has to sound exactly as it did.
    const plan = compiled(
      [
        ['osc', 'vco'],
        ['out-1', 'out'],
      ],
      [['osc', 'out', 'out-1', 'in']],
    )
    const [left, right] = node(plan, 'out-1').inlets
    expect(left).toBe(node(plan, 'osc').outlets[0])
    expect(right).toBe(left)
  })

  it('folds a stereo source into a mono inlet, and says so', () => {
    const plan = compiled(
      [
        ['rev', 'reverb'],
        ['lad', 'ladder'],
      ],
      [['rev', 'out', 'lad', 'in']],
    )
    expect(node(plan, 'lad').inlets[0]).toBe(node(plan, 'rev').outlets[0])
    // Reported rather than silent: a patch that behaves unlike its picture is worse than one that admits it.
    const folded = kinds(plan, 'mono-fold')
    expect(folded).toHaveLength(1)
    expect(folded[0].module).toBe('lad')
    expect(folded[0].cable).toEqual({ from: ['rev', 'out'], to: ['lad', 'in'] })
  })

  it('says nothing about a cable that loses nothing', () => {
    const plan = compiled(
      [
        ['osc', 'vco'],
        ['lad', 'ladder'],
        ['rev', 'reverb'],
        ['out-1', 'out'],
      ],
      [
        ['osc', 'out', 'lad', 'in'],
        ['rev', 'out', 'out-1', 'in'],
      ],
    )
    expect(kinds(plan, 'mono-fold')).toHaveLength(0)
  })

  it('leaves an unconnected stereo inlet reading silence on both channels', () => {
    // The property the zero buffer exists to give: no module branches on whether it is patched.
    expect(node(compiled([['out-1', 'out']]), 'out-1').inlets).toEqual([0, 0])
  })

  it('reaches the mix as a pair when the terminal outlet is stereo', () => {
    const plan = compiled([['out-1', 'out']])
    const output = plan.outputs[0]
    expect(output.right).toBe(output.buffer + 1)
  })

  it('reaches the mix as one buffer when the terminal outlet is mono', () => {
    // A terminal module type this build has never seen, or a future mono one, must still work.
    const registry: Registry = {
      ...MODULES,
      sink: { ...MODULES.out, type: 'sink', inlets: [{ id: 'in', name: 'In' }], outlets: [{ id: 'out', name: 'Out' }] },
    }
    const plan = compile({ modules: [{ id: 's', type: 'sink' }], cables: [] }, registry)
    expect(plan.outputs[0].right).toBeNull()
  })
})

describe('bypass', () => {
  const node = (plan: Plan, id: string) => plan.nodes.find((n) => n.id === id)

  const chain = (bypass: string[]): Plan =>
    compile(
      {
        modules: [
          { id: 'osc', type: 'vco' },
          { id: 'lad', type: 'ladder', bypassed: bypass.includes('lad') || undefined },
          { id: 'svf', type: 'svf', bypassed: bypass.includes('svf') || undefined },
          { id: 'out-1', type: 'out' },
        ],
        cables: [
          { from: ['osc', 'out'], to: ['lad', 'in'] },
          { from: ['lad', 'out'], to: ['svf', 'in'] },
          { from: ['svf', 'lp'], to: ['out-1', 'in'] },
        ],
      },
      MODULES,
    )

  it('runs nothing for a bypassed module', () => {
    // Not "runs it and ignores the result": it gets no node at all, which is what makes bypassing an
    // expensive module actually free the CPU.
    expect(node(chain(['lad']), 'lad')).toBeUndefined()
    expect(node(chain([]), 'lad')).toBeDefined()
  })

  it('passes its input straight to whatever read its outlet', () => {
    const plan = chain(['lad'])
    // The SVF now reads the oscillator directly.
    expect(node(plan, 'svf')!.inlets[0]).toBe(node(plan, 'osc')!.outlets[0])
  })

  it('walks back through a run of bypassed modules', () => {
    const plan = chain(['lad', 'svf'])
    // Both gone, so the Out reads the oscillator through two of them.
    expect(node(plan, 'out-1')!.inlets[0]).toBe(node(plan, 'osc')!.outlets[0])
  })

  it('carries a stereo signal through unchanged', () => {
    // Resolution returns the source's CHANNELS rather than one buffer, so a bypassed module in front of
    // something stereo does not quietly fold the pair.
    const plan = compile(
      {
        modules: [
          { id: 'rev', type: 'reverb' },
          { id: 'eq', type: 'eq', bypassed: true },
          { id: 'out-1', type: 'out' },
        ],
        cables: [
          { from: ['rev', 'out'], to: ['eq', 'in'] },
          { from: ['eq', 'out'], to: ['out-1', 'in'] },
        ],
      },
      MODULES,
    )
    expect(node(plan, 'out-1')!.inlets).toEqual(node(plan, 'rev')!.outlets)
  })

  it('is silence when there is nothing in front of it', () => {
    const plan = compile(
      {
        modules: [
          { id: 'lad', type: 'ladder', bypassed: true },
          { id: 'out-1', type: 'out' },
        ],
        cables: [{ from: ['lad', 'out'], to: ['out-1', 'in'] }],
      },
      MODULES,
    )
    expect(node(plan, 'out-1')!.inlets).toEqual([0, 0])
  })

  it('is silence for a bypassed source, which is what turning one off means', () => {
    // A VCO has no signal inlet to pass through, so one flag covers Reason's Bypass and its Off.
    const plan = compile(
      {
        modules: [
          { id: 'osc', type: 'vco', bypassed: true },
          { id: 'out-1', type: 'out' },
        ],
        cables: [{ from: ['osc', 'out'], to: ['out-1', 'in'] }],
      },
      MODULES,
    )
    expect(node(plan, 'out-1')!.inlets).toEqual([0, 0])
  })

  it('takes a bypassed Out off the mix bus', () => {
    // Its outlet buffer is written by nobody, so summing it would put whatever was last in that buffer
    // into the mix for ever.
    expect(compile({ modules: [{ id: 'out-1', type: 'out' }], cables: [] }, MODULES).outputs).toHaveLength(1)
    expect(
      compile({ modules: [{ id: 'out-1', type: 'out', bypassed: true }], cables: [] }, MODULES).outputs,
    ).toHaveLength(0)
  })

  it('survives a ring of bypassed modules rather than overflowing the stack', () => {
    // A patch arrives from outside the program. The placeholder rule's standard — neutralise, never crash
    // — has to hold for this too.
    const plan = compile(
      {
        modules: [
          { id: 'a', type: 'ladder', bypassed: true },
          { id: 'b', type: 'ladder', bypassed: true },
          { id: 'out-1', type: 'out' },
        ],
        cables: [
          { from: ['a', 'out'], to: ['b', 'in'] },
          { from: ['b', 'out'], to: ['a', 'in'] },
          { from: ['b', 'out'], to: ['out-1', 'in'] },
        ],
      },
      MODULES,
    )
    expect(node(plan, 'out-1')!.inlets).toEqual([0, 0])
  })

  it('keeps its param slots, so its knobs still work while it is out of circuit', () => {
    // Half of why anybody bypasses something is to set it up against the dry signal.
    const plan = chain(['lad'])
    expect(plan.slots.lad).toBeDefined()
    expect(typeof plan.slots.lad.cutoff).toBe('number')
  })

  it('stops constraining the order it is no longer part of', () => {
    // Resolution happens before the topological sort, so a bypassed module in the middle does not report
    // a feedback delay that no longer exists.
    expect(kinds(chain(['lad', 'svf']), 'delayed')).toHaveLength(0)
  })
})
