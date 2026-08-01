import { MODULES } from '@driftbox/rack'
import { describe, expect, it } from 'vitest'
import {
  bindingsFor,
  ccValue,
  describeBinding,
  forget,
  learn,
  loadBindings,
  saveBindings,
  targets,
  type CcBinding,
  type Store,
} from './cc.js'

// All of this is pure and none of it needs a browser, which is the entire reason it is a separate file.
// Chrome refuses Web MIDI under automation, so any rule left inside the message handler could not be
// verified at all — the same argument `midiTargets` makes one file over.

/** A Store backed by a Map, which is what makes storage-as-a-parameter worth the argument. */
const memory = (initial?: string): Store => {
  const map = new Map<string, string>()
  if (initial !== undefined) map.set('driftbox.rack.cc.v1', initial)
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
  }
}

const binding = (over: Partial<CcBinding> = {}): CcBinding => ({
  cc: 74,
  channel: 0,
  module: 'combi-1',
  param: 'rotary1',
  ...over,
})

describe('learning', () => {
  it('replaces what a target had, so two knobs cannot both drive it', () => {
    // The invisible fault this prevents: the old controller carries on moving the parameter and nothing
    // on screen says why.
    const first = learn([], binding({ cc: 20 }))
    const second = learn(first, binding({ cc: 21 }))
    expect(second).toHaveLength(1)
    expect(second[0].cc).toBe(21)
  })

  it('lets one controller drive several targets', () => {
    // The useful way round, and it mirrors the rack: an inlet takes one cable, an outlet feeds many.
    const bindings = learn(learn([], binding({ param: 'rotary1' })), binding({ param: 'rotary2' }))
    expect(bindings).toHaveLength(2)
    expect(targets(bindings, 74, 1)).toHaveLength(2)
  })

  it('keeps bindings on other modules alone', () => {
    const bindings = learn(learn([], binding()), binding({ module: 'combi-2' }))
    expect(bindings).toHaveLength(2)
  })
})

describe('forgetting', () => {
  it('drops just that target', () => {
    const bindings = learn(learn([], binding({ param: 'rotary1' })), binding({ param: 'rotary2' }))
    expect(forget(bindings, 'combi-1', 'rotary1')).toHaveLength(1)
  })

  it('is a no-op for a target that never had one', () => {
    const bindings = learn([], binding())
    expect(forget(bindings, 'combi-1', 'rotary4')).toEqual(bindings)
  })
})

describe('routing an incoming controller', () => {
  it('hears any channel when bound to channel 0', () => {
    const bindings = learn([], binding({ channel: 0 }))
    for (const channel of [1, 7, 16]) expect(targets(bindings, 74, channel)).toHaveLength(1)
  })

  it('hears only its own channel when bound to one', () => {
    const bindings = learn([], binding({ channel: 3 }))
    expect(targets(bindings, 74, 3)).toHaveLength(1)
    expect(targets(bindings, 74, 4)).toHaveLength(0)
  })

  it('ignores a controller nothing was taught', () => {
    expect(targets(learn([], binding({ cc: 74 })), 75, 1)).toHaveLength(0)
  })
})

describe('what a controller value means', () => {
  const rotary = MODULES.combi.params.find((p) => p.id === 'rotary1')!
  const cutoff = MODULES.ladder.params.find((p) => p.id === 'cutoff')!
  const shape = MODULES.vco.params.find((p) => p.id === 'shape')!

  it('is the identity on a Combinator rotary, which is already 0..127', () => {
    // The reason the rotaries have that range at all — see `modules/combi.ts`.
    expect(ccValue(0, rotary)).toBe(0)
    expect(ccValue(64, rotary)).toBe(64)
    expect(ccValue(127, rotary)).toBe(127)
  })

  it('reaches both ends of a parameter in its own units', () => {
    expect(ccValue(0, cutoff)).toBe(cutoff.min)
    expect(ccValue(127, cutoff)).toBe(cutoff.max)
  })

  it('rounds onto a stepped parameter, so a selector lands on a value', () => {
    for (const raw of [0, 40, 90, 127]) expect(Number.isInteger(ccValue(raw, shape))).toBe(true)
    expect(ccValue(0, shape)).toBe(shape.min)
    expect(ccValue(127, shape)).toBe(shape.max)
  })

  it('clamps a controller value outside the range MIDI can send', () => {
    expect(ccValue(-5, cutoff)).toBe(cutoff.min)
    expect(ccValue(999, cutoff)).toBe(cutoff.max)
  })
})

describe('storage', () => {
  it('round-trips', () => {
    const store = memory()
    const bindings = learn([], binding())
    saveBindings(bindings, store)
    expect(loadBindings(store)).toEqual(bindings)
  })

  it('reads bindings saved under the former rack-only key', () => {
    expect(loadBindings(memory(JSON.stringify([binding()])))).toEqual([binding()])
  })

  it('is no bindings rather than an error when storage is unavailable', () => {
    // Private browsing, a blocked third-party context. Not worth a broken page in front of somebody who
    // just opened a synth.
    expect(loadBindings(null)).toEqual([])
    expect(() => saveBindings([binding()], null)).not.toThrow()
  })

  it('survives whatever an older build or a hand-edit left behind', () => {
    for (const text of ['', 'not json', '{}', '[1,2,3]', 'null']) {
      expect(loadBindings(memory(text))).toEqual([])
    }
  })

  it('drops entries it cannot use rather than the whole file', () => {
    // One corrupt binding should cost that binding, not every mapping somebody has taught.
    const mixed = JSON.stringify([binding(), { cc: 999 }, { cc: 5 }, binding({ cc: 20, param: 'rotary2' })])
    expect(loadBindings(memory(mixed))).toHaveLength(2)
  })

  it('refuses a controller number MIDI cannot send', () => {
    expect(loadBindings(memory(JSON.stringify([binding({ cc: 128 })])))).toEqual([])
    expect(loadBindings(memory(JSON.stringify([binding({ channel: 17 })])))).toEqual([])
  })

  it('does not throw when storage is full', () => {
    const full: Store = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
    }
    expect(() => saveBindings([binding()], full)).not.toThrow()
  })
})

describe('saying what is bound', () => {
  it('keys a module’s bindings by param', () => {
    const bindings = learn(learn([], binding({ param: 'rotary1' })), binding({ param: 'button1', cc: 20 }))
    const mine = bindingsFor(bindings, 'combi-1')
    expect(mine.get('rotary1')?.cc).toBe(74)
    expect(mine.get('button1')?.cc).toBe(20)
    expect(bindingsFor(bindings, 'combi-2').size).toBe(0)
  })

  it('reads short enough to sit under a knob', () => {
    expect(describeBinding(binding())).toBe('CC 74')
    expect(describeBinding(binding({ channel: 3 }))).toBe('CC 74 ch3')
  })
})
