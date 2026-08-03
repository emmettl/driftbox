import { describe, expect, it } from 'vitest'
import { compile } from './compile.js'
import { Graph } from './graph.js'
import { MODULES } from './modules/index.js'
import { decodePatch, encodePatch } from './patch-io.js'
import { TRIM_MAX, TRIM_MIN, readTrim } from './trim.js'
import type { Patch, Processor } from './types.js'

// A trim on a cable: what the compiler makes of it, what the Graph does with it, and — the two claims that
// matter most — that an untrimmed cable goes on costing nothing, and that a patch from before trims existed
// is unchanged by a round trip through a build that has them.

const SR = 48000
const FRAMES = 64

/** One render block. The Graph writes into the channels it is handed rather than taking a frame count. */
const block = (graph: Graph) => graph.process([new Float32Array(FRAMES), new Float32Array(FRAMES)])

/** A source that writes a constant, so a trim is readable as a number rather than as a waveform. */
class Constant implements Processor {
  process(_i: Float32Array[], outlets: Float32Array[], params: Float32Array[], frames: number) {
    for (let i = 0; i < frames; i++) outlets[0][i] = params[0][i]
  }
}

/** A module that does nothing but pass its inlet on — something to bypass. Its own class rather than a
 *  second Probe, so there is never a question about which of them wrote the reading. */
class Pass implements Processor {
  process(inlets: Float32Array[], outlets: Float32Array[], _p: Float32Array[], frames: number) {
    for (let i = 0; i < frames; i++) outlets[0][i] = inlets[0][i]
  }
}

/** Reports what reached its inlet, so a test can read the far end of a cable. */
class Probe implements Processor {
  static last = 0
  process(inlets: Float32Array[], outlets: Float32Array[], _p: Float32Array[], frames: number) {
    for (let i = 0; i < frames; i++) outlets[0][i] = inlets[0][i]
    Probe.last = inlets[0][frames - 1]
  }
}

const REGISTRY = {
  source: {
    type: 'source',
    version: 1,
    name: 'Source',
    inlets: [],
    outlets: [{ id: 'out', name: 'Out' }],
    params: [{ id: 'level', name: 'Level', min: -4, max: 4, default: 1 }],
    processor: Constant,
    poly: false,
  },
  probe: {
    type: 'probe',
    version: 1,
    name: 'Probe',
    inlets: [{ id: 'in', name: 'In' }],
    outlets: [{ id: 'out', name: 'Out' }],
    params: [],
    processor: Probe,
    poly: false,
    terminal: true,
  },
}

function run(patch: Patch): number {
  const plan = compile(patch, REGISTRY)
  const graph = new Graph(SR, FRAMES, { source: Constant, probe: Probe }, {})
  graph.setPlan(plan)
  // Twice: a param ramps across its first block from the value the plan seeded, so the second block is the
  // settled number. Reading the first would measure the ramp rather than the trim.
  block(graph)
  block(graph)
  return Probe.last
}

const PATCH = (trim?: number): Patch => ({
  modules: [
    { id: 's', type: 'source', params: { level: 1 } },
    { id: 'p', type: 'probe' },
  ],
  cables: [{ from: ['s', 'out'], to: ['p', 'in'], ...(trim === undefined ? {} : { trim }) }],
})

describe('what a trim does to the signal', () => {
  it('passes the source untouched when there is no trim', () => {
    expect(run(PATCH())).toBeCloseTo(1, 5)
  })

  it('turns the source down', () => {
    expect(run(PATCH(0.25))).toBeCloseTo(0.25, 5)
  })

  it('inverts it, which is the half of this that Reason does not have', () => {
    // The reason the range is bipolar: one LFO opening a filter while closing a VCA, a sidechain becoming a
    // duck. An attenuator alone would have left half the inline Offsets it stands in for.
    expect(run(PATCH(-1))).toBeCloseTo(-1, 5)
  })

  it('silences the cable at zero', () => {
    expect(run(PATCH(0))).toBeCloseTo(0, 5)
  })

  it('passes it untouched at exactly unity, which still costs a slot', () => {
    // Written down rather than absent, which is what the knob does so that dragging it never rebuilds. The
    // sound is the same as no trim; the plan is not.
    expect(run(PATCH(1))).toBeCloseTo(1, 5)
  })
})

describe('what the compiler spends on one', () => {
  it('spends nothing at all on a cable with no trim', () => {
    // The claim the whole design rests on. An untrimmed inlet points straight at the source's buffer — no
    // node work, no param slot, no multiply — which is why a trim is opt-in rather than universal.
    const plan = compile(PATCH(), REGISTRY)
    expect(plan.nodes.every((node) => node.trims === undefined)).toBe(true)
    expect(plan.trimSlots).toEqual({})
    expect(plan.params).toHaveLength(1)
  })

  it('gives a trimmed cable a slot, addressed by where it lands', () => {
    // Keyed by the destination, because one cable per inlet makes that unique where a source may fan out to
    // several inlets each with a trim of its own.
    const plan = compile(PATCH(0.5), REGISTRY)
    expect(plan.trimSlots).toEqual({ p: { in: 1 } })
    expect(plan.params[1]).toEqual({ value: 0.5, stepped: false })
    expect(plan.nodes.find((node) => node.id === 'p')?.trims).toEqual([{ inlet: 0, slots: [1] }])
  })

  it('puts trim slots after every knob, so adding one renumbers no knob', () => {
    // Slots are numbers the host holds and the Graph carries knob positions across a rebuild by. A trim
    // landing in the middle of the table would hand every knob after it somebody else's value.
    const plan = compile(PATCH(0.5), REGISTRY)
    expect(plan.slots.s.level).toBe(0)
    expect(plan.trimSlots.p.in).toBe(1)
  })

  it('clamps a trim from outside the range it is allowed', () => {
    expect(compile(PATCH(9), REGISTRY).params[1].value).toBe(TRIM_MAX)
    expect(compile(PATCH(-9), REGISTRY).params[1].value).toBe(TRIM_MIN)
  })

  it('treats a trim that is not a number as no trim', () => {
    const patch = PATCH()
    patch.cables[0] = { ...patch.cables[0], trim: Number.NaN }
    const plan = compile(patch, REGISTRY)
    expect(plan.trimSlots).toEqual({})
  })
})

describe('a trim and a bypassed module', () => {
  const REGISTRY_WITH_PASS = {
    ...REGISTRY,
    pass: {
      type: 'pass',
      version: 1,
      name: 'Pass',
      inlets: [{ id: 'in', name: 'In' }],
      outlets: [{ id: 'out', name: 'Out' }],
      params: [],
      processor: Pass,
      poly: false,
    },
  }

  const through = (bypassed: boolean, trim: number): number => {
    const patch: Patch = {
      modules: [
        { id: 's', type: 'source', params: { level: 1 } },
        { id: 'm', type: 'pass', bypassed },
        { id: 'p', type: 'probe' },
      ],
      cables: [
        { from: ['s', 'out'], to: ['m', 'in'], trim },
        { from: ['m', 'out'], to: ['p', 'in'] },
      ],
    }
    const plan = compile(patch, REGISTRY_WITH_PASS)
    const graph = new Graph(SR, FRAMES, { source: Constant, probe: Probe, pass: Pass }, {})
    graph.setPlan(plan)
    block(graph)
    block(graph)
    return Probe.last
  }

  it('applies the trim while the module is in circuit', () => {
    expect(through(false, 0.5)).toBeCloseTo(0.5, 5)
  })

  it('keeps applying it once the module is bypassed', () => {
    // Bypass redirects everything reading a module's outlets to whatever reaches its first inlet. Dropping
    // that cable's trim on the way would mean taking a module out of circuit changed the level going past
    // it, which is not what bypass means — and the jump would be blamed on the module.
    expect(through(true, 0.5)).toBeCloseTo(0.5, 5)
  })
})

describe('a trim reaching a stereo inlet', () => {
  it('scales both channels, rather than turning one down and panning', () => {
    const stereoRegistry = {
      ...REGISTRY,
      wide: {
        type: 'wide',
        version: 1,
        name: 'Wide',
        inlets: [],
        outlets: [{ id: 'out', name: 'Out', stereo: true }],
        params: [],
        processor: class implements Processor {
          process(_i: Float32Array[], outlets: Float32Array[], _p: Float32Array[], frames: number) {
            for (let i = 0; i < frames; i++) {
              outlets[0][i] = 1
              outlets[1][i] = 1
            }
          }
        },
        poly: false,
      },
      pair: {
        type: 'pair',
        version: 1,
        name: 'Pair',
        inlets: [{ id: 'in', name: 'In', stereo: true }],
        outlets: [{ id: 'out', name: 'Out' }],
        params: [],
        processor: class implements Processor {
          process(inlets: Float32Array[], outlets: Float32Array[], _p: Float32Array[], frames: number) {
            for (let i = 0; i < frames; i++) outlets[0][i] = 0
            Seen.left = inlets[0][frames - 1]
            Seen.right = inlets[1][frames - 1]
          }
        },
        poly: false,
        terminal: true,
      },
    }
    const patch: Patch = {
      modules: [
        { id: 'w', type: 'wide' },
        { id: 'q', type: 'pair' },
      ],
      cables: [{ from: ['w', 'out'], to: ['q', 'in'], trim: 0.5 }],
    }
    const plan = compile(patch, stereoRegistry)
    // Two entries, one per channel slot — the whole point of indexing by slot rather than by port.
    expect(plan.nodes.find((node) => node.id === 'q')?.trims).toHaveLength(2)

    const graph = new Graph(
      SR,
      FRAMES,
      { wide: stereoRegistry.wide.processor, pair: stereoRegistry.pair.processor },
      {},
    )
    graph.setPlan(plan)
    block(graph)
    block(graph)
    expect(Seen.left).toBeCloseTo(0.5, 5)
    expect(Seen.right).toBeCloseTo(0.5, 5)
  })
})

const Seen = { left: 0, right: 0 }

describe('turning one while the rack plays', () => {
  it('takes a message rather than a rebuild', () => {
    // The reason a trim is a param slot instead of a constant compiled into the plan. A constant would mean
    // recompiling on every pointer move, which rebuilds every processor and crackles continuously.
    const plan = compile(PATCH(1), REGISTRY)
    const graph = new Graph(SR, FRAMES, { source: Constant, probe: Probe }, {})
    graph.setPlan(plan)
    block(graph)
    block(graph)
    expect(Probe.last).toBeCloseTo(1, 5)

    graph.setParam(plan.trimSlots.p.in, 0.25)
    // Several blocks, because the change ramps rather than steps — which is what keeps it from clicking.
    for (let i = 0; i < 8; i++) block(graph)
    expect(Probe.last).toBeCloseTo(0.25, 5)
  })
})

describe('renumbering, when a trim comes or goes', () => {
  it('does not hand one trim another trim’s value', () => {
    // Slots are positions. Removing the first of two trims shifts the second down into the number the
    // first held, so this is exactly where a param could inherit a stranger's live value.
    //
    // Two things stop it, and the first is the real one: **a new plan always seeds from the plan**, because
    // `setPlan` rebuilds with `keepParams` false — live positions are only carried when the *block size*
    // changes and the plan has not. The count guard inside `build` is the second line, and it happens to
    // cover this case too because adding or removing a trim always changes the count. Deleting either one
    // alone leaves this passing; deleting both makes the second trim jump to the first one's value.
    const two = (first: number | undefined, second: number): Patch => ({
      modules: [
        { id: 's', type: 'source', params: { level: 1 } },
        { id: 'p', type: 'probe' },
        { id: 'q', type: 'probe' },
      ],
      cables: [
        { from: ['s', 'out'], to: ['p', 'in'], ...(first === undefined ? {} : { trim: first }) },
        { from: ['s', 'out'], to: ['q', 'in'], trim: second },
      ],
    })
    const graph = new Graph(SR, FRAMES, { source: Constant, probe: Probe }, {})
    graph.setPlan(compile(two(0.2, 0.8), REGISTRY))
    block(graph)
    block(graph)

    // The first trim is taken off. The second's slot number drops by one.
    const after = compile(two(undefined, 0.8), REGISTRY)
    expect(after.trimSlots.q.in).toBe(1)
    graph.setPlan(after)
    for (let i = 0; i < 8; i++) block(graph)
    // `q` runs last, so this is what reached it: 0.8, and not the 0.2 that used to live in that slot.
    expect(Probe.last).toBeCloseTo(0.8, 5)
  })

  it('does not disturb a knob when a trim appears beside it', () => {
    // The reason trim slots are appended after every module param rather than interleaved. A trim landing
    // in the middle of the table would push every knob after it onto somebody else's number.
    const patch = PATCH()
    patch.modules[0].params = { level: 0.6 }
    const graph = new Graph(SR, FRAMES, { source: Constant, probe: Probe }, {})
    graph.setPlan(compile(patch, REGISTRY))
    block(graph)
    block(graph)
    expect(Probe.last).toBeCloseTo(0.6, 5)

    const trimmed = PATCH(0.5)
    trimmed.modules[0].params = { level: 0.6 }
    const plan = compile(trimmed, REGISTRY)
    expect(plan.slots.s.level).toBe(0)
    graph.setPlan(plan)
    for (let i = 0; i < 8; i++) block(graph)
    expect(Probe.last).toBeCloseTo(0.3, 5)
  })
})

describe('a trim in the document', () => {
  it('survives a round trip', () => {
    const decoded = decodePatch(encodePatch(PATCH(-0.4)))
    expect(decoded?.cables[0].trim).toBe(-0.4)
  })

  it('leaves a patch from before trims existed byte-identical', () => {
    // The standard every added field in this format has held itself to, and the reason absence rather than
    // a written-down 1 is what "no trim" means.
    const text = encodePatch(PATCH())
    expect(encodePatch(decodePatch(text)!)).toBe(text)
    expect('trim' in decodePatch(text)!.cables[0]).toBe(false)
  })

  it('repairs a trim that is not a number, rather than dropping the cable', () => {
    const text = JSON.stringify({
      format: 1,
      modules: [
        { id: 's', type: 'source' },
        { id: 'p', type: 'probe' },
      ],
      cables: [{ from: ['s', 'out'], to: ['p', 'in'], trim: 'loud' }],
    })
    const decoded = decodePatch(text)!
    expect(decoded.cables).toHaveLength(1)
    expect('trim' in decoded.cables[0]).toBe(false)
  })

  it('keeps two cables between the same ports apart when their trims differ', () => {
    // They are not duplicates. Dropping the second would keep the first while `compile` — which takes the
    // *last* cable into an inlet — worked from the other one, so the file and the sound would disagree.
    const text = JSON.stringify({
      format: 1,
      modules: [
        { id: 's', type: 'source' },
        { id: 'p', type: 'probe' },
      ],
      cables: [
        { from: ['s', 'out'], to: ['p', 'in'], trim: 0.2 },
        { from: ['s', 'out'], to: ['p', 'in'], trim: 0.8 },
      ],
    })
    expect(decodePatch(text)!.cables).toHaveLength(2)
  })

  it('still drops a genuine duplicate', () => {
    const text = JSON.stringify({
      format: 1,
      modules: [
        { id: 's', type: 'source' },
        { id: 'p', type: 'probe' },
      ],
      cables: [
        { from: ['s', 'out'], to: ['p', 'in'], trim: 0.2 },
        { from: ['s', 'out'], to: ['p', 'in'], trim: 0.2 },
      ],
    })
    expect(decodePatch(text)!.cables).toHaveLength(1)
  })
})

describe('reading a trim from outside the program', () => {
  it('clamps to the range', () => {
    expect(readTrim(4)).toBe(TRIM_MAX)
    expect(readTrim(-4)).toBe(TRIM_MIN)
    expect(readTrim(0.3)).toBe(0.3)
  })

  it('reports nothing usable as no trim', () => {
    for (const value of [undefined, null, 'loud', Number.NaN, Infinity, {}]) {
      expect(readTrim(value), String(value)).toBeUndefined()
    }
  })
})

describe('the shipped modules', () => {
  it('compile with a trim on every cable of a real patch', () => {
    // Cheap, and it is the sweep that catches a slot walk that disagrees with the inlet walk — a stereo
    // port occupies two slots, and getting that wrong misaligns every trim after it on the same module.
    const patch: Patch = {
      modules: [
        { id: 'osc', type: 'vco' },
        { id: 'f', type: 'ladder' },
        { id: 'out', type: 'out' },
      ],
      cables: [
        { from: ['osc', 'out'], to: ['f', 'in'], trim: 0.5 },
        { from: ['f', 'out'], to: ['out', 'in'], trim: -0.5 },
      ],
    }
    const plan = compile(patch, MODULES)
    expect(plan.notes.filter((note) => note.kind === 'dropped-cable')).toEqual([])
    for (const node of plan.nodes) {
      for (const trim of node.trims ?? []) {
        expect(trim.inlet).toBeLessThan(node.inlets.length)
        for (const slot of trim.slots) expect(plan.params[slot]).toBeDefined()
      }
    }
  })
})
