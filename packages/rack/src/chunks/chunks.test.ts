import { describe, expect, it } from 'vitest'
import { compile } from '../compile.js'
import { MODULES } from '../modules/index.js'
import { EMPTY_PATCH } from '../index.js'
import type { Patch } from '../types.js'
import { CHUNKS, chunkById, insertChunk } from './index.js'

// A chunk is a recipe, not a container — it adds no concept to the patch format, and the result of inserting
// one has to be indistinguishable from having patched it by hand. Most of these assert exactly that.

const insert = (patch: Patch, id: string) => insertChunk(patch, chunkById(id)!)

describe.each(CHUNKS.map((chunk) => [chunk.id, chunk] as const))('the %s chunk', (_id, chunk) => {
  it('only names modules this build has', () => {
    for (const module of chunk.modules) expect(MODULES[module.type], module.type).toBeDefined()
  })

  it('only wires ports those modules actually have', () => {
    const typeOf = (local: string) => chunk.modules.find((m) => m.id === local)?.type
    for (const cable of chunk.cables) {
      const from = MODULES[typeOf(cable.from[0])!]
      const to = MODULES[typeOf(cable.to[0])!]
      expect(from?.outlets.some((p) => p.id === cable.from[1]), cable.from.join('.')).toBe(true)
      expect(to?.inlets.some((p) => p.id === cable.to[1]), cable.to.join('.')).toBe(true)
    }
  })

  it('names an output that exists', () => {
    const module = chunk.modules.find((m) => m.id === chunk.output[0])
    expect(module, chunk.output[0]).toBeDefined()
    expect(MODULES[module!.type].outlets.some((p) => p.id === chunk.output[1])).toBe(true)
  })

  it('only sets params that exist, within their ranges', () => {
    for (const module of chunk.modules) {
      for (const [id, value] of Object.entries(module.params ?? {})) {
        const def = MODULES[module.type].params.find((p) => p.id === id)
        expect(def, `${module.type}.${id}`).toBeDefined()
        expect(value, `${module.type}.${id}`).toBeGreaterThanOrEqual(def!.min)
        expect(value, `${module.type}.${id}`).toBeLessThanOrEqual(def!.max)
      }
    }
  })

  it('only routes between its own modules, at params those modules have', () => {
    // Same standard the cables are held to. A routing that names a param nobody has is silently inert —
    // `applyModulation` skips what it cannot resolve — so nothing else would ever notice.
    const typeOf = (local: string) => chunk.modules.find((m) => m.id === local)?.type
    for (const route of chunk.modulation ?? []) {
      for (const [end, label] of [
        [route.from, 'from'],
        [route.to, 'to'],
      ] as const) {
        const def = MODULES[typeOf(end[0])!]
        expect(def, `${label} ${end[0]}`).toBeDefined()
        const param = def.params.find((p) => p.id === end[1])
        expect(param, `${label} ${end.join('.')}`).toBeDefined()
        // A hidden param is written by the host; routing at one is refused at apply time, which would
        // make a chunk that looks wired and is not.
        expect(param!.hidden, `${label} ${end.join('.')}`).toBeFalsy()
      }
    }
  })

  it('routes between ends the target can actually reach', () => {
    // A limit outside the target's range is not an error — `routeValue` clamps it — but in a *shipped*
    // chunk it means a rotary with a dead zone at one end, which reads as a broken knob.
    const typeOf = (local: string) => chunk.modules.find((m) => m.id === local)?.type
    for (const route of chunk.modulation ?? []) {
      const param = MODULES[typeOf(route.to[0])!].params.find((p) => p.id === route.to[1])!
      for (const end of [route.min, route.max]) {
        if (end === undefined) continue
        expect(end, route.to.join('.')).toBeGreaterThanOrEqual(param.min)
        expect(end, route.to.join('.')).toBeLessThanOrEqual(param.max)
      }
    }
  })

  it('compiles into an empty rack with nothing dropped and reaches the output', () => {
    // The assertion that matters: dropped into nothing at all, it makes a sound. A chunk that needed
    // something already in the patch would be a chunk that does nothing when you first try it.
    const { patch } = insert(EMPTY_PATCH, chunk.id)
    const plan = compile(patch, MODULES)
    for (const kind of ['dropped-cable', 'placeholder', 'duplicate-module', 'replaced-cable']) {
      expect(plan.notes.filter((n) => n.kind === kind).map((n) => n.detail), kind).toEqual([])
    }
    expect(plan.outputs.length).toBeGreaterThan(0)
  })
})

describe('inserting a chunk', () => {
  it('gives it its own channel rather than sharing one', () => {
    // The decision that makes a rack of chunks a mixer. Sharing an Out would give every chunk the same
    // fader, which is the opposite of what a channel is for.
    const one = insert(EMPTY_PATCH, 'reese')
    const two = insert(one.patch, 'sub')
    expect(two.out).not.toBe(one.out)
    expect(two.patch.modules.filter((m) => m.type === 'out')).toHaveLength(2)
  })

  it('reuses the transport rather than adding a second', () => {
    // A second Transport would only agree with the first, and two of them is two things to keep in sync.
    const one = insert(EMPTY_PATCH, 'break')
    const two = insert(one.patch, 'hats')
    expect(two.patch.modules.filter((m) => m.type === 'transport')).toHaveLength(1)
  })

  it('can be dropped in twice without the two merging', () => {
    // The whole reason ids are rewritten. Local ids reused verbatim would collide, and the compiler would
    // report a duplicate and drop one — so the second copy would silently do nothing.
    const one = insert(EMPTY_PATCH, 'sub')
    const two = insert(one.patch, 'sub')
    expect(new Set(two.patch.modules.map((m) => m.id)).size).toBe(two.patch.modules.length)
    const plan = compile(two.patch, MODULES)
    expect(plan.notes.filter((n) => n.kind === 'duplicate-module')).toEqual([])
    // Two independent voices, each on its own channel.
    expect(plan.outputs.length).toBe(2)
  })

  it('rewrites the cables to match the ids it handed out', () => {
    const { patch, ids } = insert(EMPTY_PATCH, 'reese')
    const known = new Set(patch.modules.map((m) => m.id))
    for (const cable of patch.cables) {
      expect(known.has(cable.from[0]), cable.from.join('.')).toBe(true)
      expect(known.has(cable.to[0]), cable.to.join('.')).toBe(true)
    }
    // And the map it reports is the one it used.
    expect(patch.cables.some((c) => c.from[0] === ids['vca'])).toBe(true)
  })

  it('leaves the patch it was given untouched', () => {
    // An insert that mutated its input would corrupt the undo history and the autosave, and `PATCHES`
    // already takes the same care for the same reason.
    const before: Patch = { modules: [{ id: 'out-1', type: 'out' }], cables: [] }
    const snapshot = JSON.stringify(before)
    insert(before, 'sub')
    expect(JSON.stringify(before)).toBe(snapshot)
  })

  it('deep-copies the pattern data, so two copies can be edited apart', () => {
    const one = insert(EMPTY_PATCH, 'hats')
    const two = insert(one.patch, 'hats')
    const trackers = two.patch.modules.filter((m) => m.type === 'tracker')
    expect(trackers).toHaveLength(2)
    expect(trackers[0].data?.lane1).not.toBe(trackers[1].data?.lane1)
    expect(trackers[0].data?.lane1).toEqual(trackers[1].data?.lane1)
  })

  it('keeps what was already in the patch', () => {
    const before: Patch = {
      modules: [{ id: 'vco-1', type: 'vco' }],
      cables: [],
    }
    const { patch } = insert(before, 'sub')
    expect(patch.modules.some((m) => m.id === 'vco-1')).toBe(true)
  })

  it('does not collide with an id already in use', () => {
    // `out-1` is taken, so the chunk's channel has to be `out-2` — otherwise the compiler drops one of them.
    const before: Patch = { modules: [{ id: 'out-1', type: 'out' }], cables: [] }
    const { out } = insert(before, 'sub')
    expect(out).not.toBe('out-1')
  })
})

describe('the chunks as a set', () => {
  it('have unique ids and names, and something to say', () => {
    expect(new Set(CHUNKS.map((c) => c.id)).size).toBe(CHUNKS.length)
    expect(new Set(CHUNKS.map((c) => c.name)).size).toBe(CHUNKS.length)
    for (const chunk of CHUNKS) {
      expect(chunk.blurb.length).toBeGreaterThan(10)
      expect(chunk.blurb.length).toBeLessThan(60)
    }
  })

  it('marks the one that needs a sample, and only that one', () => {
    // A chunk with a Sampler and no break in it is silent, which is the failure this codebase keeps
    // fixing. The flag is what lets the host offer to fill it.
    for (const chunk of CHUNKS) {
      const hasSampler = chunk.modules.some((m) => m.type === 'sampler')
      expect(chunk.needsSample ?? false, chunk.id).toBe(hasSampler)
    }
  })

  it('build a whole track when stacked, which is the point', () => {
    // Four chunks into an empty rack: four channels, one transport, and it compiles.
    let patch: Patch = EMPTY_PATCH
    for (const chunk of CHUNKS) patch = insertChunk(patch, chunk).patch
    const plan = compile(patch, MODULES)
    expect(plan.outputs.length).toBe(CHUNKS.length)
    expect(patch.modules.filter((m) => m.type === 'transport')).toHaveLength(1)
    expect(plan.notes.filter((n) => n.kind === 'dropped-cable')).toEqual([])
  })
})

describe('a chunk makes a sound the moment it is dropped', () => {
  // The failure this codebase keeps having to fix, in its newest disguise. A Tracker with no data rests for
  // ever, so a chunk built on one arrives silent — and "I added it and nothing happened" is indistinguishable
  // from it being broken. Caught by driving the page: adding a Reese made the mix quieter, not louder.

  it('gives every sequencer in every chunk something to play', () => {
    for (const chunk of CHUNKS) {
      for (const module of chunk.modules) {
        if (module.type !== 'tracker') continue
        const lanes = Object.values(module.data ?? {})
        expect(lanes.length, `${chunk.id}/${module.id} has no pattern`).toBeGreaterThan(0)
        expect(
          lanes.some((lane) => lane.some((step) => step !== 0)),
          `${chunk.id}/${module.id} is all rests`,
        ).toBe(true)
      }
    }
  })

  it('drives that sequencer from something', () => {
    // A pattern with no clock is the same silence by a different route.
    for (const chunk of CHUNKS) {
      for (const module of chunk.modules) {
        if (module.type !== 'tracker') continue
        const clocked =
          chunk.clocked?.some(([local]) => local === module.id) ||
          chunk.cables.some((c) => c.to[0] === module.id && c.to[1] === 'clock')
        expect(clocked, `${chunk.id}/${module.id} is never clocked`).toBe(true)
      }
    }
  })

  it('reaches its own stated output from the thing that makes the sound', () => {
    // Every chunk's output must be downstream of something. A chunk whose output port belongs to a module
    // nothing feeds is silent however well the rest of it is wired.
    for (const chunk of CHUNKS) {
      const fed = new Set(chunk.cables.map((c) => c.to[0]))
      const source = chunk.output[0]
      const isSource = chunk.modules.find((m) => m.id === source)?.type === 'noise'
      expect(fed.has(source) || isSource, `${chunk.id}: nothing feeds ${source}`).toBe(true)
    }
  })
})

describe('inserting a chunk with routings', () => {
  const COMBI = chunkById('combi')!

  it('rewrites both ends of a routing to the ids it handed out', () => {
    const { patch, ids } = insert(EMPTY_PATCH, 'combi')
    expect(patch.modulation).toHaveLength(COMBI.modulation!.length)
    for (const [index, route] of patch.modulation!.entries()) {
      const original = COMBI.modulation![index]
      expect(route.from).toEqual([ids[original.from[0]], original.from[1]])
      expect(route.to).toEqual([ids[original.to[0]], original.to[1]])
    }
  })

  it('gives two copies two independent sets of routings', () => {
    // The property the whole id-rewriting exists for, one level up from the cables. Without it the second
    // Combinator's rotaries would drive the first voice and the second voice would have no macros at all.
    const once = insert(EMPTY_PATCH, 'combi')
    const twice = insert(once.patch, 'combi')
    expect(twice.patch.modulation).toHaveLength(COMBI.modulation!.length * 2)

    const combis = new Set(twice.patch.modulation!.map((route) => route.from[0]))
    const targets = new Set(twice.patch.modulation!.map((route) => route.to[0]))
    expect(combis.size).toBe(2)
    // Two Combinators, and between them they reach two separate sets of modules.
    expect(targets.size).toBe(new Set(COMBI.modulation!.map((r) => r.to[0])).size * 2)
  })

  it('leaves modulation absent when the chunk has none', () => {
    // A patch that never had routings must not start carrying an empty array into everybody's saved file.
    const { patch } = insert(EMPTY_PATCH, 'sub')
    expect('modulation' in patch).toBe(false)
  })

  it('keeps routings a patch already had', () => {
    const first = insert(EMPTY_PATCH, 'combi')
    const second = insert(first.patch, 'sub')
    expect(second.patch.modulation).toHaveLength(COMBI.modulation!.length)
  })

  it('plays what its rotaries say the moment it is dropped in', () => {
    // The point of shipping a wired Combi rather than an empty Combinator: the compiler applies the
    // routing, so the first sound is the one the macro positions describe.
    const { patch, ids } = insert(EMPTY_PATCH, 'combi')
    const plan = compile(patch, MODULES)
    const ladder = ids.ladder
    const cutoff = plan.params[plan.slots[ladder].cutoff].value
    const route = COMBI.modulation!.find((r) => r.to[1] === 'cutoff')!
    expect(cutoff).toBeGreaterThanOrEqual(route.min!)
    expect(cutoff).toBeLessThanOrEqual(route.max!)
  })
})
