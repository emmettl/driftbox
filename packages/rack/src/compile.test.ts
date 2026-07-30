import { describe, expect, it } from 'vitest'
import { compile } from './compile.js'
import { MODULES } from './modules/index.js'
import type { Patch, PatchCable, Plan, PlanNote } from './types.js'

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
