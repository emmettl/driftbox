import { compile } from './compile.js'
import { MODULES } from './modules/index.js'
import type { MeterReading, Patch, Plan, PlanNote, Registry } from './types.js'
import { RACK_PROCESSOR, loadRack } from './worklet.js'

// A modular synth rack: modules, cables between any of them, and one graph running at
// sample rate inside a single AudioWorklet.
//
// `docs/RACK.md` is the design and the reasoning. The short version of why this is not part
// of `@driftbox/engine`: that engine is trigger-shaped — a voice is a pure function from
// knobs to a spec, rendered into fresh Web Audio nodes per hit — and a rack is a persistent
// graph where anything modulates anything at audio rate. Two engines, one host, summing into
// the same destination.

// ---------------------------------------------------------------------------------------
// The public surface, in two tiers.
//
// **`export *` used to stand here, and that was the whole problem.** A blanket re-export
// publishes whatever `types.ts` happens to contain — which is how the compiler's `Plan`
// shapes and the worklet's `Processor` contract became part of this package's API without
// anybody deciding they should be. `docs/RACK.md` records `ModuleDef` and `Processor`
// changing four times in four PRs and concludes that opening them "turns each into a
// promise"; `export *` had already made that promise on our behalf.
//
// So every name is listed. Adding one is now a deliberate line in a diff rather than a
// side effect of adding a field, and `api.test.ts` pins the list so it shows up in review.
//
// The tiers are not enforced by the type system — TypeScript has no way to say "exported
// but not promised" — so they are enforced by being written down and tested.
// ---------------------------------------------------------------------------------------

// ---- Tier 1: the document and the host --------------------------------------------------
//
// What a consumer of `@driftbox/rack` touches. **A patch is the thing worth being stable
// about**, because patches are saved, shared as URLs and opened by builds that are not this
// one — and that stability is already designed in rather than hoped for: `PATCH_FORMAT`
// carries a version, every added field has been optional, `decodePatch` never throws and
// preserves what it does not recognise, and `patch-io.test.ts` pins that a patch written
// before a field existed still round-trips byte-identically. Adding `modulation` for the
// Combinator was that design working, not a break.
export type {
  Patch,
  PatchModule,
  PatchCable,
  ModRoute,
  AutoLane,
  AutoPoint,
  ParamRef,
  Port,
  ParamDef,
  ModuleLogo,
  ModuleDef,
  MeterReading,
} from './types.js'

// ---- Tier 2: still moving ---------------------------------------------------------------
//
// Exported because the app in this repo needs them, **not because they are promised.** These
// are the compiler's output and the audio thread's contract, and both are expected to change:
// `Plan` is an implementation detail of `compile` that no outside consumer should be reading,
// and `Processor`/`ProcessorClass`/`Dep` are the third-party-module question `docs/RACK.md`
// explicitly defers.
//
// If this package is published, these are what a major version would be reserved for — or what
// moves behind a `@driftbox/rack/internal` entry point on the day somebody outside depends on
// one. Either way the decision is now visible instead of implied.
export type {
  Plan,
  PlanNode,
  PlanOutput,
  PlanParam,
  PlanNote,
  Processor,
  ProcessorClass,
  Registry,
  Transport,
  ModuleData,
  Dep,
} from './types.js'

export { compile } from './compile.js'
export { Graph } from './graph.js'
export { applyModulation, routeValue, routedParams, sourcePosition } from './modulation.js'
export {
  automationLength,
  clearLane,
  laneFor,
  pointsIn,
  setPoint,
  STEPS_PER_BAR,
  stepOf,
  valueAt,
} from './automation.js'
export {
  embedGrooveboxSong,
  grooveboxSong,
  GROOVEBOX_SOURCE_ID,
  isGrooveboxEditable,
  patchCompatibility,
  renderRetainedSongMix,
  withGrooveboxSource,
  type PatchCompatibility,
} from './groovebox.js'
export { PATCH_FORMAT, decodePatch, encodePatch } from './patch-io.js'
export { PATCHES, patchPresetById, type PatchPreset } from './patches/index.js'
export { CHUNKS, chunkById, insertChunk, type Chunk, type Inserted } from './chunks/index.js'
export { VCV_MODELS, importVcv, importVcvPatch, type ImportNote, type Imported } from './vcv/index.js'
export { MODULES, MODULE_LIST } from './modules/index.js'
export { ALLIGATOR_BANDS, ALLIGATOR_MODULE, AlligatorProcessor } from './modules/alligator.js'
export { AUDIO_INPUT_MODULE, AudioInputProcessor } from './modules/audio-input.js'
export { ARRANGER_MODULE, ARRANGER_SECTIONS, ArrangerProcessor } from './modules/arranger.js'
export { COMBI_CONTROLS, COMBI_MODULE, COMBI_ROTARY_MAX, CombiProcessor } from './modules/combi.js'
export { FOLLOWER_MODULE, FollowerProcessor } from './modules/follower.js'
export {
  GROOVEBOX_MODULE,
  GROOVEBOX_PORTS,
  GrooveboxProcessor,
} from './modules/groovebox.js'
export { MIDI_INPUTS, MIDI_MODULE, MidiProcessor } from './modules/midi.js'
export { LADDER_MODULE, LadderProcessor } from './modules/ladder.js'
export { OUT_MODULE, OutProcessor } from './modules/out.js'
export { TRACKER_LANES, TRACKER_MODULE, TrackerProcessor } from './modules/tracker.js'
export { VCO_MODULE, VcoProcessor } from './modules/vco.js'
export { VOICE_MODULE, VoiceProcessor } from './modules/voice.js'
export {
  VOCODER_BAND_COUNTS,
  VOCODER_MAX_BANDS,
  VOCODER_MODULE,
  VOCODER_RANGE_HZ,
  VocoderProcessor,
} from './modules/vocoder.js'
export { RACK_PROCESSOR, loadRack, rackSource, type RackMessage } from './worklet.js'
export { renderLength, renderPatch, type RenderOptions } from './render.js'

export const EMPTY_PATCH: Patch = { modules: [], cables: [] }
/** Host input 4 is reserved for a browser MediaStream; 0..3 are the groovebox sections. */
export const RACK_LIVE_INPUT = 4
export const RACK_HOST_INPUTS = 5

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
  private readonly hostInputs: GainNode[]
  private node: AudioWorkletNode | null = null
  private current: Patch = EMPTY_PATCH
  private compiled: Plan | null = null
  /** Module types the worklet could not construct. Empty unless the worklet was assembled
   *  from a different module set than the one that compiled the plan. */
  private absent: string[] = []
  private tempoValue = 120
  private runningValue = false
  /** Data set before there was a node to send it to. Handed over in `processorOptions` at construction. */
  private pending: { module: string; slot: string; data: Float32Array }[] = []
  /** Scheduled param changes made before there was a node to send them to. See `scheduleParam`. */
  private pendingParams: { slot: number; value: number; voice?: number; frame: number }[] = []
  /** Meter displays are opt-in so an offline render never produces UI traffic. */
  private meterListeners = new Set<(readings: readonly MeterReading[]) => void>()

  constructor(ctx: BaseAudioContext, registry: Registry = MODULES) {
    this.ctx = ctx
    this.registry = registry
    this.hostInputs = Array.from({ length: RACK_HOST_INPUTS }, () => ctx.createGain())
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
      // Four groovebox buses plus one live browser input. They make no sound by
      // themselves: source modules turn them into ordinary patchable rack outlets.
      numberOfInputs: RACK_HOST_INPUTS,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      // Handed over at construction rather than posted afterwards. A port message is delivered on the audio
      // thread, and an OfflineAudioContext does not run that thread until `startRendering` — so posting a
      // plan and rendering immediately is a race that loses silently, producing a file of the right length
      // and no sound. See the note in the processor's constructor.
      processorOptions: {
        plan: this.compiled,
        transport: { tempo: this.tempoValue, running: this.runningValue },
        data: this.pending,
        params: this.pendingParams,
      },
    })
    for (let input = 0; input < this.hostInputs.length; input++) {
      this.hostInputs[input].connect(node, 0, input)
    }
    this.pending = []
    this.pendingParams = []
    node.port.onmessage = (event: MessageEvent) => {
      const message = event.data as {
        kind?: string
        types?: string[]
        readings?: MeterReading[]
      } | null
      if (message?.kind === 'missing' && Array.isArray(message.types)) this.absent = message.types
      if (message?.kind === 'meters' && Array.isArray(message.readings)) {
        for (const listener of this.meterListeners) listener(message.readings)
      }
    }
    this.node = node
    if (this.meterListeners.size > 0) node.port.postMessage({ kind: 'monitor', enabled: true })
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

  /**
   * A stable destination for one host-fed source. It exists before `start()`, so another
   * engine can be wired once; the gain is connected to the worklet when it becomes ready.
   */
  input(index: number): AudioNode | null {
    return this.hostInputs[index] ?? null
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

  /**
   * Move a knob **at a moment**, rather than at the next block boundary.
   *
   * A separate method rather than a fifth argument to `setParam`, because scheduling without caring about
   * voices is the common case and `setParam(id, p, v, undefined, frame)` is a call site nobody should have
   * to write. It posts the same message; the frame is the only difference.
   *
   * This is what recorded automation is played back through. Without it a lane can only be delivered one
   * point per block — up to 2.9ms out at 44.1kHz, which is inaudible on a slow sweep and quite audible on
   * anything meant to land on a beat.
   *
   * `frame` is on the context's clock: use `frameFor`. A frame already past applies immediately rather than
   * being dropped, so a lane read slightly too late still plays, merely late.
   */
  scheduleParam(
    moduleId: string,
    paramId: string,
    value: number,
    frame: number,
    voice?: number,
  ): void {
    const slot = this.compiled?.slots[moduleId]?.[paramId]
    if (slot === undefined) return
    if (!this.node) {
      // Held until the node exists, the same way a loaded sample is. **This is what makes automation work
      // in an offline render at all**: no port message reaches an `OfflineAudioContext` before
      // `startRendering`, because that thread is not running yet — measured, and the symptom is a file of
      // the right length with the automation simply absent.
      //
      // Only scheduled changes are held. An ordinary `setParam` before `start()` is already redundant,
      // because the plan carries every param's value and the patch was compiled after it was set. A
      // scheduled change is an event rather than a value, so nothing else is carrying it.
      this.pendingParams.push({ slot, value, voice, frame })
      return
    }
    this.node.port.postMessage({ kind: 'param', slot, value, voice, frame })
  }

  /**
   * A context time, as the frame the audio thread will call it.
   *
   * Here rather than left to each caller because it is the one piece of the scheduling contract that is easy
   * to get subtly wrong — `currentFrame` on the audio thread counts samples from the start of the context,
   * which is `currentTime * sampleRate` and not, for instance, milliseconds or a count of blocks. Getting it
   * wrong gives automation that is silently in the wrong place rather than an error.
   */
  frameFor(when: number): number {
    if (!Number.isFinite(when)) return 0
    return Math.max(0, Math.round(when * this.ctx.sampleRate))
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
   * Watch the patch's meter modules at display rate.
   *
   * The first listener enables reports on the audio thread and the last one disables them. The DSP itself
   * continues either way: monitoring is a view of the graph, never part of making sound.
   */
  onMeters(listener: (readings: readonly MeterReading[]) => void): () => void {
    this.meterListeners.add(listener)
    if (this.meterListeners.size === 1) {
      this.node?.port.postMessage({ kind: 'monitor', enabled: true })
    }
    return () => {
      this.meterListeners.delete(listener)
      if (this.meterListeners.size === 0) {
        this.node?.port.postMessage({ kind: 'monitor', enabled: false })
      }
    }
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
    if (!this.node) {
      // Held until the node exists, and then handed over at construction rather than posted. A break
      // pushed before `start()` used to be dropped on the floor without a word.
      this.pending.push({ module: moduleId, slot, data })
      return
    }
    this.node.port.postMessage({ kind: 'data', module: moduleId, slot, data }, [data.buffer])
  }

  /** Disconnect and forget the node. The processor stays registered on the context —
   *  `addModule` on an already-registered name throws, so unloading it is not possible and
   *  not worth pretending. */
  stop(): void {
    if (this.node) {
      for (const input of this.hostInputs) input.disconnect(this.node)
    }
    this.node?.disconnect()
    this.node = null
  }

  private send(): void {
    if (!this.node || !this.compiled) return
    this.node.port.postMessage({ kind: 'plan', plan: this.compiled })
  }
}
