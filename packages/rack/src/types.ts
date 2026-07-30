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
 * Where the transport is, as of the start of this block.
 *
 * Handed to `process` as a fifth argument, which exactly one module reads — see `modules/transport.ts`. Every
 * other module syncs by patching to that module's outlets, which is how a real rack does it and is why this
 * widened the contract once rather than eighteen times. Existing modules ignore it because this is JavaScript
 * and an extra argument costs nothing.
 *
 * `beat` is accumulated per block rather than derived from an absolute frame count, so that changing the tempo
 * mid-bar carries on from where the music was instead of jumping to wherever the new arithmetic lands.
 */
export interface Transport {
  /** Beats per minute. */
  tempo: number
  /** Whether it is running. A stopped transport holds its position. */
  running: boolean
  /** Position in beats since the transport started, fractional. */
  beat: number
  /** How many beats one block covers, so a module can work out where inside the block a division falls. */
  beatsPerBlock: number
}

/**
 * Bulk data for one module — a sample buffer, a pattern.
 *
 * Not params. A param is a number with a range and a knob; this is hundreds of kilobytes of audio, or a
 * 64-step 8-lane pattern that is 512 values and could never be 512 knobs. See `docs/DNB.md`.
 *
 * **Read it every block and compare by identity.** A different array means different data — that is the whole
 * change-detection protocol, and it is deliberately that crude so nothing has to subscribe to anything.
 */
export interface ModuleData {
  get(slot: string): Float32Array | undefined
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
    transport?: Transport,
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
  data: ModuleData,
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
  /**
   * Param id carrying this terminal module's pan: −1 hard left, +1 hard right.
   *
   * Named here rather than found by convention in the compiler, so a module's stereo placement is a fact
   * about the module. Absent means centre, which is what every terminal module was before stereo existed —
   * and is why a patch shared before this sounds identical after it.
   */
  terminalPan?: string
  /**
   * Whether this module is duplicated per voice. Default true.
   *
   * `false` means one instance however many voices the patch has, and every voice arriving at one of its
   * inlets is **summed** first. That is the collapse, and it is the whole reason the flag exists: a Delay
   * duplicated eight times is eight delays, and a shared delay is the point. So is one master Out, one
   * clock, and one sequence.
   *
   * Default true rather than false because a module inside a voice is the common case — an oscillator, a
   * filter, an envelope — and getting the default wrong the other way would silently make polyphony
   * monophonic.
   */
  poly?: boolean
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
  /**
   * Bulk data that belongs *in* the document — a sequencer's pattern.
   *
   * Plain number arrays, so it is JSON and travels in a file and a URL like everything else. The other kind of
   * bulk data, a sample buffer, deliberately does **not** live here: it is pushed straight at the audio thread
   * with `Rack.setData`, because a patch should store *which* break rather than several hundred kilobytes of
   * one. Same argument as the MIDI module's hidden params, and the same consequence — a patch using a loaded
   * sample cannot travel in a URL, and has to say so.
   */
  data?: Record<string, number[]>
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
  /**
   * How many voices. Absent means one, which is what every patch written before this existed means.
   *
   * One count for the whole patch, deliberately. VCV Rack's model is more refined — polyphony originates at
   * a module and propagates down cables, so each cable carries its own channel count — and it is a great
   * deal more machinery: per-cable counts, a propagation pass, and a rule for what happens where two
   * different counts meet. One number is predictable, testable, and enough to play chords with.
   */
  voices?: number
  /**
   * Beats per minute. Absent means 120.
   *
   * In the patch rather than the session, because the engine's `Song` carries `bpm` for the same reason: a
   * drum-and-bass patch *is* 174, and one shared at the wrong tempo is not the patch that was shared. Whether
   * the transport is *running* is session state and deliberately not here.
   */
  tempo?: number
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
  /** False for a module that runs once however many voices there are. */
  poly: boolean
  /** Bulk data carried in the patch, seeded into the Graph when the plan is applied. */
  data?: Record<string, number[]>
}

/**
 * One terminal module's contribution to the mix.
 *
 * `pan` is a **param slot**, not a value, because a pan knob can be turned while the patch runs and could
 * one day be modulated — the Graph already holds a per-voice buffer for every slot, so this costs it a
 * lookup it was doing anyway. Null when the terminal module has no pan param at all, which is what keeps a
 * module type this build has never seen from needing one.
 */
export interface PlanOutput {
  /** Buffer to sum into the mix. */
  buffer: number
  /** Param slot carrying pan: −1 hard left, +1 hard right. */
  pan: number | null
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
  /** 1 to 8. Clamped from the patch, so a plan never asks for a voice count the Graph must guard against. */
  voices: number
  /**
   * Which buffers are per-voice, indexed the same way as the buffers themselves.
   *
   * A buffer is polyphonic exactly when the module writing it is, so the Graph could work this out from the
   * nodes — and it is emitted instead so that it does not have to. `process()` walking a list is the whole
   * design; every question it has to answer at run time is one it can get wrong.
   */
  poly: boolean[]
  /** In execution order. */
  nodes: PlanNode[]
  /** What reaches the speakers, and where in the stereo field. */
  outputs: PlanOutput[]
  params: PlanParam[]
  /** `moduleId` → `paramId` → slot, so the host can address a knob by name. */
  slots: Record<string, Record<string, number>>
  notes: PlanNote[]
}
