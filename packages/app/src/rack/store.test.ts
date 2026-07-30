import { MODULES } from '@driftbox/rack'
import { beforeEach, describe, expect, it } from 'vitest'
import { STARTER, useRack } from './store.js'

// The one behaviour here worth protecting with a test is that a knob turn is not a patch change. Everything
// else in this file is bookkeeping; that one is the difference between a knob that works and a continuous
// crackle while somebody drags it.

beforeEach(() => {
  useRack.setState({ patch: STARTER(), revision: 0, selected: null, flipped: false, notes: [], name: null })
})

describe('turning a knob', () => {
  it('changes the value without bumping the revision', () => {
    // `revision` is what tells RackApp to recompile. A knob must never do that: recompiling rebuilds every
    // processor, which resets each oscillator's phase and each filter's history.
    const before = useRack.getState().revision
    useRack.getState().setParam('ladder-1', 'cutoff', 2400)

    expect(useRack.getState().paramValue('ladder-1', 'cutoff')).toBe(2400)
    expect(useRack.getState().revision).toBe(before)
  })

  it('still produces a new patch object, so React re-renders', () => {
    // The two requirements pull in opposite directions, which is why the revision counter exists at all
    // rather than a comparison of the patch.
    const before = useRack.getState().patch
    useRack.getState().setParam('ladder-1', 'cutoff', 900)
    expect(useRack.getState().patch).not.toBe(before)
  })

  it('reads a default from the def when nothing has been saved', () => {
    useRack.setState({ patch: { modules: [{ id: 'a', type: 'svf' }], cables: [] } })
    expect(useRack.getState().paramValue('a', 'cutoff')).toBe(
      MODULES.svf.params.find((p) => p.id === 'cutoff')!.default,
    )
  })

  it('gives zero rather than throwing for a param that does not exist', () => {
    expect(useRack.getState().paramValue('nobody', 'nothing')).toBe(0)
  })
})

describe('editing the rack', () => {
  it('bumps the revision for anything structural', () => {
    const at = () => useRack.getState().revision
    const start = at()

    useRack.getState().addModule('vco')
    expect(at()).toBe(start + 1)
    useRack.getState().connect(['vco-2', 'out'], ['ladder-1', 'in'])
    expect(at()).toBe(start + 2)
    useRack.getState().moveModule('vco-2', -1)
    expect(at()).toBe(start + 3)
    useRack.getState().removeModule('vco-2')
    expect(at()).toBe(start + 4)
  })

  it('numbers a new module rather than inventing an id', () => {
    // The id decides what a Noise module sounds like, because anything random in the rack seeds from it —
    // so it must be a function of the patch and not of the clock.
    useRack.setState({ patch: { modules: [], cables: [] } })
    useRack.getState().addModule('vco')
    useRack.getState().addModule('vco')
    expect(useRack.getState().patch.modules.map((m) => m.id)).toEqual(['vco-1', 'vco-2'])
  })

  it('reuses a gap in the numbering', () => {
    useRack.setState({
      patch: { modules: [{ id: 'vco-1', type: 'vco' }, { id: 'vco-3', type: 'vco' }], cables: [] },
    })
    useRack.getState().addModule('vco')
    expect(useRack.getState().patch.modules[2].id).toBe('vco-2')
  })

  it('takes a module’s cables with it', () => {
    // The compiler would drop them anyway, but leaving them in the patch means they come back if a module
    // is re-added under the same id, which looks like a haunting.
    useRack.getState().removeModule('ladder-1')
    const patch = useRack.getState().patch
    expect(patch.modules.some((m) => m.id === 'ladder-1')).toBe(false)
    expect(patch.cables.some((c) => c.from[0] === 'ladder-1' || c.to[0] === 'ladder-1')).toBe(false)
  })

  it('replaces a cable into an occupied inlet rather than stacking one on top', () => {
    // One cable per inlet, matching the compiler. Keeping both would mean the patch carried a cable that
    // existed only to be discarded, and the picture would show two where one is heard.
    useRack.getState().connect(['clock-1', 'trig'], ['vca-1', 'cv'])
    const into = useRack
      .getState()
      .patch.cables.filter((c) => c.to[0] === 'vca-1' && c.to[1] === 'cv')
    expect(into).toHaveLength(1)
    expect(into[0].from).toEqual(['clock-1', 'trig'])
  })

  it('allows several cables out of one outlet', () => {
    // A split is free in the buffer model — one buffer read by three readers — so nothing should stop it.
    useRack.getState().connect(['adsr-1', 'out'], ['ladder-1', 'res'])
    const from = useRack.getState().patch.cables.filter((c) => c.from[0] === 'adsr-1')
    expect(from.length).toBeGreaterThan(2)
  })

  it('unpatches exactly the cable it was given', () => {
    const cable = useRack.getState().patch.cables[0]
    const before = useRack.getState().patch.cables.length
    useRack.getState().disconnect(cable)
    expect(useRack.getState().patch.cables).toHaveLength(before - 1)
    expect(useRack.getState().patch.cables).not.toContain(cable)
  })

  it('refuses to move a module off either end', () => {
    const order = () => useRack.getState().patch.modules.map((m) => m.id)
    const start = order()
    useRack.getState().moveModule('clock-1', -1)
    expect(order()).toEqual(start)
    useRack.getState().moveModule('out-1', 1)
    expect(order()).toEqual(start)
  })
})

describe('the starter patch', () => {
  it('makes a sound rather than being an empty rack', () => {
    // An empty rack is a correct empty state and a terrible first impression: a modular with nothing in it
    // does not hint at what it is for. This is the shortest description of what the rack can do.
    expect(STARTER().modules.length).toBeGreaterThan(4)
    expect(STARTER().cables.length).toBeGreaterThan(4)
    expect(STARTER().modules.some((m) => m.type === 'out')).toBe(true)
  })

  it('is a fresh object each time, so editing it cannot corrupt the shipped patch', () => {
    expect(STARTER()).not.toBe(STARTER())
    expect(STARTER()).toEqual(STARTER())
  })

  it('only uses modules and ports this build actually has', () => {
    for (const module of STARTER().modules) {
      expect(MODULES[module.type], module.type).toBeDefined()
      for (const id of Object.keys(module.params ?? {})) {
        expect(
          MODULES[module.type].params.some((p) => p.id === id),
          `${module.type}.${id}`,
        ).toBe(true)
      }
    }
    const starter = STARTER()
    for (const cable of starter.cables) {
      const from = starter.modules.find((m) => m.id === cable.from[0])!
      const to = starter.modules.find((m) => m.id === cable.to[0])!
      expect(MODULES[from.type].outlets.some((p) => p.id === cable.from[1]), cable.from.join('.')).toBe(true)
      expect(MODULES[to.type].inlets.some((p) => p.id === cable.to[1]), cable.to.join('.')).toBe(true)
    }
  })
})
