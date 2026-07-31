import {
  applyModulation,
  EMPTY_PATCH,
  insertChunk,
  type Chunk,
  type Inserted,
  type ModRoute,
  MODULES,
  PATCHES,
  decodePatch,
  encodePatch,
  patchPresetById,
  withGrooveboxSource,
  type Patch,
  type PatchCable,
  type PatchPreset,
  type PlanNote,
} from '@driftbox/rack'
import { create } from 'zustand'
import { autosavePatch, loadStoredPatch, takeRackDocumentFromUrl } from './persistence.js'
import { forget, learn, loadBindings, saveBindings, type CcBinding } from './cc.js'
import { reordered } from './layout.js'
import { tempoForBars } from './sample.js'

// What is on screen. `@driftbox/rack` owns the sound; this owns the patch as immutable data so React
// can diff it, and pushes it at the audio thread when it changes.
//
// **The important thing here is that a knob turn is not a patch change.**
//
// Handing the Rack a new patch recompiles it and rebuilds every processor, which resets an
// oscillator's phase and a filter's history — inaudible once, and a continuous crackle if it happens
// sixty times a second while somebody drags a knob. So there are two paths, and they are not
// interchangeable:
//
//   `setParam`  updates the value in the patch AND calls `rack.setParam`, which reaches the audio
//               thread as a message and ramps across one block. Nothing is recompiled.
//   `structural` anything that changes what modules or cables exist. Bumps `revision`, which is what
//               the effect in `RackApp` watches, and only then is the patch recompiled.
//
// The counter rather than a deep comparison of the patch, because the comparison would have to
// deliberately ignore params to be correct, and a comparison with an exception in it is a thing
// somebody will later "simplify".
//
// **Every edit is settled through `applyModulation` before it is stored.** A Combinator routing is
// arithmetic from one param to another, so turning a rotary has to move the targets *in the patch* — that
// is what makes the driven knob visibly move, what makes the routed value autosave and travel in a link,
// and what lets the existing param-push subscription in `RackApp` deliver it to the audio thread with no
// new machinery at all. Settling in one helper rather than at each call site is deliberate: a route that
// applied on a rotary turn but not after loading a patch would be a rack that sounded different depending
// on how you got to it.
//
// A routing edit is deliberately **not** structural. It changes no module and no cable, so nothing needs
// recompiling; it only moves knobs, which is exactly the path `setParam` already owns.

interface RackState {
  patch: Patch
  /** Bumped only when the graph needs rebuilding. Never by a knob. */
  revision: number
  /** Which module is selected, for keyboard editing and for dimming the rest. */
  selected: string | null
  flipped: boolean
  /**
   * What the compiler had to decide or discard, straight from the Rack.
   *
   * Held here so the back panel can draw a delayed cable differently and the header can say when a
   * module is a placeholder. It is not a log — a UI that does not show these is a UI that lies about
   * the patch, which is the argument `compile.ts` makes for producing them at all.
   */
  notes: PlanNote[]
  /** What the open patch is called in the library, or null for one that has never been saved — imported
   *  from a file, opened from a link, or the shipped patch it started on. */
  name: string | null
  /**
   * The last note MIDI sent, and the inputs it came from. **Performance, not document.**
   *
   * Deliberately here and not in the patch. A note somebody played is not part of what they built, and
   * routing it through `setParam` would autosave the last key anybody pressed into the file. The audio
   * thread gets these straight from `Rack.setParam`; this copy exists only so a faceplate can answer "is my
   * keyboard connected", which is the first question anybody has.
   */
  midiNote: number | null
  midiInputs: string[]

  setParam: (moduleId: string, paramId: string, value: number) => void
  paramValue: (moduleId: string, paramId: string) => number

  /**
   * Write one lane of a pattern. **Not structural**, for the same reason a knob is not.
   *
   * Pattern data lives in `PatchModule.data`, which `compile` copies into the plan — so treating an edit as
   * structural would recompile and rebuild every processor on every cell you touched, which is a click per
   * edit and a continuous crackle while dragging a value. Instead this takes the same two paths `setParam`
   * takes: the patch is updated so the edit saves and travels in a link, and `RackApp` pushes the array at
   * the audio thread as a `data` message, which the Graph keeps in `pushed` and which survives a rebuild.
   *
   * That `pushed` beats `seeded` is what makes it work at all, and it was already true — it exists so that
   * recompiling a patch does not throw away a break somebody loaded. A pattern is the same shape of problem.
   */
  setLane: (moduleId: string, lane: number, values: readonly number[]) => void
  /** One lane's steps, or an empty array. The patch is the source of truth; the audio thread has a copy. */
  lane: (moduleId: string, lane: number) => number[]

  /**
   * Write one data slot by name — what `setLane` is the Tracker-shaped case of.
   *
   * The Arranger's sections are not lanes, but they are the same kind of thing: an array a module reads at
   * audio rate, edited while it plays, which must not rebuild the graph. Rather than give each module its
   * own store action, the general one is the primitive and `setLane` keeps its name because `lane3` reads
   * better at the call site than the string does.
   */
  setData: (moduleId: string, slot: string, values: readonly number[]) => void
  /** One data slot, or an empty array. */
  data: (moduleId: string, slot: string) => number[]

  addModule: (type: string) => void
  /**
   * Drop a pre-wired group of modules in, on its own channel.
   *
   * Reason's Combinator, and the reason there is one rack rather than several — see the note at the top of
   * `chunks/index.ts`. Returns the ids it handed out so the host can address what it just added, which is
   * how a chunk containing a Sampler gets a break loaded into the right one.
   */
  addChunk: (chunk: Chunk) => Inserted
  removeModule: (moduleId: string) => void
  moveModule: (moduleId: string, by: number) => void
  /**
   * Move a module to an insertion index, which is what a drag reports.
   *
   * Separate from `moveModule` rather than replacing it. The buttons step by one and are the only way in
   * for anybody who cannot drag — the same standard the back panel holds itself to, where Enter arms a
   * jack because "a modular whose whole point is the cables is a poor thing to make mouse-only".
   */
  dropModule: (moduleId: string, index: number) => void

  connect: (from: [string, string], to: [string, string]) => void
  disconnect: (cable: PatchCable) => void

  /**
   * Point one Combinator control at one parameter. Reason's Modulation Routing.
   *
   * Indexed operations rather than keyed ones, because the routing list's **order is part of the
   * document**: two routes onto one target resolve last-wins, the same rule two cables into one inlet
   * follow. A keyed collection would have thrown that away.
   */
  addRoute: (from: [string, string], to: [string, string]) => void
  /** Change one end, or one limit, of an existing routing. */
  setRoute: (index: number, change: Partial<ModRoute>) => void
  removeRoute: (index: number) => void
  /**
   * Which Combinator's routing panel is open, or null. **Session state, never part of the patch.**
   *
   * Here rather than in `RackApp`'s own state because the control that opens it is on the faceplate, and a
   * faceplate is handed nothing but its def and its params — the same reason the Sampler reaches in here
   * for what file it is holding.
   */
  editingRoutes: string | null
  editRoutes: (moduleId: string | null) => void

  /**
   * Learned MIDI controller mappings. **Session state kept beside the patch, never in it.**
   *
   * A patch travels in a URL; a binding describes the box on somebody's desk. Sharing a patch that
   * silently re-aimed another person's controller would be wrong, and carrying a mapping for hardware
   * nobody else owns would be carrying noise. See the note at the top of `cc.ts`.
   */
  ccBindings: CcBinding[]
  /** Which parameter is waiting to be taught a controller, or null. */
  ccLearning: { module: string; param: string } | null
  /** Arm a parameter: the next controller message that arrives becomes its binding. */
  startCcLearn: (moduleId: string, paramId: string) => void
  cancelCcLearn: () => void
  /**
   * Finish a learn. Does nothing if nothing was armed, which is what a stray controller message is.
   *
   * Takes no channel on purpose. A binding listens on every channel, because a controller's knobs and its
   * keys often sit on different ones and somebody who has just turned a knob to teach it should not have
   * to know which was listening. Per-channel binding is a small change to `CcBinding`, which already
   * carries the field, on the day two controllers make it worth having.
   */
  finishCcLearn: (cc: number) => void
  clearCcBinding: (moduleId: string, paramId: string) => void

  setNotes: (notes: PlanNote[]) => void
  setName: (name: string | null) => void
  setMidi: (note: number | null, inputs?: string[]) => void
  /** Structural: the graph is rebuilt with a different number of processors per module. */
  setVoices: (voices: number) => void
  /** Not structural. Tempo is a value in the patch — it saves and it travels in a link, but changing it does not
   *  rebuild the graph, so it goes down the same path a knob does. */
  setTempo: (tempo: number) => void
  /** Change the generated break the patch asks its host to load. The id travels; the rendered audio does not. */
  setBreak: (id: string | null) => void
  /**
   * What is loaded into each Sampler, by module id. **Session state, never part of the patch.**
   *
   * The audio itself is not here — only what a faceplate needs to say what it is holding. A break is
   * megabytes and the store is diffed on every render; keeping it here would also put it one careless
   * `encodePatch` away from being written into a shared link.
   *
   * It is keyed by module id rather than being one global sample because a patch can have two Samplers, and
   * before this there was no way to say which one a file was meant for — loading pushed to all of them.
   */
  samples: Record<string, SampleInfo>
  setSample: (moduleId: string, sample: SampleInfo | null) => void
  /**
   * Re-read a loaded file as a different number of bars, and adopt the tempo that implies.
   *
   * The correction for the one mistake `guessBars` can make. It is always out by a factor of two, so the
   * fix is one press — and the tempo has to move with it or the slices stop landing on the beat, which is
   * the whole reason the bar count matters.
   */
  setSampleBars: (moduleId: string, bars: number) => void
  /**
   * Load a file into one Sampler.
   *
   * Installed by `RackApp`, because decoding is cheap but *pushing* needs the live Rack and the store has
   * no business knowing about it. Null until the page has mounted, which is also the honest answer for a
   * faceplate rendered in a test.
   */
  loadSampleInto: ((moduleId: string, file: File) => Promise<void>) | null
  setSampleLoader: (load: RackState['loadSampleInto']) => void
  /** Session state, not part of the patch. */
  running: boolean
  setRunning: (running: boolean) => void
  /**
   * Make sure there is a Sampler with somewhere to send its output, and return its id.
   *
   * Exists because clicking a break with no Sampler in the patch used to do nothing at all. Being told to go and
   * assemble three modules before a break will play is the opposite of what this instrument is for — so it wires
   * the smallest thing that works: a Transport if there is not one, a Sampler, a sixteenth into its trigger, and
   * its output to the existing Out or a new one.
   *
   * A no-op when a Sampler already exists, so it never rearranges a patch somebody built.
   */
  ensureSampler: () => string
  /**
   * Make sure there is a MIDI module with somewhere to send its notes, and return its id.
   *
   * The same reasoning as `ensureSampler`, and the same bug avoided: pressing a key on a rack with no MIDI
   * module used to be indistinguishable from a broken keyboard. Being told to go and patch two cables
   * before a note will sound is the opposite of what this instrument is for.
   *
   * **It takes over the pitch and gate inlets it lands on**, because one cable per inlet is the rule
   * everywhere — the compiler enforces it and `connect` mirrors it, which is what dragging a cable onto an
   * occupied input does in Reason. On the starter patch that means the keyboard replaces the sequencer as
   * what plays the voice, which is exactly what somebody pressing a key is asking for. It is visible on the
   * back panel and undone by patching the sequencer back.
   *
   * A no-op when a MIDI module already exists, so it never rearranges a patch somebody built.
   */
  ensureMidi: () => string | null
  load: (patch: Patch) => void
  select: (moduleId: string | null) => void
  flip: (flipped?: boolean) => void
}

/** A fresh id for a module of this type: `vco-1`, `vco-2`. Stable, readable, and — because anything
 *  random in the rack seeds from the module id — it is also what decides what a Noise module sounds
 *  like, so it must not be a timestamp or a counter that resets. */
function freshId(patch: Patch, type: string): string {
  const taken = new Set(patch.modules.map((m) => m.id))
  for (let n = 1; ; n++) {
    const id = `${type}-${n}`
    if (!taken.has(id)) return id
  }
}

/**
 * What a first-time visitor arrives on.
 *
 * A beat, not a bleep. `docs/DNB.md` is explicit that the reward for the gesture that starts audio has to be
 * immediate and has to be the thing this rack is for — and a sequenced acid line, which is what this used to
 * be, is a demonstration rather than a record.
 *
 * The shipped factory rather than a second copy of it: `@driftbox/rack` owns presets for the same reason the
 * engine owns songs. They are data about the instrument, not about the page showing it.
 */
const FIRST_PRESET = patchPresetById('pressure-system') ?? PATCHES[0]

const STARTER = (): Patch => FIRST_PRESET.build()

/** What a faceplate needs to say what a Sampler is holding. Deliberately not the audio. */
export interface SampleInfo {
  name: string
  /** How many bars the file was taken to be — the number the derived tempo rests on. */
  bars: number
  seconds: number
  /** Display-only peak envelope. Small enough for state; the audio buffer itself deliberately stays out. */
  peaks: readonly number[]
  /** A shipped break can be re-rendered from its id; somebody's own file cannot travel in a link. */
  source: 'break' | 'file'
}

export const useRack = create<RackState>((set, get) => {
  /**
   * Run every Combinator routing over a patch before it is stored.
   *
   * One place, so no edit can forget. `applyModulation` returns the very same object when nothing moved,
   * so this is free on the overwhelming majority of edits — the store diffs by reference and a settled
   * patch stays reference-equal.
   */
  const settle = (patch: Patch): Patch => applyModulation(patch, MODULES)

  /**
   * Every structural edit goes through here, so nothing can forget the revision or the autosave.
   *
   * **An edit that changed nothing does not bump the revision.** The revision is what makes `RackApp`
   * recompile, and recompiling rebuilds every processor — resetting each oscillator's phase and each
   * filter's history, which is an audible click. Several edits here can legitimately be no-ops: moving the
   * first module up, dropping a dragged module back where it started, removing an id that is not there.
   * Before this they all rebuilt the graph to achieve nothing.
   *
   * Reference identity is the test, which is why the operations above are careful to hand back the very
   * same patch when they decline — the same convention `applyModulation` and `reordered` follow.
   */
  const structural = (change: (patch: Patch) => Patch) => {
    set((state) => {
      const patch = settle(change(state.patch))
      if (patch === state.patch) return {}
      autosavePatch(patch)
      return { patch, revision: state.revision + 1 }
    })
  }

  /** A routing edit: the document changes, the graph does not. Same path a knob takes. */
  const routing = (change: (routes: ModRoute[]) => ModRoute[]) => {
    set((state) => {
      const routes = change([...(state.patch.modulation ?? [])])
      // Absent rather than an empty array, so removing the last routing leaves a patch byte-identical to
      // one that never had any — the same standard `voices` and `tempo` hold themselves to.
      const { modulation: _drop, ...rest } = state.patch
      const patch = settle(routes.length > 0 ? { ...rest, modulation: routes } : rest)
      autosavePatch(patch)
      return { patch }
    })
  }

  return {
    patch: EMPTY_PATCH,
    revision: 0,
    selected: null,
    flipped: false,
    notes: [],
    name: null,
    midiNote: null,
    midiInputs: [],
    running: false,

    paramValue: (moduleId, paramId) => {
      const module = get().patch.modules.find((m) => m.id === moduleId)
      const saved = module?.params?.[paramId]
      if (saved !== undefined) return saved
      const def = module ? MODULES[module.type] : undefined
      return def?.params.find((p) => p.id === paramId)?.default ?? 0
    },

    setParam: (moduleId, paramId, value) => {
      // No revision bump. See the note at the top of this file — this is the whole reason it exists.
      set((state) => {
        // Settled, so turning a Combinator rotary moves everything it drives in the same edit. That also
        // means grabbing a *routed* knob directly is undone the moment its rotary next moves, which is
        // what Reason does and is the honest behaviour: the routing owns the knob, and the faceplate
        // marks it so rather than disabling it.
        const patch = settle({
          ...state.patch,
          modules: state.patch.modules.map((module) =>
            module.id === moduleId
              ? { ...module, params: { ...module.params, [paramId]: value } }
              : module,
          ),
        })
        autosavePatch(patch)
        return { patch }
      })
    },

    setLane: (moduleId, lane, values) => get().setData(moduleId, `lane${lane + 1}`, values),

    lane: (moduleId, lane) => get().data(moduleId, `lane${lane + 1}`),

    setData: (moduleId, slot, values) => {
      set((state) => {
        const patch = {
          ...state.patch,
          modules: state.patch.modules.map((module) =>
            module.id === moduleId
              ? { ...module, data: { ...module.data, [slot]: [...values] } }
              : module,
          ),
        }
        autosavePatch(patch)
        return { patch }
      })
    },

    data: (moduleId, slot) =>
      get().patch.modules.find((m) => m.id === moduleId)?.data?.[slot] ?? [],

    addRoute: (from, to) =>
      // A fresh route sweeps the target end to end, which it says by leaving both limits absent rather
      // than by writing the numbers down. That way the patch does not hardcode a range a later version of
      // that module might widen, and the panel can show the real limits by looking them up.
      routing((routes) => [...routes, { from, to }]),

    setRoute: (index, change) =>
      routing((routes) => {
        if (index < 0 || index >= routes.length) return routes
        const next = { ...routes[index], ...change }
        // An erased number field means "the target's own limit", and is stored as absence. `in` rather
        // than a comparison to undefined, because clearing the field is done by passing undefined and the
        // spread above would otherwise leave the key present holding it — which JSON drops anyway, but
        // only after `applyModulation` has seen it. Zero would be the wrong repair either way: it aims
        // the route at the bottom of the range rather than at the end of it.
        if ('min' in change && !Number.isFinite(next.min)) delete next.min
        if ('max' in change && !Number.isFinite(next.max)) delete next.max
        routes[index] = next
        return routes
      }),

    removeRoute: (index) =>
      routing((routes) => {
        if (index < 0 || index >= routes.length) return routes
        routes.splice(index, 1)
        return routes
      }),

    editingRoutes: null,
    editRoutes: (editingRoutes) => set({ editingRoutes }),

    // Read once, at construction. Bindings change when somebody learns one, which is rare, so there is
    // nothing to gain from re-reading storage and a stale read would be a mapping that stopped working.
    ccBindings: loadBindings(),
    ccLearning: null,
    startCcLearn: (module, param) => set({ ccLearning: { module, param } }),
    cancelCcLearn: () => set({ ccLearning: null }),
    finishCcLearn: (cc) => {
      const armed = get().ccLearning
      if (!armed) return
      const bindings = learn(get().ccBindings, { cc, channel: 0, ...armed })
      saveBindings(bindings)
      set({ ccBindings: bindings, ccLearning: null })
    },
    clearCcBinding: (module, param) => {
      const bindings = forget(get().ccBindings, module, param)
      saveBindings(bindings)
      set({ ccBindings: bindings })
    },

    addChunk: (chunk) => {
      let result: Inserted | null = null
      structural((patch) => {
        result = insertChunk(patch, chunk)
        return result.patch
      })
      return result!
    },

    addModule: (type) =>
      structural((patch) => ({
        ...patch,
        modules: [...patch.modules, { id: freshId(patch, type), type }],
      })),

    removeModule: (moduleId) =>
      structural((patch) => {
        // Every cable touching it goes too. The compiler would drop them anyway, but leaving them in
        // the patch means they come back if the module is re-added under the same id, which looks
        // like a haunting.
        const routes = (patch.modulation ?? []).filter(
          // And every routing touching it, at either end, for exactly the same reason. `applyModulation`
          // would skip them silently, so a stale route is quieter than a stale cable and therefore worse:
          // re-adding a Combinator under the same id would resurrect routings nobody could see.
          (route) => route.from[0] !== moduleId && route.to[0] !== moduleId,
        )
        const { modulation: _drop, ...rest } = patch
        return {
          ...rest,
          modules: patch.modules.filter((m) => m.id !== moduleId),
          cables: patch.cables.filter((c) => c.from[0] !== moduleId && c.to[0] !== moduleId),
          ...(routes.length > 0 ? { modulation: routes } : {}),
        }
      }),

    dropModule: (moduleId, index) =>
      structural((patch) => {
        const from = patch.modules.findIndex((m) => m.id === moduleId)
        const modules = reordered(patch.modules, from, index)
        // The same array back means the drop changed nothing. Returning the same *patch* is what tells
        // `structural` not to bump the revision, which is what stops a drag that ends where it started
        // from rebuilding every processor in the rack.
        return modules === patch.modules ? patch : { ...patch, modules: [...modules] }
      }),

    moveModule: (moduleId, by) =>
      structural((patch) => {
        const at = patch.modules.findIndex((m) => m.id === moduleId)
        const to = at + by
        if (at < 0 || to < 0 || to >= patch.modules.length) return patch
        const modules = [...patch.modules]
        const [module] = modules.splice(at, 1)
        modules.splice(to, 0, module)
        return { ...patch, modules }
      }),

    connect: (from, to) =>
      structural((patch) => ({
        ...patch,
        // One cable per inlet, matching the compiler — which takes the last and reports the earlier as
        // replaced. Doing it here as well means the patch says what it does rather than carrying a
        // cable that exists only to be discarded.
        cables: [
          ...patch.cables.filter((c) => !(c.to[0] === to[0] && c.to[1] === to[1])),
          { from, to },
        ],
      })),

    disconnect: (cable) =>
      structural((patch) => ({
        ...patch,
        cables: patch.cables.filter(
          (c) =>
            !(
              c.from[0] === cable.from[0] &&
              c.from[1] === cable.from[1] &&
              c.to[0] === cable.to[0] &&
              c.to[1] === cable.to[1]
            ),
        ),
      })),

    setNotes: (notes) => set({ notes }),
    setName: (name) => set({ name }),
    samples: {},
    setSample: (moduleId, sample) =>
      set((state) => {
        const samples = { ...state.samples }
        if (sample) samples[moduleId] = sample
        else delete samples[moduleId]
        return { samples }
      }),
    setSampleBars: (moduleId, bars) => {
      const info = get().samples[moduleId]
      if (!info) return
      const tempo = tempoForBars(info.seconds, bars)
      if (!(tempo > 0)) return
      set((state) => ({ samples: { ...state.samples, [moduleId]: { ...info, bars } } }))
      get().setTempo(Math.round(tempo * 100) / 100)
    },
    loadSampleInto: null,
    setSampleLoader: (loadSampleInto) => set({ loadSampleInto }),

    setMidi: (midiNote, inputs) =>
      set((state) => ({ midiNote, midiInputs: inputs ?? state.midiInputs })),

    setTempo: (tempo) => {
      set((state) => {
        const wanted = Math.max(20, Math.min(400, tempo))
        const patch =
          wanted === 120
            ? (({ tempo: _drop, ...rest }) => rest)(state.patch)
            : { ...state.patch, tempo: wanted }
        autosavePatch(patch)
        return { patch }
      })
    },
    setBreak: (id) =>
      set((state) => {
        if ((id ?? undefined) === state.patch.break) return {}
        const { break: _drop, ...rest } = state.patch
        const patch = id ? { ...rest, break: id } : rest
        autosavePatch(patch)
        return { patch }
      }),

    setRunning: (running) => set({ running }),

    ensureSampler: () => {
      const existing = get().patch.modules.find((m) => m.type === 'sampler')
      if (existing) return existing.id

      const id = freshId(get().patch, 'sampler')
      structural((patch) => {
        const modules = [...patch.modules]
        const cables = [...patch.cables]

        // Reuse whatever is already there rather than duplicating it — a second Out would sum alongside the first
        // and a second Transport would just agree with it.
        let transport = modules.find((m) => m.type === 'transport')?.id
        if (!transport) {
          transport = freshId({ ...patch, modules }, 'transport')
          modules.push({ id: transport, type: 'transport' })
        }
        let out = modules.find((m) => m.type === 'out')?.id
        if (!out) {
          out = freshId({ ...patch, modules }, 'out')
          modules.push({ id: out, type: 'out' })
        }
        modules.push({ id, type: 'sampler' })

        // One slice per sixteenth, which is the chop a one-bar break at sixteen slices is built for.
        cables.push({ from: [transport, 'sixteenth'], to: [id, 'trig'] })
        cables.push({ from: [transport, 'bar'], to: [id, 'slice'] })
        cables.push({ from: [id, 'out'], to: [out, 'in'] })
        return { ...patch, modules, cables }
      })
      return id
    },

    ensureMidi: () => {
      const existing = get().patch.modules.find((m) => m.type === 'midi')
      if (existing) return existing.id

      // Somewhere for the notes to go. Without a pitch inlet to drive there is nothing useful to build —
      // a MIDI module wired to nothing is the silent no-op this exists to prevent, so say so instead.
      const patch = get().patch
      const vco = patch.modules.find((m) => m.type === 'vco')
      if (!vco) return null

      const id = freshId(patch, 'midi')
      structural((current) => {
        const modules = [...current.modules, { id, type: 'midi' }]
        const cables = [...current.cables]

        // One cable per inlet, so anything already driving these is replaced rather than summed — a summed
        // pitch would be a wrong note rather than an obvious break, which is the worse failure.
        // Named explicitly rather than inferred from the destination: the gate goes to a VCA's `cv` inlet
        // when there is no envelope, and guessing the source from the target's port id would have sent it
        // pitch instead — a drone at the wrong note rather than a note.
        const takeOver = (from: string, to: [string, string]) => {
          const at = cables.findIndex((c) => c.to[0] === to[0] && c.to[1] === to[1])
          if (at >= 0) cables.splice(at, 1)
          cables.push({ from: [id, from], to })
        }
        takeOver('pitch', [vco.id, 'pitch'])
        // The gate goes to an envelope if there is one; a VCA's own CV inlet otherwise, so a patch with no
        // ADSR still articulates rather than droning.
        const adsr = current.modules.find((m) => m.type === 'adsr')
        const vca = current.modules.find((m) => m.type === 'vca')
        if (adsr) takeOver('gate', [adsr.id, 'gate'])
        else if (vca) takeOver('gate', [vca.id, 'cv'])
        return { ...current, modules, cables }
      })
      return id
    },

    setVoices: (voices) =>
      structural((patch) => {
        const wanted = Math.max(1, Math.min(8, Math.round(voices)))
        // One stays absent rather than being written, so a monophonic patch round-trips exactly as it did
        // before polyphony existed — and a shared link from before this is byte-identical to one made now.
        if (wanted === 1) {
          const { voices: _drop, ...rest } = patch
          return rest
        }
        return { ...patch, voices: wanted }
      }),
    load: (patch) => structural(() => withGrooveboxSource(patch)),
    select: (moduleId) => set({ selected: moduleId }),
    flip: (flipped) => set((state) => ({ flipped: flipped ?? !state.flipped })),
  }
})

/**
 * What to open with: a shared rack document, then the last session, then something that makes a noise.
 *
 * The starter patch matters more than it looks. An empty rack is a correct empty state and a terrible
 * first impression — a modular with nothing in it does not hint at what it is for, and the first thing
 * anybody needs is to hear that it works and see a cable. So it opens on a small sequenced line, which
 * is also the shortest description of what this rack can do.
 */
export async function openingPatch(): Promise<Opening> {
  const shared = await takeRackDocumentFromUrl()
  if (shared) return { patch: shared, fresh: false, preset: matchingPreset(shared) }
  const stored = loadStoredPatch()
  if (stored) return { patch: stored, fresh: false, preset: matchingPreset(stored) }
  return { patch: STARTER(), fresh: true, preset: FIRST_PRESET }
}

/**
 * Recover the identity of an untouched shipped patch after it has travelled through storage or a link.
 *
 * Names stay outside the patch document so somebody's graph is not forced to have one. Exact encoded equality
 * is deliberately strict: the instant a person changes a knob it is their patch, not something the catalogue
 * should silently relabel as ours.
 */
export function matchingPreset(patch: Patch): PatchPreset | undefined {
  // Decoding once gives every optional top-level field and every module field a canonical insertion order.
  // Comparing the raw encodings did not: a factory writes `{ tempo, break, modules, ... }`, while a saved
  // patch decodes as `{ modules, cables, break, ... }`, and JSON object order made identical patches differ.
  const canonical = (candidate: Patch) => encodePatch(decodePatch(encodePatch(candidate))!)
  const encoded = canonical(patch)
  return PATCHES.find((preset) => canonical(preset.build()) === encoded)
}

/**
 * What the rack opened with, and whether this is somebody's first time.
 *
 * `fresh` is the whole distinction `docs/DNB.md`'s D2 turns on. Arriving already playing is the most
 * important thing in that document — but only for a visitor with nothing of their own. A shared link or a
 * saved session is somebody's work, and replacing it with a demo because it makes a better first impression
 * would be the worst thing this app could do.
 */
export interface Opening {
  patch: Patch
  fresh: boolean
  /** The preset `patch` came from, when it came from one — so the host can render the break it asks for. */
  preset?: PatchPreset
}

export { STARTER }
