// What a module is, what a patch is, and what the compiler turns one into.
//
// Read `docs/RACK.md` first — the reasoning for the shape of all of this lives there.
// This file is the shape itself.

/** An inlet or an outlet. There is only one signal type: audio and CV are the same
 *  Float32Array, and nothing anywhere enforces which is which. A patch that plays an
 *  envelope through a speaker is the user's business. */
export interface Port {
  id: string
  name: string
}

export interface ParamDef {
  id: string
  name: string
  min: number
  max: number
  default: number
  /**
   * Stepped params jump at the start of a block instead of ramping across it. A waveform
   * selector interpolated halfway between saw and pulse is not a sound anybody asked for,
   * and rounding a ramping value would make the selector flicker between the two for a
   * block every time it changed.
   */
  stepped?: boolean
  /**
   * What each position of a stepped param is called, from `min` upward.
   *
   * Nothing on the audio thread reads this. It exists because a faceplate generated from a def can
   * otherwise only offer the numbers, and a gate switch labelled "0" and "1" is worse than useless —
   * it looks like a bug. Declaring the names here rather than in the UI is what lets a module get a
   * *good* generic faceplate rather than merely a working one, which is the difference between the
   * fallback being a fallback and the fallback being enough.
   *
   * Omit it when the numbers are the meaning: a sequencer's length really is 1 to 8.
   */
  labels?: readonly string[]
  /**
   * A param the host writes rather than a control anybody turns. A faceplate leaves it out.
   *
   * The MIDI module is why: its note, gate and velocity arrive from Web MIDI, which cannot reach the audio
   * thread — a worklet scope has no `navigator` — so they come in as params instead, needing nothing new in
   * the message ABI. A *visible* knob on the same slot would fight the keyboard: it would read 0 while the
   * audio thread held 3, and nudging it would snap the note back. Hidden means exactly one writer.
   *
   * Everything else about it is a normal param: it clamps, it ramps or steps, it has a slot. What it is not
   * is part of the document — the host writes these straight to `Rack.setParam` and never through a patch,
   * so a note somebody played is never saved as one.
   */
  hidden?: boolean
}

/**
 * The audio-thread half of a module.
 *
 * `inlets`, `outlets` and `params` all arrive as `Float32Array`s of `frames` samples, in
 * the order the module's def declares them. Params are per-sample too, so a knob turn
 * ramps rather than steps — the same reasoning that makes the ladder's cutoff a-rate in
 * `@driftbox/engine`.
 *
 * Two rules, both load-bearing:
 *
 *   1. **Never write to an inlet.** Inlet buffers are shared — one outlet feeding three
 *      inlets is one buffer read three times — and an unconnected inlet is the graph's
 *      single zero buffer, so writing to one would invent a signal for every other
 *      unconnected inlet in the patch.
 *   2. **Always write every sample of every outlet.** Buffers are reused across blocks
 *      and are not cleared, so a partial write leaves the previous block's audio in the
 *      tail. Write silence if there is nothing to say.
 */
export interface Processor {
  process(
    inlets: Float32Array[],
    outlets: Float32Array[],
    params: Float32Array[],
    frames: number,
  ): void
}

/**
 * A processor class, as the audio thread will construct it.
 *
 * `deps` carries the shared DSP classes the module asked for, keyed by the names in its
 * def. It is passed in rather than referenced by identifier on purpose — see the comment
 * in `worklet.ts` about what a minifier does to a stringified class.
 *
 * `id` is the module's id from the patch. Almost nothing needs it; what does need it is anything
 * random, because seeding from an id is what makes a patch containing noise sound the same twice
 * while still letting two Noise modules decorrelate. See `dsp/random.ts`. A class that ignores it
 * simply declares a shorter constructor.
 */
export type ProcessorClass = new (
  sampleRate: number,
  deps: Record<string, unknown>,
  id: string,
) => Processor

/** A shared DSP class a module can ask for by name. `never[]` rather than `unknown[]` so
 *  that a constructor taking real arguments is still assignable. */
export type Dep = abstract new (...args: never[]) => unknown

export interface ModuleDef {
  /** Stable forever. This is the string a saved patch stores. */
  type: string
  /** Bumped when params change in a way `migrate` has to repair. */
  version: number
  name: string
  inlets: Port[]
  outlets: Port[]
  params: ParamDef[]
  processor: ProcessorClass
  /** Shared DSP classes, keyed by the name the processor will look them up under. */
  deps?: Record<string, Dep>
  /** A terminal module: its first outlet is summed into the rack's audio output. */
  terminal?: boolean
  /** Repair the params of an older saved version. Lives here rather than in a central
   *  table because at forty modules a central table is unmaintainable, and the person
   *  adding a param is the person who knows what the old value meant. */
  migrate?(params: Record<string, number>, from: number): Record<string, number>
}

export type Registry = Record<string, ModuleDef>

// ---------------------------------------------------------------------------------------
// A patch, as it is saved
// ---------------------------------------------------------------------------------------

export interface PatchModule {
  id: string
  type: string
  version?: number
  params?: Record<string, number>
  /** Where it sits in the rack. The engine does not read this; the UI does. */
  pos?: [number, number]
}

/** `[moduleId, portId]` at each end. Port *names*, never indices — so a module that gains
 *  an inlet does not silently rewire every patch that used it. */
export interface PatchCable {
  from: [string, string]
  to: [string, string]
}

export interface Patch {
  modules: PatchModule[]
  cables: PatchCable[]
}

// ---------------------------------------------------------------------------------------
// A compiled plan
// ---------------------------------------------------------------------------------------

/** Buffer indices, in the order the module's def declares its ports. Index 0 on an inlet
 *  means unconnected, and reads as silence. */
export interface PlanNode {
  id: string
  type: string
  inlets: number[]
  outlets: number[]
  /** Slot index per param, in def order. */
  params: number[]
}

export interface PlanParam {
  value: number
  stepped: boolean
}

/**
 * Everything the compiler had to decide or discard.
 *
 * This is not a log — it is output. A cable the compiler delayed to break a cycle has to
 * be drawn differently, and a module it could not resolve has to be drawn as a blank
 * faceplate. A patch that silently behaves unlike its picture is worse than one that
 * admits it.
 */
export interface PlanNote {
  kind:
    | 'placeholder'
    | 'delayed'
    | 'dropped-cable'
    | 'replaced-cable'
    | 'duplicate-module'
    | 'migration-failed'
  detail: string
  module?: string
  cable?: PatchCable
}

export interface Plan {
  /** How many buffers to allocate. Index 0 is the zero buffer and is never written. */
  buffers: number
  /** In execution order. */
  nodes: PlanNode[]
  /** Buffer indices to sum into the audio output. */
  outputs: number[]
  params: PlanParam[]
  /** `moduleId` → `paramId` → slot, so the host can address a knob by name. */
  slots: Record<string, Record<string, number>>
  notes: PlanNote[]
}
