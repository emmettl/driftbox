import { describe, expect, it } from 'vitest'
import { applyModulation, routeValue, routedParams, sourcePosition } from './modulation.js'
import { compile } from './compile.js'
import { COMBI_ROTARY_MAX } from './modules/combi.js'
import { MODULES } from './modules/index.js'
import type { ModRoute, Patch } from './types.js'

// Combinator routing. The rules being pinned here are the ones that are cheap to get wrong and expensive
// to find: which of two routes onto one target wins, what a route onto a stepped param lands on, and what
// happens to a route this build cannot resolve.

const value = (patch: Patch, moduleId: string, paramId: string): number | undefined =>
  patch.modules.find((module) => module.id === moduleId)?.params?.[paramId]

/**
 * What a param *effectively* reads — the saved value, or the def's default when nothing was saved.
 *
 * Needed because `applyModulation` deliberately does not write a value that is already correct, so a route
 * landing exactly on a param's default leaves the patch with no entry for it. That is the identity rule
 * doing its job rather than a gap: writing `shape: 0` over an absent `shape` would mint a new patch object
 * and re-render the rack for no change.
 */
const effective = (patch: Patch, moduleId: string, paramId: string): number | undefined => {
  const saved = value(patch, moduleId, paramId)
  if (saved !== undefined) return saved
  const module = patch.modules.find((candidate) => candidate.id === moduleId)
  return module ? MODULES[module.type]?.params.find((p) => p.id === paramId)?.default : undefined
}

/** A rack with a Combinator and something to point it at. */
const patch = (modulation: ModRoute[], rotary = COMBI_ROTARY_MAX): Patch => ({
  modules: [
    { id: 'combi-1', type: 'combi', params: { rotary1: rotary } },
    { id: 'ladder-1', type: 'ladder' },
    { id: 'vco-1', type: 'vco' },
  ],
  cables: [],
  modulation,
})

const cutoff = MODULES.ladder.params.find((param) => param.id === 'cutoff')!

describe('applyModulation', () => {
  it('puts the target at the top of the route when the rotary is up', () => {
    const applied = applyModulation(
      patch([{ from: ['combi-1', 'rotary1'], to: ['ladder-1', 'cutoff'], min: 200, max: 8000 }]),
      MODULES,
    )
    expect(value(applied, 'ladder-1', 'cutoff')).toBe(8000)
  })

  it('puts it at the bottom when the rotary is down', () => {
    const applied = applyModulation(
      patch([{ from: ['combi-1', 'rotary1'], to: ['ladder-1', 'cutoff'], min: 200, max: 8000 }], 0),
      MODULES,
    )
    expect(value(applied, 'ladder-1', 'cutoff')).toBe(200)
  })

  it('interpolates linearly in between', () => {
    const applied = applyModulation(
      patch(
        [{ from: ['combi-1', 'rotary1'], to: ['ladder-1', 'cutoff'], min: 0, max: 1000 }],
        // A rotary runs 0..127, so half of it is not a round number — which is the point of normalising
        // against the source's own range rather than assuming 0..1.
        Math.round(COMBI_ROTARY_MAX / 2),
      ),
      MODULES,
    )
    expect(value(applied, 'ladder-1', 'cutoff')).toBeCloseTo(1000 * (64 / 127), 6)
  })

  it('inverts when min is above max, which is how one rotary closes one thing while opening another', () => {
    const applied = applyModulation(
      patch([{ from: ['combi-1', 'rotary1'], to: ['ladder-1', 'cutoff'], min: 8000, max: 200 }]),
      MODULES,
    )
    expect(value(applied, 'ladder-1', 'cutoff')).toBe(200)
  })

  it('falls back to the target’s own range when an end is absent', () => {
    const applied = applyModulation(
      patch([{ from: ['combi-1', 'rotary1'], to: ['ladder-1', 'cutoff'] }]),
      MODULES,
    )
    expect(value(applied, 'ladder-1', 'cutoff')).toBe(cutoff.max)
  })

  it('clamps a route that reaches past what the target can do', () => {
    const applied = applyModulation(
      patch([
        { from: ['combi-1', 'rotary1'], to: ['ladder-1', 'cutoff'], min: 0, max: cutoff.max * 10 },
      ]),
      MODULES,
    )
    expect(value(applied, 'ladder-1', 'cutoff')).toBe(cutoff.max)
  })

  it('rounds onto a stepped target, so a waveform selector lands on a waveform', () => {
    // Two thirds of the way between saw and pulse is not a sound, which is the whole reason `stepped`
    // exists — and a routing has to honour it or it would produce exactly the flicker that flag prevents.
    const shape = MODULES.vco.params.find((param) => param.id === 'shape')!
    const landed = new Set<number>()
    for (const rotary of [0, 40, 80, COMBI_ROTARY_MAX]) {
      const applied = applyModulation(
        patch(
          [{ from: ['combi-1', 'rotary1'], to: ['vco-1', 'shape'], min: shape.min, max: shape.max }],
          rotary,
        ),
        MODULES,
      )
      const at = effective(applied, 'vco-1', 'shape')!
      expect(Number.isInteger(at)).toBe(true)
      landed.add(at)
    }
    // And it actually sweeps rather than rounding everything to one shape, which is the failure a
    // per-position integer check on its own would miss.
    expect(landed.size).toBeGreaterThan(1)
  })

  it('lets the later of two routes onto one target win, exactly as a second cable into one inlet does', () => {
    const applied = applyModulation(
      patch([
        { from: ['combi-1', 'rotary1'], to: ['ladder-1', 'cutoff'], min: 100, max: 100 },
        { from: ['combi-1', 'rotary1'], to: ['ladder-1', 'cutoff'], min: 900, max: 900 },
      ]),
      MODULES,
    )
    expect(value(applied, 'ladder-1', 'cutoff')).toBe(900)
  })

  it('chains: a route reading a param an earlier route wrote sees the new value', () => {
    const chained = applyModulation(
      {
        modules: [
          { id: 'combi-1', type: 'combi', params: { rotary1: COMBI_ROTARY_MAX } },
          { id: 'combi-2', type: 'combi', params: { rotary1: 0 } },
          { id: 'ladder-1', type: 'ladder' },
        ],
        cables: [],
        modulation: [
          // The first route drives the second Combinator's rotary all the way up...
          {
            from: ['combi-1', 'rotary1'],
            to: ['combi-2', 'rotary1'],
            min: 0,
            max: COMBI_ROTARY_MAX,
          },
          // ...and the second route, applied after it, must see that rather than where it started.
          { from: ['combi-2', 'rotary1'], to: ['ladder-1', 'cutoff'], min: 200, max: 8000 },
        ],
      },
      MODULES,
    )
    expect(value(chained, 'combi-2', 'rotary1')).toBe(COMBI_ROTARY_MAX)
    expect(value(chained, 'ladder-1', 'cutoff')).toBe(8000)
  })

  it('settles rather than oscillating when two routes point at each other', () => {
    // One pass, so a cycle is bounded by construction — the same trade `compile` makes when it breaks a
    // cycle in the cable graph. The assertion that matters is that this returns at all.
    const applied = applyModulation(
      {
        modules: [
          { id: 'combi-1', type: 'combi', params: { rotary1: COMBI_ROTARY_MAX, rotary2: 0 } },
        ],
        cables: [],
        modulation: [
          { from: ['combi-1', 'rotary1'], to: ['combi-1', 'rotary2'], min: 0, max: COMBI_ROTARY_MAX },
          { from: ['combi-1', 'rotary2'], to: ['combi-1', 'rotary1'], min: 0, max: COMBI_ROTARY_MAX },
        ],
      },
      MODULES,
    )
    expect(value(applied, 'combi-1', 'rotary2')).toBe(COMBI_ROTARY_MAX)
  })

  it('keeps a route it cannot resolve instead of deleting it', () => {
    // The placeholder rule, one level up. A route naming a param a newer build has must survive a round
    // trip through this one, or opening a patch in an older build and re-saving would demolish it.
    const unresolvable: ModRoute[] = [
      { from: ['combi-1', 'rotary1'], to: ['ladder-1', 'no-such-param'], min: 0, max: 1 },
      { from: ['combi-1', 'rotary1'], to: ['no-such-module', 'cutoff'], min: 0, max: 1 },
      { from: ['no-such-module', 'rotary1'], to: ['ladder-1', 'cutoff'], min: 0, max: 1 },
    ]
    const applied = applyModulation(patch(unresolvable), MODULES)
    expect(applied.modulation).toEqual(unresolvable)
    expect(value(applied, 'ladder-1', 'cutoff')).toBeUndefined()
  })

  it('refuses to drive a hidden param, because the host is already writing it', () => {
    // A MIDI module's note arrives from Web MIDI as a param the host owns. A routing at one would be a
    // second writer, which is the fight `ParamDef.hidden` was introduced to prevent.
    const applied = applyModulation(
      {
        modules: [
          { id: 'combi-1', type: 'combi', params: { rotary1: COMBI_ROTARY_MAX } },
          { id: 'midi-1', type: 'midi' },
        ],
        cables: [],
        modulation: [{ from: ['combi-1', 'rotary1'], to: ['midi-1', 'note'], min: 0, max: 60 }],
      },
      MODULES,
    )
    expect(value(applied, 'midi-1', 'note')).toBeUndefined()
  })

  it('hands back the very same object when nothing moved', () => {
    // Identity is the change signal everywhere in this app — the store diffs patches by reference and the
    // Graph compares data arrays by identity — so a pass that changed nothing must not mint a new patch.
    const none: Patch = { modules: [{ id: 'vco-1', type: 'vco' }], cables: [] }
    expect(applyModulation(none, MODULES)).toBe(none)

    const settled = applyModulation(
      patch([{ from: ['combi-1', 'rotary1'], to: ['ladder-1', 'cutoff'], min: 200, max: 8000 }]),
      MODULES,
    )
    expect(applyModulation(settled, MODULES)).toBe(settled)
  })

  it('leaves modules no route points at untouched, by reference', () => {
    const before = patch([
      { from: ['combi-1', 'rotary1'], to: ['ladder-1', 'cutoff'], min: 200, max: 8000 },
    ])
    const vco = before.modules.find((module) => module.id === 'vco-1')
    const after = applyModulation(before, MODULES)
    expect(after.modules.find((module) => module.id === 'vco-1')).toBe(vco)
  })

  it('survives a patch with nothing in it, and rubbish in the routing list', () => {
    expect(() =>
      applyModulation(
        {
          modules: [],
          cables: [],
          modulation: [null, 7, { from: ['a'] }, {}] as unknown as ModRoute[],
        },
        MODULES,
      ),
    ).not.toThrow()
  })
})

describe('sourcePosition', () => {
  it('normalises against the source’s own range', () => {
    expect(sourcePosition(patch([], 0), MODULES, ['combi-1', 'rotary1'])).toBe(0)
    expect(sourcePosition(patch([], COMBI_ROTARY_MAX), MODULES, ['combi-1', 'rotary1'])).toBe(1)
  })

  it('reads the param’s default when the patch has never written it', () => {
    const bare: Patch = { modules: [{ id: 'combi-1', type: 'combi' }], cables: [] }
    // The rotary rests centred, so a route written across a target's whole range starts halfway.
    expect(sourcePosition(bare, MODULES, ['combi-1', 'rotary1'])).toBeCloseTo(64 / 127, 6)
  })

  it('is null for a source that is not there', () => {
    expect(sourcePosition(patch([]), MODULES, ['nope', 'rotary1'])).toBeNull()
    expect(sourcePosition(patch([]), MODULES, ['combi-1', 'nope'])).toBeNull()
  })

  it('clamps a saved value that is outside the range the def now declares', () => {
    // A patch from a build whose rotary went further. `compile` clamps params; this has to as well, or a
    // stale value would drive a route past both of its ends.
    const wild: Patch = {
      modules: [{ id: 'combi-1', type: 'combi', params: { rotary1: 9999 } }],
      cables: [],
    }
    expect(sourcePosition(wild, MODULES, ['combi-1', 'rotary1'])).toBe(1)
  })
})

describe('routeValue', () => {
  it('lands exactly on its own ends', () => {
    const route: ModRoute = { from: ['a', 'b'], to: ['c', 'd'], min: 400, max: 2000 }
    expect(routeValue(route, 0, cutoff)).toBe(400)
    expect(routeValue(route, 1, cutoff)).toBe(2000)
  })

  it('clamps an end the target cannot reach, rather than letting it out of range', () => {
    // A route written against a wider version of a module, or by hand. The target's own range wins — the
    // same rule `compile` applies to a saved knob position, and for the same reason.
    const below: ModRoute = { from: ['a', 'b'], to: ['c', 'd'], min: cutoff.min - 1000, max: 2000 }
    expect(routeValue(below, 0, cutoff)).toBe(cutoff.min)
  })
})

describe('routedParams', () => {
  it('reports every driven param, so a faceplate can mark it', () => {
    const map = routedParams(
      patch([
        { from: ['combi-1', 'rotary1'], to: ['ladder-1', 'cutoff'], min: 0, max: 1 },
        { from: ['combi-1', 'rotary2'], to: ['ladder-1', 'resonance'], min: 0, max: 1 },
      ]),
    )
    expect(map.get('ladder-1')).toEqual(new Set(['cutoff', 'resonance']))
    expect(map.has('vco-1')).toBe(false)
  })
})

describe('compile', () => {
  it('applies the routing, so a preset plays what its rotaries say without a host', () => {
    // The reason this lives in `compile` at all: a shipped patch, a shared link opened headlessly, and an
    // offline render all get here without a knob ever having been turned.
    const plan = compile(
      patch([{ from: ['combi-1', 'rotary1'], to: ['ladder-1', 'cutoff'], min: 200, max: 8000 }]),
      MODULES,
    )
    expect(plan.params[plan.slots['ladder-1'].cutoff].value).toBe(8000)
  })

  it('does not mutate the patch it was handed', () => {
    const before = patch([
      { from: ['combi-1', 'rotary1'], to: ['ladder-1', 'cutoff'], min: 200, max: 8000 },
    ])
    const snapshot = JSON.stringify(before)
    compile(before, MODULES)
    expect(JSON.stringify(before)).toBe(snapshot)
  })
})
