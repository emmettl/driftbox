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
