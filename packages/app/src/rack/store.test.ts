import { AUTOMATION_TARGET, SONGS, cycleStep, rotateTrack } from '@driftbox/engine'
import { NO_HISTORY } from './history.js'
import {
  MODULES,
  compile,
  decodePatch,
  embedGrooveboxSong,
  encodePatch,
  grooveboxSong,
  patchCompatibility,
  patchPresetById,
  type Patch,
} from '@driftbox/rack'
import { beforeEach, describe, expect, it } from 'vitest'
import { matchingPreset, STARTER, useRack } from './store.js'

/** A small, stable fixture for tests that need *a* patch rather than *the* starter — the starter is now a
 *  three-Out drum-and-bass patch, and tests that assumed its shape broke when it changed. */
const ACID = () => patchPresetById('acid')!.build()

// The one behaviour here worth protecting with a test is that a knob turn is not a patch change. Everything
// else in this file is bookkeeping; that one is the difference between a knob that works and a continuous
// crackle while somebody drags it.

beforeEach(() => {
  useRack.setState({
    patch: STARTER(),
    revision: 0,
    history: NO_HISTORY,
    selection: [],
    flipped: false,
    notes: [],
    name: null,
    grooveboxLauncher: null,
    grooveboxLaunches: {},
    grooveboxLaunchQuantization: 'bar',
    grooveboxTransport: null,
    grooveboxLoop: null,
    grooveboxAutomationRecording: false,
    grooveboxAutomationPosition: null,
    grooveboxTapRecording: false,
    grooveboxTapTarget: null,
    grooveboxTapStep: 0,
  })
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

describe('selecting several modules', () => {
  // Reordering and removal were one module at a time, which `docs/REASON-GAP.md` lists as the multi-select
  // gap. The interesting part is not the list but what happens at its edges: a range with no anchor, an
  // anchor that has been removed, and a group removal that has to be a single undo step.

  beforeEach(() => {
    useRack.setState({
      patch: {
        modules: ['a', 'b', 'c', 'd'].map((id) => ({ id: `vco-${id}`, type: 'vco' })),
        cables: [{ from: ['vco-a', 'out'], to: ['vco-b', 'fm'] }],
      },
      revision: 0,
      history: NO_HISTORY,
      selection: [],
    })
  })

  const ids = () => [...useRack.getState().selection].sort()

  it('replaces the selection on an ordinary click', () => {
    useRack.getState().select('vco-a')
    useRack.getState().select('vco-c')
    expect(useRack.getState().selection).toEqual(['vco-c'])
  })

  it('adds to it when extending, and takes back out', () => {
    // Toggling is the half people reach for immediately after picking one thing too many.
    useRack.getState().select('vco-a')
    useRack.getState().select('vco-c', true)
    expect(ids()).toEqual(['vco-a', 'vco-c'])
    useRack.getState().select('vco-a', true)
    expect(useRack.getState().selection).toEqual(['vco-c'])
  })

  it('clears on null', () => {
    useRack.getState().select('vco-a')
    useRack.getState().select(null)
    expect(useRack.getState().selection).toEqual([])
  })

  it('takes everything between, in rack order and either direction', () => {
    useRack.getState().select('vco-b')
    useRack.getState().selectRange('vco-d')
    expect(ids()).toEqual(['vco-b', 'vco-c', 'vco-d'])

    useRack.getState().select('vco-d')
    useRack.getState().selectRange('vco-b')
    expect(ids()).toEqual(['vco-b', 'vco-c', 'vco-d'])
  })

  it('keeps the anchor last, so extending again grows from where you started', () => {
    // What every list in every application does. Anchored at the far end instead, a second shift-click
    // would shrink the selection rather than extend it.
    useRack.getState().select('vco-b')
    useRack.getState().selectRange('vco-c')
    const selection = useRack.getState().selection
    expect(selection[selection.length - 1]).toBe('vco-b')
    useRack.getState().selectRange('vco-d')
    expect(ids()).toEqual(['vco-b', 'vco-c', 'vco-d'])
  })

  it('is an ordinary click when there is nothing to range from', () => {
    // Silently, because a shortcut that reported an error would be worse than one that did the obvious
    // thing. Same for an anchor that has since been removed.
    useRack.getState().selectRange('vco-c')
    expect(useRack.getState().selection).toEqual(['vco-c'])

    useRack.setState({ selection: ['gone-1'] })
    useRack.getState().selectRange('vco-c')
    expect(useRack.getState().selection).toEqual(['vco-c'])
  })

  it('removes the whole group in one undo step', () => {
    // Four modules removed as four edits would be four steps back, which is the thing that makes tidying
    // up a rack tedious enough to avoid.
    useRack.getState().select('vco-a')
    useRack.getState().select('vco-b', true)
    const before = useRack.getState().patch.modules.length
    useRack.getState().removeSelected()
    expect(useRack.getState().patch.modules).toHaveLength(before - 2)

    useRack.getState().undo()
    expect(useRack.getState().patch.modules).toHaveLength(before)
  })

  it('takes the cables of everything it removes', () => {
    useRack.getState().select('vco-a')
    useRack.getState().select('vco-b', true)
    useRack.getState().removeSelected()
    expect(useRack.getState().patch.cables).toEqual([])
  })

  it('removes what is selected when it is called, not what was selected when it was drawn', () => {
    // The bug a browser found. The tools row sits inside the module's own section, which selects on
    // pointerdown — so clicking Remove collapsed the group to one module and then removed only that,
    // while the button still read "Remove 4 modules" because its label was decided at render time.
    // `removeSelected` reading the store at call time is what makes the fix in `Chassis` sufficient, and
    // this pins the half that lives here: the action is never handed a stale group.
    useRack.getState().select('vco-a')
    useRack.getState().select('vco-b', true)
    useRack.getState().select('vco-c', true)
    useRack.getState().select('vco-d')
    useRack.getState().removeSelected()
    expect(useRack.getState().patch.modules.map((m) => m.id)).toEqual(['vco-a', 'vco-b', 'vco-c'])
  })

  it('does nothing at all with an empty selection', () => {
    // Declining by identity, the convention every structural edit here follows, so it is not an undo step
    // that appears to do nothing.
    const before = useRack.getState().patch
    useRack.getState().removeSelected()
    expect(useRack.getState().patch).toBe(before)
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

  it('gives a new source its own Out, so a click in the picker makes a sound', () => {
    // Reason connects a new device to the next free mixer channel; `insertChunk` already did the same for
    // a chunk. This is the gap `docs/REASON-GAP.md` called "chunks only".
    useRack.setState({ patch: { modules: [], cables: [] }, revision: 0, history: NO_HISTORY })
    useRack.getState().addModule('voice')
    const patch = useRack.getState().patch
    expect(patch.modules.map((m) => m.type)).toEqual(['voice', 'out'])
    expect(patch.cables).toEqual([{ from: ['voice-1', 'out'], to: ['out-1', 'in'] }])
  })

  it('gives each source its own Out rather than sharing one', () => {
    // Sharing would put the new thing on somebody else's fader, which is the same reason a chunk gets a
    // fresh one every time.
    useRack.setState({ patch: { modules: [], cables: [] }, revision: 0, history: NO_HISTORY })
    useRack.getState().addModule('vco')
    useRack.getState().addModule('vco')
    const patch = useRack.getState().patch
    expect(patch.modules.filter((m) => m.type === 'out')).toHaveLength(2)
    expect(patch.cables).toHaveLength(2)
  })

  it('leaves a module that is not a source unpatched', () => {
    // An EQ wired to a fresh Out is a channel with nothing feeding it: clutter, and a fader that does
    // nothing. Only a source earns a channel.
    useRack.setState({ patch: { modules: [], cables: [] }, revision: 0, history: NO_HISTORY })
    useRack.getState().addModule('eq')
    expect(useRack.getState().patch.modules.map((m) => m.type)).toEqual(['eq'])
    expect(useRack.getState().patch.cables).toEqual([])
  })

  it('leaves a source that has not said which outlet is primary unpatched', () => {
    // The Noise has `white` and `pink`, which are equally its output, and the Groovebox has eight — four
    // machines in stereo pairs. Wiring "the first one" would give the 808's left channel and the strong
    // impression the other three machines were broken. A def that has not declared an `out` is one the
    // rack should not answer for.
    useRack.setState({ patch: { modules: [], cables: [] }, revision: 0, history: NO_HISTORY })
    useRack.getState().addModule('noise')
    useRack.getState().addModule('groovebox')
    expect(useRack.getState().patch.cables).toEqual([])
    expect(useRack.getState().patch.modules.some((m) => m.type === 'out')).toBe(false)
  })

  it('is one undo step, not two', () => {
    // The module and its Out arrive together, so stepping back leaves neither — a half-undone add that
    // left an orphan Out behind would be worse than not auto-routing at all.
    useRack.setState({ patch: { modules: [], cables: [] }, revision: 0, history: NO_HISTORY })
    useRack.getState().addModule('vco')
    useRack.getState().undo()
    expect(useRack.getState().patch.modules).toEqual([])
  })

  it('numbers a new module rather than inventing an id', () => {
    // The id decides what a Noise module sounds like, because anything random in the rack seeds from it —
    // so it must be a function of the patch and not of the clock.
    useRack.setState({ patch: { modules: [], cables: [] } })
    useRack.getState().addModule('vco')
    useRack.getState().addModule('vco')
    // Filtered to the type being numbered: a source now arrives with its own Out beside it, and this test
    // is about the numbering rather than about what else the add brings.
    const ids = useRack.getState().patch.modules.filter((m) => m.type === 'vco').map((m) => m.id)
    expect(ids).toEqual(['vco-1', 'vco-2'])
  })

  it('reuses a gap in the numbering', () => {
    useRack.setState({
      patch: { modules: [{ id: 'vco-1', type: 'vco' }, { id: 'vco-3', type: 'vco' }], cables: [] },
    })
    useRack.getState().addModule('vco')
    expect(useRack.getState().patch.modules.filter((m) => m.type === 'vco')[2].id).toBe('vco-2')
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

describe('previewing a loaded sample', () => {
  it('bridges the host preview function and its playing state into the faceplate store', () => {
    const preview = async () => {}

    useRack.getState().setSamplePreviewer(preview)
    useRack.getState().setPreviewingSample('sampler-1')

    expect(useRack.getState().previewSample).toBe(preview)
    expect(useRack.getState().previewingSample).toBe('sampler-1')

    useRack.getState().setPreviewingSample(null)
    useRack.getState().setSamplePreviewer(null)
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

describe('recording a knob move', () => {
  beforeEach(() => {
    useRack.setState({
      patch: ACID(),
      revision: 0,
      history: NO_HISTORY,
      automating: false,
      automationPosition: null,
    })
  })

  /** Arm, and pretend the transport is at `at`. */
  const armAt = (at: number | null) => {
    useRack.setState({ automating: true, automationPosition: () => at })
  }

  it('records nothing at all when it is not armed', () => {
    // The default, and the one that matters most: an ordinary session must not accumulate lanes.
    useRack.getState().setParam('ladder-1', 'cutoff', 900)
    expect(useRack.getState().patch.automation).toBeUndefined()
  })

  it('writes a point where the transport is when it is armed', () => {
    armAt(32)
    useRack.getState().setParam('ladder-1', 'cutoff', 900)
    const lane = useRack.getState().patch.automation?.[0]
    expect(lane?.target).toEqual(['ladder-1', 'cutoff'])
    expect(lane?.points).toEqual([{ at: 32, value: 900 }])
  })

  it('still moves the knob, and still does not rebuild the graph', () => {
    // Recording must not turn a knob turn into a structural edit — that would be a click on every point.
    const before = useRack.getState().revision
    armAt(0)
    useRack.getState().setParam('ladder-1', 'cutoff', 900)
    expect(useRack.getState().paramValue('ladder-1', 'cutoff')).toBe(900)
    expect(useRack.getState().revision).toBe(before)
  })

  it('records the move and the knob in one undo step', () => {
    // Two writes would be two undo steps for one gesture, and a patch could be autosaved between them
    // with the knob moved and the recording missing.
    armAt(16)
    useRack.getState().setParam('ladder-1', 'cutoff', 900)
    useRack.getState().undo()
    expect(useRack.getState().patch.automation).toBeUndefined()
    expect(useRack.getState().paramValue('ladder-1', 'cutoff')).not.toBe(900)
  })

  it('records nothing when there is nowhere to record', () => {
    // No rack yet, so no playhead. Arming before `Start audio` has to be a no-op rather than a pile of
    // points at step zero.
    armAt(null)
    useRack.getState().setParam('ladder-1', 'cutoff', 900)
    expect(useRack.getState().patch.automation).toBeUndefined()
    expect(useRack.getState().paramValue('ladder-1', 'cutoff')).toBe(900)
  })

  it('keeps a lane per parameter and one point per position', () => {
    armAt(8)
    useRack.getState().setParam('ladder-1', 'cutoff', 400)
    useRack.getState().setParam('ladder-1', 'cutoff', 900)
    useRack.getState().setParam('ladder-1', 'resonance', 0.4)
    const lanes = useRack.getState().patch.automation
    expect(lanes).toHaveLength(2)
    expect(lanes?.find((l) => l.target[1] === 'cutoff')?.points).toEqual([{ at: 8, value: 900 }])
  })

  it('forgets one parameter without disturbing another', () => {
    armAt(0)
    useRack.getState().setParam('ladder-1', 'cutoff', 900)
    useRack.getState().setParam('ladder-1', 'resonance', 0.4)
    useRack.getState().clearAutomation('ladder-1', 'cutoff')
    const lanes = useRack.getState().patch.automation
    expect(lanes).toHaveLength(1)
    expect(lanes?.[0].target[1]).toBe('resonance')
  })

  it('leaves the patch with no automation key at all once the last lane is cleared', () => {
    // So a patch that was recorded onto and then cleared round-trips byte-identically with one that never
    // was — the standard every optional field in this format holds itself to.
    armAt(0)
    useRack.getState().setParam('ladder-1', 'cutoff', 900)
    useRack.getState().clearAutomation('ladder-1', 'cutoff')
    expect('automation' in useRack.getState().patch).toBe(false)
  })

  it('does nothing when asked to clear a lane that was never recorded', () => {
    const before = useRack.getState().patch
    useRack.getState().clearAutomation('ladder-1', 'cutoff')
    expect(useRack.getState().patch).toBe(before)
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

describe('editing a retained Groovebox pattern', () => {
  beforeEach(() => {
    useRack.setState({ patch: embedGrooveboxSong(SONGS[0].build()), revision: 0 })
  })

  it('updates the encoded song without rebuilding the rack graph', () => {
    const before = useRack.getState().revision
    const song = grooveboxSong(useRack.getState().patch)!
    const pattern = cycleStep(song.patterns[0], '808.bd', 3)

    useRack.getState().setGrooveboxPattern(pattern)

    expect(useRack.getState().revision).toBe(before)
    expect(grooveboxSong(useRack.getState().patch)?.patterns[0].tracks['808.bd']?.[3]).toBe(1)
    expect(patchCompatibility(useRack.getState().patch)).toBe('groovebox-compatible')
  })

  it('keeps discrete transforms as separate undo steps', () => {
    const first = grooveboxSong(useRack.getState().patch)!.patterns[0]
    useRack.getState().setGrooveboxPattern(rotateTrack(first, '808.bd', 1), true)
    const once = grooveboxSong(useRack.getState().patch)!.patterns[0]
    useRack.getState().setGrooveboxPattern(rotateTrack(once, '808.bd', 1), true)
    const twice = grooveboxSong(useRack.getState().patch)!.patterns[0]

    expect(useRack.getState().history.past).toHaveLength(2)
    useRack.getState().undo()
    expect(grooveboxSong(useRack.getState().patch)!.patterns[0]).toEqual(once)
    expect(grooveboxSong(useRack.getState().patch)!.patterns[0]).not.toEqual(twice)
  })

  it('edits authored drum and bass controls without rebuilding or extending the rack', () => {
    const before = useRack.getState().revision
    const song = grooveboxSong(useRack.getState().patch)!
    const sends = song.kit.sends

    useRack.getState().setGrooveboxVoiceParam('808.bd', 'decay', 0.23)
    useRack.getState().setGrooveboxBassParam('303.a', 'cutoff', 0.81)

    const next = grooveboxSong(useRack.getState().patch)!
    expect(next.kit.params['808.bd'].decay).toBe(0.23)
    expect(next.kit.bass?.['303.a'].cutoff).toBe(0.81)
    expect(next.kit.sends).toEqual(sends)
    expect(useRack.getState().revision).toBe(before)
    expect(patchCompatibility(useRack.getState().patch)).toBe('groovebox-compatible')
  })

  it('edits shared 909 flam spacing as retained document data', () => {
    const before = useRack.getState().revision
    useRack.getState().setGrooveboxFlamWidth(0.72)

    expect(grooveboxSong(useRack.getState().patch)?.kit.flam).toBe(0.72)
    expect(useRack.getState().revision).toBe(before)
    expect(useRack.getState().history.past).toHaveLength(1)

    useRack.getState().setGrooveboxFlamWidth(2)
    expect(grooveboxSong(useRack.getState().patch)?.kit.flam).toBe(1)
  })

  it('records tempo, swing and instrument controls at the hosted audio playhead', () => {
    useRack.getState().setGrooveboxAutomationPosition(() => ({ bar: 2, index: 3 }))
    useRack.getState().toggleGrooveboxAutomationRecording()

    useRack.getState().setTempo(138)
    useRack.getState().setGrooveboxSwing(0.42)
    useRack.getState().setGrooveboxVoiceParam('808.bd', 'decay', 0.23)
    useRack.getState().setGrooveboxBassParam('303.a', 'cutoff', 0.81)
    useRack.getState().setGrooveboxVoiceSwing('808.ch', 0.67)
    useRack.getState().setGrooveboxSend('808.bd', 'reverb', 0.38)
    useRack.getState().setGrooveboxFx('delayTone', 0.29)

    const patch = useRack.getState().patch
    const song = grooveboxSong(patch)!
    const lanes = new Map(song.automation?.map((lane) => [lane.target, lane.points]))
    expect(lanes.get(AUTOMATION_TARGET.bpm)).toEqual([
      { bar: 2, index: 3, value: 138 },
    ])
    expect(lanes.get(AUTOMATION_TARGET.swing)).toEqual([
      { bar: 2, index: 3, value: 0.42 },
    ])
    expect(lanes.get(AUTOMATION_TARGET.voice('808.bd', 'decay'))).toEqual([
      { bar: 2, index: 3, value: 0.23 },
    ])
    expect(lanes.get(AUTOMATION_TARGET.bass('303.a', 'cutoff'))).toEqual([
      { bar: 2, index: 3, value: 0.81 },
    ])
    expect(lanes.get(AUTOMATION_TARGET.voiceSwing('808.ch'))).toEqual([
      { bar: 2, index: 3, value: 0.67 },
    ])
    expect(lanes.get(AUTOMATION_TARGET.send('808.bd', 'reverb'))).toEqual([
      { bar: 2, index: 3, value: 0.38 },
    ])
    expect(lanes.get(AUTOMATION_TARGET.fx('delayTone'))).toEqual([
      { bar: 2, index: 3, value: 0.29 },
    ])
    expect(patch.tempo).toBeUndefined()
    expect(patchCompatibility(patch)).toBe('groovebox-compatible')
    expect(useRack.getState().revision).toBe(0)
  })

  it('changes base values without recording while the hosted song is stopped', () => {
    useRack.getState().setGrooveboxAutomationPosition(() => null)
    useRack.getState().toggleGrooveboxAutomationRecording()
    useRack.getState().setTempo(132)
    useRack.getState().setGrooveboxSwing(0.37)
    useRack.getState().setGrooveboxVoiceParam('909.sd', 'tone', 0.64)
    useRack.getState().setGrooveboxVoiceSwing('909.sd', 0.26)
    useRack.getState().setGrooveboxSend('909.sd', 'delay', 0.48)
    useRack.getState().setGrooveboxFx('reverbSize', 0.73)

    const song = grooveboxSong(useRack.getState().patch)!
    expect(song.bpm).toBe(132)
    expect(song.swing).toBe(0.37)
    expect(song.kit.params['909.sd'].tone).toBe(0.64)
    expect(song.kit.swing?.['909.sd']).toBe(0.26)
    expect(song.kit.sends?.['909.sd'].delay).toBe(0.48)
    expect(song.fx?.reverbSize).toBe(0.73)
    expect(song.automation).toBeUndefined()
    expect(useRack.getState().patch.tempo).toBeUndefined()
  })

  it('clears retained automation as one undoable non-structural edit', () => {
    useRack.getState().setGrooveboxAutomationPosition(() => ({ bar: 1, index: 2 }))
    useRack.getState().toggleGrooveboxAutomationRecording()
    useRack.getState().setGrooveboxSwing(0.61)
    const recorded = useRack.getState().patch
    const beforeRevision = useRack.getState().revision

    useRack.getState().clearGrooveboxAutomation()
    expect(grooveboxSong(useRack.getState().patch)?.automation).toBeUndefined()
    expect(useRack.getState().revision).toBe(beforeRevision)

    useRack.getState().undo()
    expect(useRack.getState().patch).toEqual(recorded)
  })

  it('keeps the automation arm and clock provider out of the document', () => {
    const patch = useRack.getState().patch
    const history = useRack.getState().history
    const position = () => ({ bar: 4, index: 7 })

    useRack.getState().setGrooveboxAutomationPosition(position)
    useRack.getState().toggleGrooveboxAutomationRecording()

    expect(useRack.getState().grooveboxAutomationPosition).toBe(position)
    expect(useRack.getState().grooveboxAutomationRecording).toBe(true)
    expect(useRack.getState().patch).toBe(patch)
    expect(useRack.getState().history).toBe(history)
  })

  it('quantises keyboard taps into the focused drum lane at the hosted playhead', () => {
    const song = grooveboxSong(useRack.getState().patch)!
    const pattern = song.patterns[1] ?? song.patterns[0]
    useRack.getState().setGrooveboxTapTarget({
      patternId: pattern.id,
      section: 'tr909',
      voiceId: '909.sd',
    })
    let index = 19
    useRack.getState().setGrooveboxAutomationPosition(() => ({ bar: 3, index }))
    useRack.getState().toggleGrooveboxTapRecording()

    const hit = useRack.getState().recordGrooveboxTap(48, 0.9)
    index = 20
    useRack.getState().recordGrooveboxTap(47, 0.5)
    const recorded = grooveboxSong(useRack.getState().patch)!

    expect(hit).toEqual({
      section: 'tr909',
      voiceId: '909.sd',
      semitone: 12,
      accent: true,
    })
    expect(recorded.patterns.find((candidate) => candidate.id === pattern.id)?.tracks['909.sd']?.[3]).toBe(2)
    expect(recorded.patterns.find((candidate) => candidate.id === pattern.id)?.tracks['909.sd']?.[4]).toBe(1)
    expect(recorded.patterns.find((candidate) => candidate.id !== pattern.id)).toEqual(
      song.patterns.find((candidate) => candidate.id !== pattern.id),
    )
    expect(useRack.getState().revision).toBe(0)
    expect(useRack.getState().history.past).toHaveLength(1)
    expect(patchCompatibility(useRack.getState().patch)).toBe('groovebox-compatible')
  })

  it('records a clamped 303 note while preserving the focused step slide', () => {
    const song = grooveboxSong(useRack.getState().patch)!
    const pattern = song.patterns[0]
    useRack.getState().setGrooveboxPattern({
      ...pattern,
      bass: {
        ...pattern.bass,
        '303.a': Array.from({ length: pattern.length }, (_, index) =>
          index === 5
            ? { note: 4, accent: false, slide: true }
            : { note: null, accent: false, slide: false },
        ),
      },
    })
    useRack.getState().setGrooveboxTapTarget({
      patternId: pattern.id,
      section: '303.a',
      voiceId: '303.a',
    })
    useRack.getState().setGrooveboxAutomationPosition(() => ({ bar: 0, index: 5 }))
    useRack.getState().toggleGrooveboxTapRecording()

    expect(useRack.getState().recordGrooveboxTap(72, 0.4)).toMatchObject({
      section: '303.a',
      semitone: 24,
      accent: false,
    })
    expect(
      grooveboxSong(useRack.getState().patch)?.patterns[0].bass?.['303.a']?.[5],
    ).toEqual({ note: 24, accent: false, slide: true })
  })

  it('advances stopped 303 taps through the retained pattern as one undo gesture', () => {
    const pattern = grooveboxSong(useRack.getState().patch)!.patterns[0]
    useRack.getState().setGrooveboxTapTarget({
      patternId: pattern.id,
      section: '303.b',
      voiceId: '303.b',
    })
    useRack.getState().setGrooveboxAutomationPosition(() => null)
    useRack.getState().toggleGrooveboxTapRecording()

    useRack.getState().recordGrooveboxTap(40, 0.9)
    useRack.getState().recordGrooveboxTap(43, 0.4)

    const line = grooveboxSong(useRack.getState().patch)?.patterns[0].bass?.['303.b']
    expect(line?.[0]).toMatchObject({ note: 4, accent: true })
    expect(line?.[1]).toMatchObject({ note: 7, accent: false })
    expect(useRack.getState().grooveboxTapStep).toBe(2)
    expect(useRack.getState().history.past).toHaveLength(1)
    expect(patchCompatibility(useRack.getState().patch)).toBe('groovebox-compatible')
  })

  it('does not claim a keyboard tap while disarmed or stopped', () => {
    const patch = useRack.getState().patch
    expect(useRack.getState().recordGrooveboxTap(48, 1)).toBeNull()

    useRack.getState().toggleGrooveboxTapRecording()
    useRack.getState().setGrooveboxAutomationPosition(() => null)
    expect(useRack.getState().recordGrooveboxTap(48, 1)).toBeNull()
    expect(useRack.getState().patch).toBe(patch)
  })

  it('clamps instrument controls and ignores them without a retained song', () => {
    useRack.getState().setGrooveboxVoiceParam('909.sd', 'tone', 2)
    useRack.getState().setGrooveboxBassParam('303.b', 'resonance', -1)
    expect(grooveboxSong(useRack.getState().patch)?.kit.params['909.sd'].tone).toBe(1)
    expect(grooveboxSong(useRack.getState().patch)?.kit.bass?.['303.b'].resonance).toBe(0)

    useRack.setState({ patch: { modules: [], cables: [] } })
    expect(() =>
      useRack.getState().setGrooveboxVoiceParam('808.bd', 'level', 0.5),
    ).not.toThrow()
    expect(() =>
      useRack.getState().setGrooveboxBassParam('303.a', 'level', 0.5),
    ).not.toThrow()
  })

  it('leaves every other pattern and rack field intact', () => {
    const before = useRack.getState().patch
    const song = grooveboxSong(before)!
    const pattern = cycleStep(song.patterns[0], '909.sd', 7)

    useRack.getState().setGrooveboxPattern(pattern)

    const after = useRack.getState().patch
    expect(after.modules).toEqual(before.modules)
    expect(after.cables).toEqual(before.cables)
    expect(grooveboxSong(after)?.patterns.slice(1)).toEqual(song.patterns.slice(1))
  })

  it('ignores an unknown pattern and a patch with no retained song', () => {
    const before = useRack.getState().patch
    const pattern = { ...grooveboxSong(before)!.patterns[0], id: 'not-in-this-song' }
    useRack.getState().setGrooveboxPattern(pattern)
    expect(useRack.getState().patch).toBe(before)

    useRack.setState({ patch: { modules: [], cables: [] } })
    expect(() => useRack.getState().setGrooveboxPattern(pattern)).not.toThrow()
  })

  it('assigns one machine clip without changing the section fallback', () => {
    const before = useRack.getState().revision
    const song = grooveboxSong(useRack.getState().patch)!
    const fallback = song.chain[0].pattern
    const wanted = song.patterns.find((pattern) => pattern.id !== fallback)!.id

    useRack.getState().setGrooveboxClip(0, 'tr909', wanted)

    const next = grooveboxSong(useRack.getState().patch)!
    expect(next.chain[0]).toMatchObject({
      pattern: fallback,
      clips: { tr909: wanted },
    })
    expect(useRack.getState().revision).toBe(before)
    expect(patchCompatibility(useRack.getState().patch)).toBe('groovebox-compatible')
  })

  it('removes a redundant override when a machine returns to the section pattern', () => {
    const song = grooveboxSong(useRack.getState().patch)!
    const fallback = song.chain[0].pattern
    const wanted = song.patterns.find((pattern) => pattern.id !== fallback)!.id
    useRack.getState().setGrooveboxClip(0, '303.a', wanted)
    useRack.getState().setGrooveboxClip(0, '303.a', fallback)

    expect(grooveboxSong(useRack.getState().patch)?.chain[0].clips?.['303.a']).toBeUndefined()
  })

  it('materialises one equivalent section for a song with an empty chain', () => {
    const song = grooveboxSong(useRack.getState().patch)!
    useRack.setState({
      patch: embedGrooveboxSong({ ...song, chain: [] }),
      revision: 0,
    })

    useRack.getState().setGrooveboxClip(0, 'tr808', song.patterns[0].id)

    expect(grooveboxSong(useRack.getState().patch)?.chain).toEqual([
      { pattern: song.patterns[0].id, repeat: 1 },
    ])
  })

  it('keeps queued and active clip launches out of the document and undo history', () => {
    const patch = useRack.getState().patch
    const history = useRack.getState().history
    const patternId = grooveboxSong(patch)!.patterns[1].id

    useRack.getState().setGrooveboxLaunch({
      section: 'tr808',
      patternId,
      phase: 'queued',
      quantization: 'beat',
    })
    expect(useRack.getState().grooveboxLaunches.tr808).toEqual({
      patternId,
      phase: 'queued',
      quantization: 'beat',
    })

    useRack.getState().setGrooveboxLaunch({
      section: 'tr808',
      patternId,
      phase: 'active',
      quantization: 'beat',
    })
    expect(useRack.getState().grooveboxLaunches.tr808?.phase).toBe('active')
    expect(useRack.getState().patch).toBe(patch)
    expect(useRack.getState().history).toBe(history)

    useRack.getState().setGrooveboxLaunch({
      section: 'tr808',
      patternId: null,
      phase: 'active',
      quantization: 'bar',
    })
    expect(useRack.getState().grooveboxLaunches.tr808).toBeUndefined()
  })

  it('keeps launch quantization as session state', () => {
    const patch = useRack.getState().patch
    const history = useRack.getState().history
    useRack.getState().setGrooveboxLaunchQuantization('step')
    expect(useRack.getState().grooveboxLaunchQuantization).toBe('step')
    expect(useRack.getState().patch).toBe(patch)
    expect(useRack.getState().history).toBe(history)
  })

  it('keeps hosted transport controls and loop state out of the document', () => {
    const patch = useRack.getState().patch
    const history = useRack.getState().history
    const transport = {
      startAt: () => true,
      setLoop: () => true,
      clearLoop: () => {},
    }

    useRack.getState().setGrooveboxTransport(transport)
    useRack.getState().setGrooveboxLoop({ start: 3, bars: 4 })

    expect(useRack.getState().grooveboxTransport).toBe(transport)
    expect(useRack.getState().grooveboxLoop).toEqual({ start: 3, bars: 4 })
    expect(useRack.getState().patch).toBe(patch)
    expect(useRack.getState().history).toBe(history)

    useRack.getState().setGrooveboxLoop(null)
    useRack.getState().setGrooveboxTransport(null)
    expect(useRack.getState().grooveboxLoop).toBeNull()
    expect(useRack.getState().grooveboxTransport).toBeNull()
  })
})

describe('performance scene document state', () => {
  it('stores a rack-native scene on the patch without rebuilding audio', () => {
    useRack.setState({ patch: { modules: [], cables: [] }, revision: 0, history: NO_HISTORY })
    useRack.getState().setVisual('longhand')

    expect(useRack.getState().patch.visual).toBe('longhand')
    expect(useRack.getState().revision).toBe(0)
    expect(patchCompatibility(useRack.getState().patch)).toBe('rack-native')
  })

  it('stores a Groovebox scene inside the retained song and keeps compatibility', () => {
    useRack.setState({
      patch: embedGrooveboxSong(SONGS[0].build()),
      revision: 0,
      history: NO_HISTORY,
    })
    useRack.getState().setVisual('longhand')

    expect(grooveboxSong(useRack.getState().patch)?.visual).toBe('longhand')
    expect(useRack.getState().patch.visual).toBeUndefined()
    expect(patchCompatibility(useRack.getState().patch)).toBe('groovebox-compatible')
    expect(useRack.getState().revision).toBe(0)
  })
})

describe('undo', () => {
  const state = () => useRack.getState()

  it('puts a knob back without bumping the revision', () => {
    // The one behaviour worth protecting here, and it is the same one the top of this file protects for
    // a forward edit: a restore that rebuilt the graph would reset every oscillator's phase and every
    // filter's history, so undoing a knob would click.
    const before = state().paramValue('reverb-1', 'size')
    const revision = state().revision

    state().setParam('reverb-1', 'size', 0.42)
    state().undo()

    expect(state().paramValue('reverb-1', 'size')).toBe(before)
    expect(state().revision).toBe(revision)
  })

  it('collapses a knob drag into one step', () => {
    const before = state().paramValue('reverb-1', 'size')
    for (const value of [0.2, 0.3, 0.4, 0.5]) state().setParam('reverb-1', 'size', value)

    state().undo()

    expect(state().paramValue('reverb-1', 'size')).toBe(before)
    expect(state().history.past).toHaveLength(0)
  })

  it('puts a removed module back, and rebuilds the graph for it', () => {
    const before = state().patch.modules.length
    const cables = state().patch.cables.length
    const revision = state().revision

    state().removeModule('reverb-1')
    expect(state().patch.modules).toHaveLength(before - 1)
    expect(state().patch.cables.length).toBeLessThan(cables)

    state().undo()

    expect(state().patch.modules).toHaveLength(before)
    expect(state().patch.cables).toHaveLength(cables)
    // Every cable that touched it comes back too, which is the whole reason undo matters more here than
    // in the sequencer: removing a wired module is the most destructive thing in the rack.
    expect(state().revision).toBe(revision + 2)
  })

  it('restores what a Combinator rotary drove, not just the rotary', () => {
    // The stored patch was settled when it was current, so the driven knob is already in it. Re-settling
    // on the way back would re-derive the target from the rotary being put back, one edit too late.
    const cutoff = state().paramValue('ladder-1', 'cutoff')
    state().setParam('combi-1', 'rotary1', 127)
    expect(state().paramValue('ladder-1', 'cutoff')).not.toBe(cutoff)

    state().undo()

    expect(state().paramValue('ladder-1', 'cutoff')).toBe(cutoff)
  })

  it('redoes what it undid', () => {
    state().setParam('reverb-1', 'size', 0.42)
    state().undo()
    state().redo()
    expect(state().paramValue('reverb-1', 'size')).toBe(0.42)
    expect(state().history.future).toHaveLength(0)
  })

  it('declines quietly at either end', () => {
    const patch = state().patch
    state().undo()
    state().redo()
    expect(state().patch).toBe(patch)
  })

  it('does not record an edit that changed nothing', () => {
    // `moveModule` on the first module declines, and a history entry for it would be an undo that
    // appears to do nothing at all.
    state().moveModule(state().patch.modules[0].id, -1)
    expect(state().history.past).toHaveLength(0)
  })

  it('forgets everything when another document is opened', () => {
    state().setParam('reverb-1', 'size', 0.42)
    expect(state().history.past).toHaveLength(1)

    state().load(patchPresetById('acid')!.build())

    expect(state().history.past).toHaveLength(0)
    expect(state().history.future).toHaveLength(0)
  })

  it('undoes a retained groovebox pattern edit without rebuilding or losing compatibility', () => {
    useRack.setState({ patch: embedGrooveboxSong(SONGS[0].build()), history: NO_HISTORY })
    const song = grooveboxSong(state().patch)!
    const revision = state().revision

    state().setGrooveboxPattern(cycleStep(song.patterns[0], '808.bd', 3))
    state().undo()

    expect(grooveboxSong(state().patch)?.patterns[0]).toEqual(song.patterns[0])
    expect(state().revision).toBe(revision)
    expect(patchCompatibility(state().patch)).toBe('groovebox-compatible')
  })

  it('undoes retained instrument controls without rebuilding', () => {
    useRack.setState({ patch: embedGrooveboxSong(SONGS[0].build()), history: NO_HISTORY })
    const song = grooveboxSong(state().patch)!
    const drum = song.kit.params['808.bd'].tone
    const bass = song.kit.bass?.['303.a'].resonance
    const revision = state().revision

    state().setGrooveboxVoiceParam('808.bd', 'tone', 0.12)
    state().setGrooveboxBassParam('303.a', 'resonance', 0.34)
    state().undo()
    state().undo()

    expect(grooveboxSong(state().patch)?.kit.params['808.bd'].tone).toBe(drum)
    expect(grooveboxSong(state().patch)?.kit.bass?.['303.a'].resonance).toBe(bass)
    expect(state().revision).toBe(revision)
  })

  it('undoes a retained machine clip assignment without rebuilding', () => {
    useRack.setState({ patch: embedGrooveboxSong(SONGS[0].build()), history: NO_HISTORY })
    const song = grooveboxSong(state().patch)!
    const before = song.chain[0].clips?.tr909
    const wanted = song.patterns.find((pattern) => pattern.id !== song.chain[0].pattern)!.id
    const revision = state().revision

    state().setGrooveboxClip(0, 'tr909', wanted)
    state().undo()

    expect(grooveboxSong(state().patch)?.chain[0].clips?.tr909).toBe(before)
    expect(state().revision).toBe(revision)
  })
})

describe('duplicating a module', () => {
  const state = () => useRack.getState()

  it('lands directly after the original rather than at the end', () => {
    // The module list is the layout, so a copy appended to the bottom is a copy you have to go and find.
    const order = () => state().patch.modules.map((m) => m.id)
    const before = order()
    const at = before.indexOf('reverb-1')

    state().duplicateModule('reverb-1')

    expect(order()).toHaveLength(before.length + 1)
    expect(order()[at + 1]).toBe('reverb-2')
    // Everything else stays exactly where it was, on both sides of the insertion.
    expect(order().slice(0, at + 1)).toEqual(before.slice(0, at + 1))
    expect(order().slice(at + 2)).toEqual(before.slice(at + 1))
  })

  it('brings the settings with it, which is the entire point', () => {
    state().setParam('reverb-1', 'size', 0.63)
    state().setParam('reverb-1', 'damp', 0.11)

    state().duplicateModule('reverb-1')

    expect(state().paramValue('reverb-2', 'size')).toBe(0.63)
    expect(state().paramValue('reverb-2', 'damp')).toBe(0.11)
  })

  it('copies pattern data rather than sharing the array', () => {
    // Nothing mutates a patch in place today, and "today" is the problem: a shared array is a trap laid
    // for whoever writes the first in-place edit.
    state().setLane('tracker-1', 0, [1, 2, 3, 4])
    state().duplicateModule('tracker-1')

    expect(state().lane('tracker-2', 0)).toEqual([1, 2, 3, 4])
    state().setLane('tracker-1', 0, [9, 9, 9, 9])
    expect(state().lane('tracker-2', 0)).toEqual([1, 2, 3, 4])
  })

  it('arrives unpatched, because copying a cable would unpatch the original', () => {
    // One cable per inlet and the later one wins, so a copied outgoing cable would take the original's
    // destination away from it — the opposite of what "duplicate" means.
    const before = state().patch.cables.length
    state().duplicateModule('reverb-1')

    expect(state().patch.cables).toHaveLength(before)
    expect(state().patch.cables.some((c) => c.from[0] === 'reverb-2' || c.to[0] === 'reverb-2')).toBe(
      false,
    )
  })

  it('does not copy the routings that drive it', () => {
    // A routing names its target by module id, so a copied one would aim at what the original already
    // drives and the two panels would fight over every knob.
    const before = state().patch.modulation?.length ?? 0
    state().duplicateModule('combi-1')
    expect(state().patch.modulation ?? []).toHaveLength(before)
  })

  it('gives the copy its own id, so a duplicated Noise is a different noise', () => {
    // Anything random in the rack seeds from the module id. Two Noise modules sharing one would be a
    // single source 6dB louder rather than two uncorrelated ones.
    useRack.setState({ patch: { modules: [{ id: 'noise-1', type: 'noise' }], cables: [] } })
    state().duplicateModule('noise-1')
    expect(state().patch.modules.map((m) => m.id)).toEqual(['noise-1', 'noise-2'])
  })

  it('rebuilds the graph, and one undo takes it back', () => {
    const revision = state().revision
    const before = state().patch.modules.length

    state().duplicateModule('reverb-1')
    expect(state().revision).toBe(revision + 1)

    state().undo()
    expect(state().patch.modules).toHaveLength(before)
  })

  it('declines quietly for a module that is not there', () => {
    const patch = state().patch
    state().duplicateModule('nobody')
    expect(state().patch).toBe(patch)
    expect(state().history.past).toHaveLength(0)
  })
})

describe('bypassing a module', () => {
  const state = () => useRack.getState()
  const bypassed = (id: string) =>
    state().patch.modules.find((m) => m.id === id)?.bypassed === true

  it('rebuilds the graph, because the compiler resolves it into the plan', () => {
    const revision = state().revision
    state().setBypassed('reverb-1', true)
    expect(bypassed('reverb-1')).toBe(true)
    expect(state().revision).toBe(revision + 1)
  })

  it('writes nothing at all when it goes back into circuit', () => {
    // Absent rather than `false`, so a patch that has never had anything bypassed stays byte-identical to
    // one written before bypass existed — the same standard `voices` and `tempo` hold themselves to.
    state().setBypassed('reverb-1', true)
    state().setBypassed('reverb-1', false)
    const module = state().patch.modules.find((m) => m.id === 'reverb-1')!
    expect('bypassed' in module).toBe(false)
  })

  it('declines when it would change nothing', () => {
    const patch = state().patch
    state().setBypassed('reverb-1', false)
    expect(state().patch).toBe(patch)
    state().setBypassed('nobody', true)
    expect(state().patch).toBe(patch)
    expect(state().history.past).toHaveLength(0)
  })

  it('is one undo, and undoing it rebuilds', () => {
    const revision = state().revision
    state().setBypassed('reverb-1', true)
    state().undo()
    expect(bypassed('reverb-1')).toBe(false)
    // `needsRebuild` has to see bypass as structural, or the graph would keep running the resolved plan
    // while the document said otherwise.
    expect(state().revision).toBe(revision + 2)
  })

  it('survives a round trip through the patch codec', () => {
    state().setBypassed('reverb-1', true)
    const reopened = decodePatch(encodePatch(state().patch))!
    expect(reopened.modules.find((m) => m.id === 'reverb-1')?.bypassed).toBe(true)
  })
})
