import { EMPTY_PATCH, MODULES, PATCHES, type Patch, type PatchCable, type PlanNote } from '@driftbox/rack'
import { create } from 'zustand'
import { autosavePatch, loadStoredPatch, takePatchFromUrl } from './persistence.js'

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

  addModule: (type: string) => void
  removeModule: (moduleId: string) => void
  moveModule: (moduleId: string, by: number) => void

  connect: (from: [string, string], to: [string, string]) => void
  disconnect: (cable: PatchCable) => void

  setNotes: (notes: PlanNote[]) => void
  setName: (name: string | null) => void
  setMidi: (note: number | null, inputs?: string[]) => void
  /** Structural: the graph is rebuilt with a different number of processors per module. */
  setVoices: (voices: number) => void
  /** Not structural. Tempo is a value in the patch — it saves and it travels in a link, but changing it does not
   *  rebuild the graph, so it goes down the same path a knob does. */
  setTempo: (tempo: number) => void
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
 * What an empty rack opens on.
 *
 * The shipped Acid patch rather than a second copy of it — it was written out longhand here first, and two
 * definitions of the same patch is one too many. `@driftbox/rack` owns them now for the same reason the
 * engine owns its songs: they are data about the rack, not about the page showing it.
 *
 * It matters more than it looks. An empty rack is a correct empty state and a terrible first impression: a
 * modular with nothing in it does not hint at what it is for, and the first thing anybody needs is to hear
 * that it works and see a cable.
 */
const STARTER = (): Patch => PATCHES[0].build()

export const useRack = create<RackState>((set, get) => {
  /** Every structural edit goes through here, so nothing can forget the revision or the autosave. */
  const structural = (change: (patch: Patch) => Patch) => {
    set((state) => {
      const patch = change(state.patch)
      autosavePatch(patch)
      return { patch, revision: state.revision + 1 }
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
        const patch = {
          ...state.patch,
          modules: state.patch.modules.map((module) =>
            module.id === moduleId
              ? { ...module, params: { ...module.params, [paramId]: value } }
              : module,
          ),
        }
        autosavePatch(patch)
        return { patch }
      })
    },

    addModule: (type) =>
      structural((patch) => ({
        ...patch,
        modules: [...patch.modules, { id: freshId(patch, type), type }],
      })),

    removeModule: (moduleId) =>
      structural((patch) => ({
        modules: patch.modules.filter((m) => m.id !== moduleId),
        // Every cable touching it goes too. The compiler would drop them anyway, but leaving them in
        // the patch means they come back if the module is re-added under the same id, which looks
        // like a haunting.
        cables: patch.cables.filter((c) => c.from[0] !== moduleId && c.to[0] !== moduleId),
      })),

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
    load: (patch) => structural(() => patch),
    select: (moduleId) => set({ selected: moduleId }),
    flip: (flipped) => set((state) => ({ flipped: flipped ?? !state.flipped })),
  }
})

/**
 * What to open with: a shared link, then the last session, then something that makes a noise.
 *
 * The starter patch matters more than it looks. An empty rack is a correct empty state and a terrible
 * first impression — a modular with nothing in it does not hint at what it is for, and the first thing
 * anybody needs is to hear that it works and see a cable. So it opens on a small sequenced line, which
 * is also the shortest description of what this rack can do.
 */
export async function openingPatch(): Promise<Patch> {
  return (await takePatchFromUrl()) ?? loadStoredPatch() ?? STARTER()
}

export { STARTER }
