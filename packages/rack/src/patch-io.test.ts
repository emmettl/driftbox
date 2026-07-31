import { describe, expect, it } from 'vitest'
import { PATCH_FORMAT, decodePatch, encodePatch } from './patch-io.js'
import type { Patch } from './types.js'

// A patch arrives from outside the program, so most of this is about what happens when it is
// wrong. The one test that matters more than the rest is the round trip through a build that
// does not have all the modules: that is the property protecting somebody from opening a newer
// patch, saving it, and finding it demolished.

const FULL: Patch = {
  break: 'amenish',
  modules: [
    { id: 'osc', type: 'vco', version: 1, params: { tune: -12, shape: 1, width: 0.3 }, pos: [0, 0] },
    { id: 'filter', type: 'ladder', version: 1, params: { cutoff: 940, resonance: 0.72 }, pos: [1, 0] },
    { id: 'out', type: 'out', params: { level: 0.65 }, pos: [2, 1] },
  ],
  cables: [
    { from: ['osc', 'out'], to: ['filter', 'in'] },
    { from: ['filter', 'out'], to: ['out', 'in'] },
    { from: ['osc', 'out'], to: ['filter', 'cutoff'] },
  ],
  groovebox: '{"v":5,"song":{"name":"retained exactly"}}',
}

const decode = (value: unknown) => decodePatch(JSON.stringify(value))

describe('writing and reading a patch', () => {
  it('round-trips everything a patch can hold', () => {
    // Every field of PatchModule and PatchCable, populated. The engine's song-io has the
    // equivalent test for the same reason: adding a field and forgetting one of the places
    // that rebuilds the object loses it silently, and the symptom is a knob — or here, a
    // module position — that works until you reload.
    const back = decodePatch(encodePatch(FULL))
    expect(back).toEqual(FULL)
  })

  it('is stable across a second trip', () => {
    const once = encodePatch(decodePatch(encodePatch(FULL))!)
    const twice = encodePatch(decodePatch(once)!)
    expect(twice).toBe(once)
  })

  it('writes the current format version', () => {
    expect(JSON.parse(encodePatch(FULL)).v).toBe(PATCH_FORMAT)
  })

  it('treats an empty rack as a patch', () => {
    // Unlike a song, which decodeSong gives up on when it has no patterns because a song with
    // no patterns cannot play. An empty rack is where everybody starts.
    expect(decodePatch(encodePatch({ modules: [], cables: [] }))).toEqual({
      modules: [],
      cables: [],
    })
  })

  it('accepts a patch somebody assembled by hand', () => {
    // No envelope, no versions, no positions — just modules and cables.
    expect(
      decode({
        modules: [{ id: 'a', type: 'vco' }],
        cables: [],
      }),
    ).toEqual({ modules: [{ id: 'a', type: 'vco' }], cables: [] })
  })

  it('keeps a portable break id but drops an unusable one', () => {
    expect(decode({ modules: [], cables: [], break: 'amenish' })?.break).toBe('amenish')
    expect(decode({ modules: [], cables: [], break: '' })?.break).toBeUndefined()
    expect(decode({ modules: [], cables: [], break: 7 })?.break).toBeUndefined()
  })

  it('refuses a format from the future rather than guessing at it', () => {
    expect(decodePatch(JSON.stringify({ v: PATCH_FORMAT + 1, patch: FULL }))).toBeNull()
  })

  it('retains an opaque future groovebox envelope without trying to understand it', () => {
    const future = '{"v":999,"song":{"future":true,"unknown":["kept",7]}}'
    const patch: Patch = { modules: [], cables: [], groovebox: future }
    expect(decodePatch(encodePatch(patch))?.groovebox).toBe(future)
  })

  it('gives up only on things that are not patches', () => {
    for (const junk of ['', 'null', '{', '[]', '7', '"a patch"', '{}', '{"modules":null}']) {
      expect(decodePatch(junk)).toBeNull()
    }
  })
})

describe('a patch from a build that is not this one', () => {
  it('survives a round trip with its unknown modules and params intact', () => {
    // The whole point. This build has never heard of a wavefolder and does not know what a
    // `fold` knob is; it must still hand back exactly what it was given, because the
    // alternative is that opening a link from a newer build and pressing save destroys it.
    const newer: Patch = {
      modules: [
        { id: 'osc', type: 'vco', version: 2, params: { tune: 5, subOctave: 1 } },
        { id: 'fold', type: 'wavefolder', version: 1, params: { fold: 0.8, symmetry: -0.2 } },
        { id: 'out', type: 'out', params: { level: 0.5 } },
      ],
      cables: [
        { from: ['osc', 'out'], to: ['fold', 'in'] },
        { from: ['fold', 'out'], to: ['out', 'in'] },
      ],
    }

    const text = encodePatch(newer)
    expect(decodePatch(text)).toEqual(newer)
    // And byte-identical after a save, which is the form the property is actually used in.
    expect(encodePatch(decodePatch(text)!)).toBe(text)
  })

  it('keeps a param id it does not recognise on a module it does', () => {
    const back = decode({
      modules: [{ id: 'osc', type: 'vco', params: { tune: 3, glide: 0.4 } }],
      cables: [],
    })
    expect(back?.modules[0].params).toEqual({ tune: 3, glide: 0.4 })
  })
})

describe('repairing a patch', () => {
  it('drops a module with no usable id or type', () => {
    const back = decode({
      modules: [
        null,
        7,
        { id: '' },
        { id: 'a' },
        { type: 'vco' },
        { id: 'ok', type: 'vco' },
        { id: 'b', type: '' },
      ],
      cables: [],
    })
    expect(back?.modules).toEqual([{ id: 'ok', type: 'vco' }])
  })

  it('keeps the first of two modules sharing an id', () => {
    const back = decode({
      modules: [
        { id: 'a', type: 'vco' },
        { id: 'a', type: 'ladder' },
      ],
      cables: [],
    })
    expect(back?.modules).toEqual([{ id: 'a', type: 'vco' }])
  })

  it('drops a cable whose endpoints are not in the file', () => {
    // Unlike an unknown module TYPE, which is kept: an endpoint naming an id nothing in the
    // patch has is corruption, and keeping it would mean it accumulated across every save
    // from here on.
    const back = decode({
      modules: [{ id: 'a', type: 'vco' }],
      cables: [
        { from: ['a', 'out'], to: ['ghost', 'in'] },
        { from: ['ghost', 'out'], to: ['a', 'pitch'] },
        { from: ['a', 'out'], to: ['a', 'pitch'] },
      ],
    })
    expect(back?.cables).toEqual([{ from: ['a', 'out'], to: ['a', 'pitch'] }])
  })

  it('drops a malformed cable', () => {
    const back = decode({
      modules: [
        { id: 'a', type: 'vco' },
        { id: 'b', type: 'out' },
      ],
      cables: [
        null,
        7,
        { from: 'a', to: 'b' },
        { from: ['a'], to: ['b', 'in'] },
        { from: ['a', 'out'] },
        { from: ['a', ''], to: ['b', 'in'] },
        { from: ['a', 'out'], to: ['b', 'in'] },
      ],
    })
    expect(back?.cables).toEqual([{ from: ['a', 'out'], to: ['b', 'in'] }])
  })

  it('deduplicates an identical cable', () => {
    // `compile` takes the last cable into a contested inlet, so an exact duplicate would show
    // up as a replaced-cable note for no reason at all.
    const back = decode({
      modules: [
        { id: 'a', type: 'vco' },
        { id: 'b', type: 'out' },
      ],
      cables: [
        { from: ['a', 'out'], to: ['b', 'in'] },
        { from: ['a', 'out'], to: ['b', 'in'] },
      ],
    })
    expect(back?.cables).toHaveLength(1)
  })

  it('drops a param that is not a number rather than coercing it', () => {
    // Number(null) is 0, which would quietly park a knob at the bottom of its range instead of
    // leaving it at its default. The same mistake song-io calls out.
    //
    // The check is `Number.isFinite` rather than `typeof === 'number'` even though a NaN or an
    // Infinity cannot actually arrive through JSON — there is no literal for either, and
    // `JSON.stringify` writes both as null. That is worth knowing rather than testing: the
    // predicate stays the strict one because the cost is nothing and the day this is handed an
    // object from somewhere other than JSON.parse is the day it matters.
    const back = decode({
      modules: [
        { id: 'a', type: 'vco', params: { tune: 3, bad: null, worse: 'loud', array: [1], deep: {} } },
      ],
      cables: [],
    })
    expect(back?.modules[0].params).toEqual({ tune: 3 })
  })

  it('leaves params off entirely when none of them survived', () => {
    const back = decode({
      modules: [{ id: 'a', type: 'vco', params: { bad: null } }],
      cables: [],
    })
    expect(back?.modules[0]).toEqual({ id: 'a', type: 'vco' })
    expect('params' in back!.modules[0]).toBe(false)
  })

  it('drops a position it cannot read', () => {
    for (const pos of [null, 'here', [1], [1, 'x'], [Number.NaN, 0], []]) {
      const back = decode({ modules: [{ id: 'a', type: 'vco', pos }], cables: [] })
      expect(back?.modules[0].pos).toBeUndefined()
    }
    expect(decode({ modules: [{ id: 'a', type: 'vco', pos: [2, -3] }], cables: [] })
      ?.modules[0].pos).toEqual([2, -3])
  })

  it('treats a nonsense version as absent, which means current', () => {
    for (const version of [0, -1, 1.5, 'two', null, Number.NaN]) {
      const back = decode({ modules: [{ id: 'a', type: 'vco', version }], cables: [] })
      expect(back?.modules[0].version).toBeUndefined()
    }
    expect(decode({ modules: [{ id: 'a', type: 'vco', version: 3 }], cables: [] })
      ?.modules[0].version).toBe(3)
  })

  it('does not clamp params, because it cannot know the range', () => {
    // Clamping belongs to `compile`, which has the defs. Doing it here would need a registry,
    // and a registry here is what would destroy an unknown module's settings.
    const back = decode({
      modules: [{ id: 'a', type: 'vco', params: { tune: 9999, width: -50 } }],
      cables: [],
    })
    expect(back?.modules[0].params).toEqual({ tune: 9999, width: -50 })
  })
})

describe('Combinator routings', () => {
  const withRoutes = (modulation: unknown) =>
    decode({
      modules: [
        { id: 'combi', type: 'combi' },
        { id: 'filter', type: 'ladder' },
      ],
      cables: [],
      modulation,
    })

  it('round-trips a routing', () => {
    const route = { from: ['combi', 'rotary1'], to: ['filter', 'cutoff'], min: 200, max: 8000 }
    expect(withRoutes([route])?.modulation).toEqual([route])
  })

  it('leaves modulation absent when there is none, so an older patch is byte-identical', () => {
    const patch: Patch = { modules: [{ id: 'a', type: 'vco' }], cables: [] }
    const back = decodePatch(encodePatch(patch))
    expect(back).toEqual(patch)
    expect('modulation' in (back ?? {})).toBe(false)
  })

  it('keeps a route to a param it has never heard of', () => {
    // Same rule as an unknown module type: it may belong to a newer version of that module, and
    // `applyModulation` skips what it cannot resolve rather than deleting it. This file has no registry
    // and so could not tell the difference anyway — which is the point.
    const route = { from: ['combi', 'rotary1'], to: ['filter', 'from-the-future'], min: 0, max: 1 }
    expect(withRoutes([route])?.modulation).toEqual([route])
  })

  it('drops a route naming a module the file does not contain', () => {
    // Unlike an unknown param, an unknown *id* is corruption with no repair — and keeping it would mean
    // it accumulated across every save from here on. Exactly what happens to a dangling cable.
    expect(withRoutes([{ from: ['ghost', 'rotary1'], to: ['filter', 'cutoff'], min: 0, max: 1 }])
      ?.modulation).toBeUndefined()
    expect(withRoutes([{ from: ['combi', 'rotary1'], to: ['ghost', 'cutoff'], min: 0, max: 1 }])
      ?.modulation).toBeUndefined()
  })

  it('leaves an end that is not a number absent rather than repairing it to zero', () => {
    // Zero would park the target at the bottom of its range and look like a routing that works but is
    // aimed wrong. Absent means the target's own limit, and only `applyModulation` knows what that is.
    const back = withRoutes([
      { from: ['combi', 'rotary1'], to: ['filter', 'cutoff'], min: null, max: 'loud' },
    ])
    expect(back?.modulation).toEqual([{ from: ['combi', 'rotary1'], to: ['filter', 'cutoff'] }])
  })

  it('survives rubbish in the routing list', () => {
    expect(withRoutes([null, 7, 'x', {}, { from: ['combi', 'rotary1'] }])?.modulation).toBeUndefined()
    expect(withRoutes('not a list')?.modulation).toBeUndefined()
  })
})
