import { MODULES, compile, decodePatch, encodePatch, patchPresetById, type Patch } from '@driftbox/rack'
import { beforeEach, describe, expect, it } from 'vitest'
import { matchingPreset, STARTER, useRack } from './store.js'

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
    // The hero's ladder cutoff is intentionally owned by its Combinator, so use an ordinary unrouted knob.
    const before = useRack.getState().revision
    useRack.getState().setParam('reverb-1', 'size', 0.6)

    expect(useRack.getState().paramValue('reverb-1', 'size')).toBe(0.6)
    expect(useRack.getState().revision).toBe(before)
  })

  it('still produces a new patch object, so React re-renders', () => {
    // The two requirements pull in opposite directions, which is why the revision counter exists at all
    // rather than a comparison of the patch.
    const before = useRack.getState().patch
    useRack.getState().setParam('reverb-1', 'size', 0.7)
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
    // A split is free in the buffer model — one buffer read by two readers — so nothing should stop it.
    useRack.getState().connect(['adsr-1', 'out'], ['ladder-1', 'res'])
    const from = useRack.getState().patch.cables.filter((c) => c.from[0] === 'adsr-1')
    expect(from).toHaveLength(2)
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

  it('recovers its catalogue identity after a save and loses it after an edit', () => {
    // Decoding rebuilds object fields in canonical order, which is not the order a preset factory writes
    // them. Identity is about the document, not JSON insertion order.
    const reopened = decodePatch(encodePatch(STARTER()))!
    expect(matchingPreset(reopened)?.name).toBe('Pressure System')

    const edited = {
      ...reopened,
      modules: reopened.modules.map((module) =>
        module.id === 'reverb-1'
          ? { ...module, params: { ...module.params, size: 0.61 } }
          : module,
      ),
    }
    expect(matchingPreset(edited)).toBeUndefined()
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

describe('Combinator routing', () => {
  /** A Combinator, a filter to drive, and one routing across the filter's cutoff. */
  const wired = (): Patch => ({
    modules: [
      { id: 'combi-1', type: 'combi', params: { rotary1: 0 } },
      { id: 'ladder-1', type: 'ladder' },
    ],
    cables: [],
    modulation: [{ from: ['combi-1', 'rotary1'], to: ['ladder-1', 'cutoff'], min: 200, max: 8000 }],
  })

  beforeEach(() => {
    useRack.setState({ patch: wired(), revision: 0, editingRoutes: null })
  })

  it('moves the target when the rotary moves', () => {
    // The whole feature in one assertion. And it happens through `setParam`, which means the driven value
    // reaches the audio thread by the path a knob already takes rather than by anything new.
    useRack.getState().setParam('combi-1', 'rotary1', 127)
    expect(useRack.getState().paramValue('ladder-1', 'cutoff')).toBe(8000)

    useRack.getState().setParam('combi-1', 'rotary1', 0)
    expect(useRack.getState().paramValue('ladder-1', 'cutoff')).toBe(200)
  })

  it('does not rebuild the graph to do it', () => {
    // A routing moves knobs and nothing else. Bumping the revision would recompile — resetting every
    // oscillator's phase and every filter's history — on each frame of a rotary drag.
    const before = useRack.getState().revision
    useRack.getState().setParam('combi-1', 'rotary1', 100)
    expect(useRack.getState().revision).toBe(before)
  })

  it('settles a patch the moment it is loaded, not on the first knob turn', () => {
    // A patch arriving from a link or a preset has to sound like its routing says straight away. Otherwise
    // the rack would sound different depending on whether anybody had touched a rotary yet.
    useRack.setState({ patch: { modules: [], cables: [] }, revision: 0 })
    const patch = wired()
    patch.modules[0].params = { rotary1: 127 }
    useRack.getState().load(patch)
    expect(useRack.getState().paramValue('ladder-1', 'cutoff')).toBe(8000)
  })

  it('adds a routing without rebuilding the graph, and applies it immediately', () => {
    const before = useRack.getState().revision
    useRack.getState().setParam('combi-1', 'rotary2', 127)
    useRack.getState().addRoute(['combi-1', 'rotary2'], ['ladder-1', 'resonance'])
    expect(useRack.getState().revision).toBe(before)
    // A fresh routing leaves both ends absent, meaning the target's own limits.
    expect(useRack.getState().paramValue('ladder-1', 'resonance')).toBe(
      MODULES.ladder.params.find((p) => p.id === 'resonance')!.max,
    )
  })

  it('changes one end of a routing', () => {
    useRack.getState().setParam('combi-1', 'rotary1', 127)
    useRack.getState().setRoute(0, { max: 1000 })
    expect(useRack.getState().paramValue('ladder-1', 'cutoff')).toBe(1000)
  })

  it('treats an erased end as the target’s own limit rather than as zero', () => {
    // Zero would aim the routing at the bottom of the range instead of the end of it, which looks like a
    // routing that works and is wrong.
    useRack.getState().setParam('combi-1', 'rotary1', 127)
    useRack.getState().setRoute(0, { max: undefined })
    expect(useRack.getState().patch.modulation?.[0].max).toBeUndefined()
    expect(useRack.getState().paramValue('ladder-1', 'cutoff')).toBe(
      MODULES.ladder.params.find((p) => p.id === 'cutoff')!.max,
    )
  })

  it('leaves the patch byte-identical to an unrouted one when the last routing goes', () => {
    useRack.getState().removeRoute(0)
    expect('modulation' in useRack.getState().patch).toBe(false)
  })

  it('leaves the knob where the routing last put it when the routing is removed', () => {
    // Same as unplugging a cable: what it was doing stops, what it had done stays. Snapping the knob back
    // to a value nobody chose would be the surprising option.
    useRack.getState().setParam('combi-1', 'rotary1', 127)
    useRack.getState().removeRoute(0)
    expect(useRack.getState().paramValue('ladder-1', 'cutoff')).toBe(8000)
  })

  it('takes every routing with the Combinator when it is deleted', () => {
    // A stale routing is quieter than a stale cable — `applyModulation` skips it without a word — so
    // leaving one behind would resurrect invisible modulation if a module took the same id later.
    useRack.getState().removeModule('combi-1')
    expect(useRack.getState().patch.modulation).toBeUndefined()
  })

  it('takes every routing with the target when the target is deleted', () => {
    useRack.getState().removeModule('ladder-1')
    expect(useRack.getState().patch.modulation).toBeUndefined()
  })

  it('ignores an index that is not there', () => {
    expect(() => useRack.getState().removeRoute(9)).not.toThrow()
    expect(() => useRack.getState().setRoute(-1, { min: 0 })).not.toThrow()
    expect(useRack.getState().patch.modulation).toHaveLength(1)
  })

  it('agrees with what the compiler will play', () => {
    // Two callers, one function. The store settles so the knob is seen to move; `compile` settles so a
    // patch that never went through a store still plays what its routing says. They must not disagree.
    useRack.getState().setParam('combi-1', 'rotary1', 90)
    const patch = useRack.getState().patch
    const plan = compile(patch, MODULES)
    expect(plan.params[plan.slots['ladder-1'].cutoff].value).toBe(
      useRack.getState().paramValue('ladder-1', 'cutoff'),
    )
  })
})

describe('learning a MIDI controller', () => {
  beforeEach(() => {
    useRack.setState({ ccBindings: [], ccLearning: null })
  })

  it('arms a parameter and binds the next controller to it', () => {
    useRack.getState().startCcLearn('combi-1', 'rotary1')
    expect(useRack.getState().ccLearning).toEqual({ module: 'combi-1', param: 'rotary1' })

    useRack.getState().finishCcLearn(74)
    expect(useRack.getState().ccLearning).toBeNull()
    expect(useRack.getState().ccBindings).toEqual([
      { cc: 74, channel: 0, module: 'combi-1', param: 'rotary1' },
    ])
  })

  it('ignores a controller when nothing is armed', () => {
    // Which is what every stray knob twiddle is. Binding on any incoming message would make the feature
    // impossible to leave switched on.
    useRack.getState().finishCcLearn(74)
    expect(useRack.getState().ccBindings).toEqual([])
  })

  it('replaces a target’s binding rather than adding a second', () => {
    // Two controllers driving one rotary is a fault you cannot see: the old one still moves it.
    useRack.getState().startCcLearn('combi-1', 'rotary1')
    useRack.getState().finishCcLearn(20)
    useRack.getState().startCcLearn('combi-1', 'rotary1')
    useRack.getState().finishCcLearn(21)
    expect(useRack.getState().ccBindings).toHaveLength(1)
    expect(useRack.getState().ccBindings[0].cc).toBe(21)
  })

  it('lets a learn be cancelled', () => {
    useRack.getState().startCcLearn('combi-1', 'rotary1')
    useRack.getState().cancelCcLearn()
    useRack.getState().finishCcLearn(74)
    expect(useRack.getState().ccBindings).toEqual([])
  })

  it('forgets one binding and leaves the rest', () => {
    for (const [param, cc] of [['rotary1', 20], ['rotary2', 21]] as const) {
      useRack.getState().startCcLearn('combi-1', param)
      useRack.getState().finishCcLearn(cc)
    }
    useRack.getState().clearCcBinding('combi-1', 'rotary1')
    expect(useRack.getState().ccBindings.map((b) => b.param)).toEqual(['rotary2'])
  })

  it('binds on every channel, so the knobs need not be on the keys’ channel', () => {
    useRack.getState().startCcLearn('combi-1', 'rotary1')
    useRack.getState().finishCcLearn(74)
    expect(useRack.getState().ccBindings[0].channel).toBe(0)
  })

  it('never puts a binding in the patch', () => {
    // The decision `cc.ts` defends: a patch travels in a URL and a binding describes somebody's desk.
    //
    // Reference identity is the proof — if the object did not change, nothing was added to it — plus the
    // encoded form, which is what actually travels. An earlier version of this searched the JSON for the
    // controller number and failed on the starter patch's `tempo: 174`, which is a good demonstration of
    // why a substring is not an assertion.
    const before = useRack.getState().patch
    const encodedBefore = encodePatch(before)
    useRack.getState().startCcLearn('combi-1', 'rotary1')
    useRack.getState().finishCcLearn(74)
    expect(useRack.getState().patch).toBe(before)
    expect(encodePatch(useRack.getState().patch)).toBe(encodedBefore)
  })
})

describe('an edit that changes nothing', () => {
  // The revision is what makes RackApp recompile, and recompiling rebuilds every processor — resetting
  // each oscillator's phase and each filter's history, which is audible. Several edits here are
  // legitimately no-ops, and before this they all rebuilt the graph to achieve nothing.
  beforeEach(() => {
    useRack.setState({ patch: STARTER(), revision: 0 })
  })

  it('does not rebuild the graph when a module is moved off the top', () => {
    const first = useRack.getState().patch.modules[0].id
    const before = useRack.getState().revision
    useRack.getState().moveModule(first, -1)
    expect(useRack.getState().revision).toBe(before)
  })

  it('does not rebuild the graph when a module is moved off the bottom', () => {
    const modules = useRack.getState().patch.modules
    const before = useRack.getState().revision
    useRack.getState().moveModule(modules[modules.length - 1].id, 1)
    expect(useRack.getState().revision).toBe(before)
  })

  it('does not rebuild the graph when a drag ends where it started', () => {
    // Read where it is rather than assuming. The first version of this dropped `ladder-1` at index 5,
    // which is exactly where the starter already has it — so the "now move it" step was itself a no-op
    // and the test failed for the opposite of the reason it looked like.
    const at = () => useRack.getState().patch.modules.findIndex((m) => m.id === 'ladder-1')
    expect(at()).toBeGreaterThan(0)

    const before = useRack.getState().revision
    // Dropping at its own index, and at the one just after, are both "stay put" — the insertion index is
    // in the *original* list, so `from + 1` is the gap it already occupies.
    useRack.getState().dropModule('ladder-1', at())
    useRack.getState().dropModule('ladder-1', at() + 1)
    expect(useRack.getState().revision).toBe(before)
  })

  it('still rebuilds when a drag actually moves something', () => {
    const before = useRack.getState().revision
    useRack.getState().dropModule('ladder-1', 0)
    expect(useRack.getState().revision).toBe(before + 1)
    expect(useRack.getState().patch.modules[0].id).toBe('ladder-1')
  })

  it('ignores a drop naming a module that is not there', () => {
    const before = useRack.getState().revision
    useRack.getState().dropModule('nobody', 0)
    expect(useRack.getState().revision).toBe(before)
  })
})

describe('writing a pattern', () => {
  beforeEach(() => {
    useRack.setState({ patch: STARTER(), revision: 0 })
  })

  it('writes a lane without rebuilding the graph', () => {
    // The whole reason this is not structural. Pattern data is compiled into the plan, so treating an edit
    // as structural would rebuild every processor on every cell touched — a click per edit, and a
    // continuous crackle while dragging a value.
    const before = useRack.getState().revision
    useRack.getState().setLane('tracker-1', 1, [1, 0, 2, 0])
    expect(useRack.getState().revision).toBe(before)
    expect(useRack.getState().lane('tracker-1', 1)).toEqual([1, 0, 2, 0])
  })

  it('still produces a new patch object, so React re-renders and it autosaves', () => {
    const before = useRack.getState().patch
    useRack.getState().setLane('tracker-1', 0, [5])
    expect(useRack.getState().patch).not.toBe(before)
  })

  it('leaves the other lanes alone', () => {
    const other = useRack.getState().lane('tracker-1', 1)
    useRack.getState().setLane('tracker-1', 0, [9, 9, 9])
    expect(useRack.getState().lane('tracker-1', 1)).toEqual(other)
  })

  it('copies what it is given, so a caller cannot mutate the patch afterwards', () => {
    // The store is immutable throughout and a shared array would be a hole in that — the editor builds its
    // next array from the current one, so handing the same reference back would alias the patch.
    const values = [1, 2, 3]
    useRack.getState().setLane('tracker-1', 0, values)
    values[0] = 99
    expect(useRack.getState().lane('tracker-1', 0)).toEqual([1, 2, 3])
  })

  it('is an empty array for a lane nothing has written', () => {
    // The hero's musical Tracker uses all four lanes; its second Tracker uses three for the Alligator.
    expect(useRack.getState().lane('tracker-1', 3)).toEqual([])
    expect(useRack.getState().lane('nobody', 0)).toEqual([])
  })

  it('survives a patch with no tracker in it', () => {
    useRack.setState({ patch: { modules: [], cables: [] }, revision: 0 })
    expect(() => useRack.getState().setLane('tracker-1', 0, [1])).not.toThrow()
  })

  it('writes a slot that is not a lane, on the same terms', () => {
    // The Arranger's sections are the case: not lanes, but the same kind of thing — an array a module reads
    // at audio rate and edits while it plays. If this ever became structural, editing a song would rebuild
    // every processor in the rack, which is a click on every section you touch.
    const before = useRack.getState().revision
    useRack.getState().setData('tracker-1', 'patterns', [0, 1, 0, 2])
    expect(useRack.getState().revision).toBe(before)
    expect(useRack.getState().data('tracker-1', 'patterns')).toEqual([0, 1, 0, 2])
  })

  it('leaves a lane alone when a named slot is written, and the other way round', () => {
    useRack.getState().setLane('tracker-1', 0, [3, 3])
    useRack.getState().setData('tracker-1', 'repeats', [4, 4])
    expect(useRack.getState().lane('tracker-1', 0)).toEqual([3, 3])
    expect(useRack.getState().data('tracker-1', 'repeats')).toEqual([4, 4])
  })
})
