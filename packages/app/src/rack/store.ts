import { EMPTY_PATCH, MODULES, type Patch, type PatchCable, type PlanNote } from '@driftbox/rack'
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

  setParam: (moduleId: string, paramId: string, value: number) => void
  paramValue: (moduleId: string, paramId: string) => number

  addModule: (type: string) => void
  removeModule: (moduleId: string) => void
  moveModule: (moduleId: string, by: number) => void

  connect: (from: [string, string], to: [string, string]) => void
  disconnect: (cable: PatchCable) => void

  setNotes: (notes: PlanNote[]) => void
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

const STARTER: Patch = {
  modules: [
    { id: 'clock-1', type: 'clock', params: { rate: 4, width: 0.35 } },
    { id: 'seq-1', type: 'seq', params: { pitch1: 0, pitch2: 7, pitch3: 12, pitch4: 3, length: 4 } },
    { id: 'vco-1', type: 'vco', params: { tune: -12 } },
    { id: 'adsr-1', type: 'adsr', params: { attack: 0.003, decay: 0.12, sustain: 0.15, release: 0.1 } },
    { id: 'ladder-1', type: 'ladder', params: { cutoff: 700, resonance: 0.72 } },
    { id: 'vca-1', type: 'vca', params: { gain: 0 } },
    { id: 'out-1', type: 'out', params: { level: 0.7 } },
  ],
  cables: [
    { from: ['clock-1', 'gate'], to: ['seq-1', 'clock'] },
    { from: ['seq-1', 'pitch'], to: ['vco-1', 'pitch'] },
    { from: ['seq-1', 'gate'], to: ['adsr-1', 'gate'] },
    { from: ['vco-1', 'out'], to: ['ladder-1', 'in'] },
    { from: ['adsr-1', 'out'], to: ['ladder-1', 'cutoff'] },
    { from: ['ladder-1', 'out'], to: ['vca-1', 'in'] },
    { from: ['adsr-1', 'out'], to: ['vca-1', 'cv'] },
    { from: ['vca-1', 'out'], to: ['out-1', 'in'] },
  ],
}

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
  return (await takePatchFromUrl()) ?? loadStoredPatch() ?? STARTER
}

export { STARTER }
