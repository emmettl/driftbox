import { compile } from './compile.js'
import { MODULES } from './modules/index.js'
import type { Patch, Plan, PlanNote, Registry } from './types.js'
import { RACK_PROCESSOR, loadRack } from './worklet.js'

// A modular synth rack: modules, cables between any of them, and one graph running at
// sample rate inside a single AudioWorklet.
//
// `docs/RACK.md` is the design and the reasoning. The short version of why this is not part
// of `@driftbox/engine`: that engine is trigger-shaped — a voice is a pure function from
// knobs to a spec, rendered into fresh Web Audio nodes per hit — and a rack is a persistent
// graph where anything modulates anything at audio rate. Two engines, one host, summing into
// the same destination.

export * from './types.js'
export { compile } from './compile.js'
export { Graph } from './graph.js'
export { PATCH_FORMAT, decodePatch, encodePatch } from './patch-io.js'
export { PATCHES, patchPresetById, type PatchPreset } from './patches/index.js'
export { VCV_MODELS, importVcv, importVcvPatch, type ImportNote, type Imported } from './vcv/index.js'
export { MODULES, MODULE_LIST } from './modules/index.js'
export { MIDI_INPUTS, MIDI_MODULE, MidiProcessor } from './modules/midi.js'
export { LADDER_MODULE, LadderProcessor } from './modules/ladder.js'
export { OUT_MODULE, OutProcessor } from './modules/out.js'
export { VCO_MODULE, VcoProcessor } from './modules/vco.js'
export { RACK_PROCESSOR, loadRack, rackSource, type RackMessage } from './worklet.js'

export const EMPTY_PATCH: Patch = { modules: [], cables: [] }

/**
 * The host side of a rack.
 *
 * Owns nothing but the node and the current plan. It does not own an AudioContext — the
 * caller does, because a rack is meant to sit alongside the drum machines in the same
 * context and share their output, not to be a second application.
 */
export class Rack {
  private readonly ctx: BaseAudioContext
  private readonly registry: Registry
  private node: AudioWorkletNode | null = null
  private current: Patch = EMPTY_PATCH
  private compiled: Plan | null = null
  /** Module types the worklet could not construct. Empty unless the worklet was assembled
   *  from a different module set than the one that compiled the plan. */
  private absent: string[] = []
  private tempoValue = 120
  private runningValue = false

  constructor(ctx: BaseAudioContext, registry: Registry = MODULES) {
    this.ctx = ctx
    this.registry = registry
  }

  /**
   * Load the processor and build the node.
   *
   * Resolves `false` when worklets are unavailable, which is the one failure a caller has to
   * handle: a rack without a worklet is not a degraded rack, it is no rack, and saying so is
   * better than looking broken.
   */
  async start(): Promise<boolean> {
    if (this.node) return true
    if (!(await loadRack(this.ctx, this.registry))) return false

    const node = new AudioWorkletNode(this.ctx, RACK_PROCESSOR, {
      // No inputs: everything the rack makes, it makes. Sampling the outside world is a
      // module (and a permission prompt), not a property of the rack.
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    })
    // The transport is not part of the plan, so applying a patch does not carry it — it has to be re-sent
    // whenever a node appears.
    node.port.postMessage({
      kind: 'transport',
      tempo: this.tempoValue,
      running: this.runningValue,
    })
    node.port.onmessage = (event: MessageEvent) => {
      const message = event.data as { kind?: string; types?: string[] } | null
      if (message?.kind === 'missing' && Array.isArray(message.types)) this.absent = message.types
    }
    this.node = node
    // A patch set before start() is not lost — the common order is to build a patch from a
    // URL and only then get a gesture to start audio with.
    this.send()
    return true
  }

  /** Connect this to a destination, a channel strip, or the engine's send bus. Null until
   *  `start()` has resolved true. */
  get output(): AudioNode | null {
    return this.node
  }

  get patch(): Patch {
    return this.current
  }

  /**
   * Replace the patch. Compiles immediately — so `notes` and `plan` are readable straight
   * away, whether or not audio has started — and takes effect on the audio thread at the
   * next block.
   */
  set patch(patch: Patch) {
    this.current = patch
    this.compiled = compile(patch, this.registry)
    this.absent = []
    this.send()
  }

  /** The compiled plan, for a UI that wants to draw what the compiler decided. */
  get plan(): Plan | null {
    return this.compiled
  }

  /**
   * What the compiler had to decide or discard: cables delayed to break a cycle, modules
   * this build does not have, cables it dropped. Not a log — a UI that does not draw these
   * is a UI that lies about the patch.
   */
  get notes(): PlanNote[] {
    const notes = this.compiled ? [...this.compiled.notes] : []
    for (const type of this.absent) {
      notes.push({
        kind: 'placeholder',
        detail: `the audio thread has no module of type "${type}"; it was compiled but not built`,
      })
    }
    return notes
  }

  /**
   * Move a knob. Silently does nothing for a module or param the current patch does not have, which is what
   * a UI holding a stale reference during a patch change will do.
   *
   * `voice` undefined means every voice, which is what a knob means. A specific voice is what a keyboard
   * means — one MIDI module holding eight different notes, one per voice.
   */
  setParam(moduleId: string, paramId: string, value: number, voice?: number): void {
    const slot = this.compiled?.slots[moduleId]?.[paramId]
    if (slot === undefined) return
    this.node?.port.postMessage({ kind: 'param', slot, value, voice })
  }

  /** How many voices the open patch compiled to. */
  get voices(): number {
    return this.compiled?.voices ?? 1
  }

  /**
   * Set the tempo and whether the transport is running.
   *
   * Held here as well as sent, because a Rack built before `start()` still has to be able to be told — and
   * because a patch reload has to re-send it, since the audio thread's Graph is not rebuilt but its transport
   * state is not part of the plan either.
   */
  setTransport(tempo: number, running: boolean): void {
    this.tempoValue = tempo
    this.runningValue = running
    this.node?.port.postMessage({ kind: 'transport', tempo, running })
  }

  get tempo(): number {
    return this.tempoValue
  }

  get running(): boolean {
    return this.runningValue
  }

  /**
   * Hand a module some bulk data — a sample buffer.
   *
   * **Transferred, not copied.** The second argument to `postMessage` moves the underlying buffer to the audio
   * thread rather than cloning it, which for a two-second stereo break is the difference between a few hundred
   * kilobytes of copying on the main thread and none. The consequence is that `data` is unusable here
   * afterwards — its byteLength becomes 0 — so a caller keeping its own copy has to make one first, and that is
   * why this takes the array rather than an AudioBuffer it could have copied out of.
   *
   * Deliberately *not* part of the patch: a patch stores which break, never several hundred kilobytes of one.
   * See `PatchModule.data` for the other kind of bulk data, which does belong in the document.
   */
  setData(moduleId: string, slot: string, data: Float32Array): void {
    this.node?.port.postMessage({ kind: 'data', module: moduleId, slot, data }, [data.buffer])
  }

  /** Disconnect and forget the node. The processor stays registered on the context —
   *  `addModule` on an already-registered name throws, so unloading it is not possible and
   *  not worth pretending. */
  stop(): void {
    this.node?.disconnect()
    this.node = null
  }

  private send(): void {
    if (!this.node || !this.compiled) return
    this.node.port.postMessage({ kind: 'plan', plan: this.compiled })
  }
}
