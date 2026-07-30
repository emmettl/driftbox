import { MODULES, compile, patchPresetById, type Patch } from '@driftbox/rack'
import { beforeEach, describe, expect, it } from 'vitest'
import { STARTER, useRack } from './store.js'

/** A small, stable fixture for tests that need *a* patch rather than *the* starter — the starter is now a
 *  three-Out drum-and-bass patch, and tests that assumed its shape broke when it changed. */
const ACID = () => patchPresetById('acid')!.build()

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
    // The first and last as they actually are, rather than two ids that happened to be first and last in the
    // patch this fixture used to be. Hardcoding them meant the test moved a middle module and passed for the
    // wrong reason the day the starter changed.
    const order = () => useRack.getState().patch.modules.map((m) => m.id)
    const start = order()
    useRack.getState().moveModule(start[0], -1)
    expect(order()).toEqual(start)
    useRack.getState().moveModule(start[start.length - 1], 1)
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

describe('making somewhere to put a break', () => {
  // Clicking a break used to do nothing at all when the patch had no Sampler: there was a hint saying to add one,
  // and the button stayed enabled and silently no-opped. For an instrument whose aim is being fun in four seconds,
  // being told to assemble three modules first is the opposite of that.

  it('adds a sampler wired to a transport and an out', () => {
    useRack.setState({ patch: { modules: [], cables: [] }, revision: 0 })
    const id = useRack.getState().ensureSampler()
    const patch = useRack.getState().patch

    expect(patch.modules.map((m) => m.type).sort()).toEqual(['out', 'sampler', 'transport'])
    const cables = patch.cables.map((c) => `${c.from.join('.')}>${c.to.join('.')}`)
    // A sixteenth into the trigger is the chop; the bar ramp into the slice inlet steps through the break in
    // order. One slice per sixteenth is what a one-bar break at sixteen slices is built for.
    expect(cables).toContain(`transport-1.sixteenth>${id}.trig`)
    expect(cables).toContain(`transport-1.bar>${id}.slice`)
    expect(cables).toContain(`${id}.out>out-1.in`)
  })

  it('reuses the transport and out already in the patch', () => {
    // A second Out would sum alongside the first and a second Transport would only agree with it.
    //
    // A named preset rather than `STARTER()`. This used to ride on whatever the starter happened to be, and
    // broke the day it became a patch with three Outs — which says nothing about `ensureSampler` and
    // everything about the fixture. What this needs is a patch with exactly one of each, so it says so.
    useRack.setState({ patch: ACID(), revision: 0 })
    useRack.getState().ensureSampler()
    const patch = useRack.getState().patch
    expect(patch.modules.filter((m) => m.type === 'out')).toHaveLength(1)
    expect(patch.modules.filter((m) => m.type === 'transport')).toHaveLength(1)
  })

  it('never rearranges a patch that already has a sampler', () => {
    const withOne: Patch = {
      modules: [{ id: 'mine', type: 'sampler' }],
      cables: [],
    }
    useRack.setState({ patch: withOne, revision: 5 })
    expect(useRack.getState().ensureSampler()).toBe('mine')
    expect(useRack.getState().patch).toBe(withOne)
    // And it did not count as an edit.
    expect(useRack.getState().revision).toBe(5)
  })

  it('wires a keyboard into whatever voice is already there', () => {
    // Pressing a key on a rack with no MIDI module used to be indistinguishable from a broken keyboard,
    // which is the same bug loading a break with no sampler had.
    useRack.setState({ patch: STARTER(), revision: 0 })
    const id = useRack.getState().ensureMidi()!
    const patch = useRack.getState().patch
    const cables = patch.cables.map((c) => `${c.from.join('.')}>${c.to.join('.')}`)
    const vco = patch.modules.find((m) => m.type === 'vco')!
    const adsr = patch.modules.find((m) => m.type === 'adsr')!
    expect(cables).toContain(`${id}.pitch>${vco.id}.pitch`)
    expect(cables).toContain(`${id}.gate>${adsr.id}.gate`)
  })

  it('takes over the pitch inlet rather than summing into it', () => {
    // One cable per inlet is the rule the compiler enforces and `connect` mirrors, and it is what dragging
    // a cable onto an occupied input does in Reason. Two sources into a pitch inlet would SUM, which is a
    // wrong note rather than an obvious break — much worse, because it sounds like the patch is fine.
    useRack.setState({ patch: STARTER(), revision: 0 })
    const before = useRack.getState().patch
    const vco = before.modules.find((m) => m.type === 'vco')!
    // The starter patch has its sequencer driving the VCO, so there is something to displace.
    expect(before.cables.filter((c) => c.to[0] === vco.id && c.to[1] === 'pitch')).toHaveLength(1)

    useRack.getState().ensureMidi()
    const after = useRack.getState().patch
    const intoPitch = after.cables.filter((c) => c.to[0] === vco.id && c.to[1] === 'pitch')
    expect(intoPitch).toHaveLength(1)
    expect(intoPitch[0].from[1]).toBe('pitch')
    expect(after.modules.find((m) => m.id === intoPitch[0].from[0])!.type).toBe('midi')
  })

  it('gates a VCA directly when there is no envelope to open', () => {
    // Otherwise a patch with no ADSR would drone: the note would change pitch and nothing would ever
    // articulate it.
    const patch: Patch = {
      modules: [
        { id: 'vco-1', type: 'vco' },
        { id: 'vca-1', type: 'vca' },
      ],
      cables: [],
    }
    useRack.setState({ patch, revision: 0 })
    const id = useRack.getState().ensureMidi()!
    const cables = useRack.getState().patch.cables.map((c) => `${c.from.join('.')}>${c.to.join('.')}`)
    // The GATE, not the pitch. Inferring the source port from the target's id sent pitch here at first,
    // which is a drone at the wrong note rather than a note.
    expect(cables).toContain(`${id}.gate>vca-1.cv`)
  })

  it('declines rather than adding a keyboard with nothing to play', () => {
    // A MIDI module wired to nothing is exactly the silent no-op this exists to prevent, so absence has to
    // read as absence and let the UI say so.
    useRack.setState({ patch: { modules: [], cables: [] }, revision: 0 })
    expect(useRack.getState().ensureMidi()).toBeNull()
    expect(useRack.getState().patch.modules).toHaveLength(0)
    expect(useRack.getState().revision).toBe(0)
  })

  it('never rearranges a patch that already has a keyboard', () => {
    const withOne: Patch = {
      modules: [{ id: 'mine', type: 'midi' }, { id: 'vco-1', type: 'vco' }],
      cables: [],
    }
    useRack.setState({ patch: withOne, revision: 5 })
    expect(useRack.getState().ensureMidi()).toBe('mine')
    expect(useRack.getState().patch).toBe(withOne)
    expect(useRack.getState().revision).toBe(5)
  })

  it('is structural, because the graph gains modules', () => {
    useRack.setState({ patch: { modules: [], cables: [] }, revision: 0 })
    useRack.getState().ensureSampler()
    expect(useRack.getState().revision).toBe(1)
  })

  it('produces a patch that compiles with nothing dropped', () => {
    // The wiring is written by hand here, so it is exactly the sort of thing that goes stale when a port is
    // renamed — and the compiler's own notes are the assertion.
    useRack.setState({ patch: { modules: [], cables: [] }, revision: 0 })
    useRack.getState().ensureSampler()
    const plan = compile(useRack.getState().patch, MODULES)
    expect(plan.notes.filter((n) => n.kind === 'dropped-cable')).toEqual([])
    expect(plan.notes.filter((n) => n.kind === 'placeholder')).toEqual([])
    expect(plan.outputs.length).toBeGreaterThan(0)
  })
})
